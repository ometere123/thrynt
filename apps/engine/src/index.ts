import {decodeEventLog,formatUnits,parseUnits} from "viem";
import {createServer,type Server} from "node:http";
import {decodePlaceOrder,perpPoolEventsAbi,orderBookEventsAbi,type TailStatus} from "@somnia-chain/markets-sdk";
import {checkRisk,type Market,type MetricSnapshot,type Rule} from "@thrynt/core";
import {createPublicClient,http,type Log} from "viem";
import {ThryntApi,type EngineState,type StoredStrategy} from "./api.js";
import {configFromEnv} from "./config.js";
import {decide,intentKey,prepareTrade} from "./decision.js";
import {SomniaPlane,upToGrid} from "./markets.js";
import {LinkedBot} from "./operator.js";

const config=configFromEnv();
const api=new ThryntApi(config);
const plane=new SomniaPlane(config);
const bot=config.botPrivateKey
  ?new LinkedBot(config.owner,config.botPrivateKey,plane.chain,config.rpc):null;
if(bot&&config.expectedBotAddress&&bot.address.toLowerCase()!==config.expectedBotAddress.toLowerCase())
  throw new Error("Derived BOT_PRIVATE_KEY address does not match EXPECTED_BOT_ADDRESS");
// The SDK owns the persistent WebSocket live tail. Raw receipt-backed trigger
// discovery uses the bounded HTTP RPC transport because Hideki's WebSocket log
// subscription has been observed to replay logs several blocks late. Polling
// still produces genuine onchain log identities; the three-block freshness gate
// below remains fail-closed for any delayed response.
const publicClient=createPublicClient({
  chain:plane.chain,
  transport:http(config.rpc,{timeout:15_000}),
  pollingInterval:2_000,
});
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const textError=(err:unknown)=>err instanceof Error?err.message:String(err);

// Hideki's SDK can reject a WebSocket unsubscribe after a live-tail reset has
// already returned. Node treats an otherwise-unhandled rejection as a fatal
// exception, which would restart the engine in the middle of recovery. Keep
// the process alive, mark the feed unhealthy, and let the supervisor recover;
// all signing gates remain closed while this flag is false.
process.on("unhandledRejection",reason=>{
  sdkFeedHealthy=false;
  feedHealthy=false;
  healthy=false;
  console.error("Unhandled promise rejection; execution remains suspended",textError(reason));
});

function invokeSdkCleanup(action:()=>unknown,label:string) {
  try {
    const result=action() as {catch?: (handler:(reason:unknown)=>unknown)=>unknown}|undefined;
    if(result&&typeof result.catch==="function")
      void result.catch(err=>console.error(`${label} failed`,textError(err)));
  } catch(err) {
    console.error(`${label} failed`,textError(err));
  }
}

const acceptableEvents=new Set(["FundingUpdated","OpenInterestUpdated","OrderPlaced"]);
const rawMaxCatchupBlocks=256n;
// Hideki's HTTP log endpoint is materially slower than its chain head. A
// larger bounded batch keeps the fallback tail close to head without making
// an unbounded historical request; event freshness is still enforced below.
const rawBatchBlocks=64n;
const maxEventLagBlocks=96n;
const observedPoolAbi=[...perpPoolEventsAbi,...orderBookEventsAbi] as const;
type Event={
  id:string;market:Market;kind:"FundingUpdated"|"OpenInterestUpdated"|"OrderPlaced";
  txHash:`0x${string}`;blockNumber:bigint;logIndex:number;observedAt:string;
};
let stopped=false;
let cachedProtectiveStops:Record<string,unknown>[]=[];
let protectiveStopsObservedAt=0;
let leased=false;
let leaseGeneration:string|null=null;
let healthy=false;
let feedHealthy=false;
let rawFeedHealthy=true;
let sdkFeedHealthy=false;
let sdkTail:TailStatus|null=null;
let seenBlock:string|null=null;
let sdkReconnectAt=0;
let sdkFeedEpoch=0;
// Hideki's five-market SDK hydration can exceed one HTTP round-trip during
// indexer/RPC load. This remains a bounded startup gate: a feed that does not
// become live within the window keeps execution suspended.
const sdkStartTimeoutMs=60_000;
let queued=0;
const stopWatchers:(()=>void)[]=[];
const sdkWatchers:{stop:()=>void}[]=[];
let sdkPerpWatcher:{stop:()=>void}|null=null;
let sdkLiveUnsubscribe:(()=>void)|null=null;
let rawPollTimer:ReturnType<typeof setTimeout>|null=null;
let rawPollRunning=false;
let rawNextBlock:bigint|null=null;
let rawSuspended=false;
let healthServer:Server|null=null;
let cachedState:EngineState|null=null;
let cachedStateAt=0;
// Hideki can publish several pool logs while the RPC receipt and market
// snapshot reads for one event are still in flight. A FIFO promise chain then
// guarantees that every queued event is stale before it reaches the freshness
// gate. Keep one in-flight event, coalesce pending events by market/kind, and
// always service the newest pending event. This preserves serial decision and
// intent reservation semantics while preventing an unbounded replay backlog.
let activeEvent=false;
const pendingEvents=new Map<string,Event>();

function refreshEventQueueSize() {
  queued=pendingEvents.size+(activeEvent?1:0);
}

function drainEventQueue() {
  if(activeEvent||pendingEvents.size===0)return;
  let nextKey:string|undefined;
  let next:Event|undefined;
  for(const [key,event] of pendingEvents) {
    if(!next||event.blockNumber>next.blockNumber||
      (event.blockNumber===next.blockNumber&&event.logIndex>next.logIndex)) {
      nextKey=key;next=event;
    }
  }
  if(!next||!nextKey)return;
  pendingEvents.delete(nextKey);
  activeEvent=true;
  refreshEventQueueSize();
  void processEvent(next).catch(err=>{
    healthy=false;
    console.error("event handler error",textError(err));
  }).finally(()=>{
    activeEvent=false;
    refreshEventQueueSize();
    drainEventQueue();
  });
}

function interested(event:Pick<Event,"market"|"kind">) {
  if(!cachedState||Date.now()-cachedStateAt>30_000)return false;
  return cachedState.strategies.some(s=>{
    const selected=rulesFor(s);
    return selected?.rule.trigger.market===event.market&&selected.rule.trigger.event===event.kind;
  });
}

async function refreshState() {
  const state=await api.state();
  cachedState=state;
  cachedStateAt=Date.now();
  return state;
}

function healthPayload() {
  return {
    ok:true,
    service:"thrynt-engine",
    chainId:50383,
    mode:config.mode,
    liveOptIn:config.liveOptIn,
    leased,
    healthy,
    feedHealthy,
    rawFeedHealthy,
    sdkFeedHealthy,
    sdkTail:sdkTail?{
      mode:sdkTail.mode,
      wsConnected:sdkTail.wsConnected,
      watchCount:sdkTail.watchCount,
      lastBlock:sdkTail.lastBlock,
      headBlock:sdkTail.headBlock,
      healedGaps:sdkTail.healedGaps,
      failure:Boolean(sdkTail.failure),
    }:null,
    queued,
    seenBlock,
  };
}

async function startHealthServer() {
  healthServer=createServer((request,response)=>{
    if(request.method!=="GET"||!request.url||!["/healthz","/readyz"].includes(request.url)) {
      response.statusCode=404;
      response.end();
      return;
    }
    const ready=healthy&&leased&&feedHealthy;
    response.statusCode=request.url==="/readyz"&&!ready?503:200;
    response.setHeader("content-type","application/json; charset=utf-8");
    response.setHeader("cache-control","no-store");
    response.end(JSON.stringify({...healthPayload(),ready}));
  });
  await new Promise<void>((resolve,reject)=>{
    healthServer?.once("error",reject);
    healthServer?.listen(config.healthPort,"0.0.0.0",()=>resolve());
  });
}

async function stopHealthServer() {
  if(!healthServer)return;
  await new Promise<void>(resolve=>healthServer?.close(()=>resolve()));
  healthServer=null;
}

function rulesFor(s:StoredStrategy):{id:string;rule:Rule}|null {
  const v=s.strategy_versions.find(x=>x.version===s.current_version);
  return v?{id:v.id,rule:v.rule}:null;
}
async function snapshotsFor(rule:Rule) {
  const markets=new Set<Market>([
    rule.trigger.market,...rule.groups.flatMap(g=>g.conditions.map(c=>c.market)),
    ...("market" in rule.action?[rule.action.market]:[]),
  ]);
  const snaps=await Promise.all([...markets].map(m=>plane.sample(m)));
  for(const snap of snaps)await api.market(snap);
  return snaps;
}
async function record(
  s:StoredStrategy,versionId:string,event:Event,status:"unmatched"|"blocked"|"observed"|"paused",
  evaluation:object,risk:Record<string,unknown>,
) {
  return api.decision({
    strategyId:s.id,versionId,eventId:event.id,status,evaluation,risk,
  });
}

async function processStrategy(s:StoredStrategy,event:Event,status:{global_pause:boolean;lease_holder:string|null;lease_generation:string|number|null}) {
  const selected=rulesFor(s);
  if(!selected)return;
  const {id:versionId,rule}=selected;
  if(rule.trigger.market!==event.market||rule.trigger.event!==event.kind)return;
  let snaps:MetricSnapshot[];
  try {snaps=await snapshotsFor(rule);}
  catch(err) {
    await record(s,versionId,event,"blocked",{matched:false},
      {blockedBy:["STALE_MARKET"],details:textError(err).slice(0,220)});
    return;
  }
  const evaluation=decide(rule,snaps);
  if(!evaluation.matched) {
    await record(s,versionId,event,"unmatched",evaluation,{blockedBy:[]});
    return;
  }
  if(status.global_pause||!leased||!leaseGeneration||status.lease_holder!==config.instance||
    status.lease_generation?.toString()!==leaseGeneration) {
    await record(s,versionId,event,"blocked",evaluation,{blockedBy:["PAUSED"]});
    return;
  }
  if(rule.action.kind==="notify") {
    await record(s,versionId,event,"observed",evaluation,{message:rule.action.message});
    return;
  }
  if(rule.action.kind==="pause") {
    await record(s,versionId,event,"paused",evaluation,{reason:"Margin Sentinel rule matched"});
    await api.pause(s.id);
    return;
  }
  const action=rule.action;
  const snap=snaps.find(x=>x.market===action.market);
  if(!snap)throw new Error("Action market snapshot unavailable");
  const market=plane.info(action.market);
  const position=action.kind==="reduce"?await plane.reducible(action.market):0n;
  let book;
  try {book=await plane.topOfBook(action.market);}
  catch(err) {
    await record(s,versionId,event,"blocked",evaluation,{
      blockedBy:["BOOK_UNAVAILABLE"],details:textError(err).slice(0,220),
    });
    return;
  }
  const requestedSide=action.kind==="trade"?action.side:(position>=0n?"short":"long");
  if((action.kind==="trade"||action.kind==="reduce")&&
    (requestedSide==="long"?!book.bestAsk:!book.bestBid)) {
    await record(s,versionId,event,"blocked",evaluation,{
      blockedBy:["BOOK_UNAVAILABLE"],
      details:"No executable top-of-book liquidity for the requested side",
      bookBlock:book.blockNumber.toString(),
    });
    return;
  }
  let order;
  try {order=prepareTrade(rule,snap,market,position,book);}
  catch(err) {
    await record(s,versionId,event,"blocked",evaluation,{blockedBy:["SIZE_INVALID"],detail:textError(err)});
    return;
  }
  if(config.authorizedMinSellPriceUsd!==undefined&&order.side==="short") {
    const absoluteFloor=upToGrid(
      parseUnits(config.authorizedMinSellPriceUsd.toFixed(market.quoteDecimals),market.quoteDecimals),
      market.tickSize,
    );
    if(order.price<absoluteFloor)order={...order,price:absoluteFloor};
  }
  if(config.authorizedMaxPriceUsd!==undefined) {
    const orderPriceUsd=Number(formatUnits(order.price,market.quoteDecimals));
    if(!Number.isFinite(orderPriceUsd)||orderPriceUsd>config.authorizedMaxPriceUsd) {
      await record(s,versionId,event,"blocked",evaluation,{
        blockedBy:["AUTHORIZED_PRICE_CAP"],orderPriceUsd,
        authorizedMaxPriceUsd:config.authorizedMaxPriceUsd,
        note:"Temporary per-order authorization cap rejected this prepared price",
      });
      return;
    }
  }
  if(config.authorizedMinSellPriceUsd!==undefined&&requestedSide==="short") {
    const orderPriceUsd=Number(formatUnits(order.price,market.quoteDecimals));
    if(!Number.isFinite(orderPriceUsd)||orderPriceUsd<config.authorizedMinSellPriceUsd) {
      await record(s,versionId,event,"blocked",evaluation,{
        blockedBy:["AUTHORIZED_MIN_SELL_PRICE"],orderPriceUsd,
        authorizedMinSellPriceUsd:config.authorizedMinSellPriceUsd,
        note:"Temporary per-order authorization floor rejected the prepared short price",
      });
      return;
    }
  }

  // All decisions use fresh cross-margin state from the bank, plus protocol-side sizing.
  const [account,exposure,permission,activity,sizing]=await Promise.all([
    plane.marginAccount(market.marginBank,config.owner),
    plane.exposureUsd(),
    bot?(action.kind==="reduce"?bot.reduceAuthorized(market.poolAddress):bot.authorized(market.poolAddress)):Promise.resolve(false),
    api.activity(s.id),
    plane.maxPerpOrderSize({
      pool:market.poolAddress,marginBank:market.marginBank,account:config.owner,
      isBid:order.side==="long",price:order.price,autoPull:false,
    }),
  ]);
  const now=Date.now();
  const oldest=Math.min(...snaps.map(x=>Date.parse(x.observedAt)));
  const bookEvidence={blockNumber:book.blockNumber.toString(),bestBid:book.bestBid?.toString()??null,bestAsk:book.bestAsk?.toString()??null};
  const risk=checkRisk(rule,{
    nowMs:now,armed:s.state==="armed",engineHealthy:healthy&&leased,
    marketObservedAtMs:oldest,linkedBotPermission:permission,
    availableMarginUsd:Number(formatUnits(account.unlockedCollateralBalance,market.quoteDecimals)),
    currentExposureUsd:exposure,proposedNotionalUsd:order.notionalUsd,
    actionsToday:activity.actionsToday,actionsLifetime:activity.actionsLifetime,
    lastActionAtMs:activity.lastActionAt?Date.parse(activity.lastActionAt):undefined,
    marketPriceable:sizing.priceable&&sizing.placeable&&order.quantity<=sizing.maxQuantity,
    duplicate:false,reduciblePositionSize:Number(position<0n?-position:position),
  });
  if(!risk.allowed) {
    await record(s,versionId,event,"blocked",evaluation,{
      blockedBy:risk.blockedBy,protocolLimit:sizing.priceable?sizing.limitedBy??null:"unpriceable",book:bookEvidence,
    });
    return;
  }
  if(config.mode!=="live"||!config.liveOptIn) {
    await record(s,versionId,event,"observed",evaluation,{
      blockedBy:[],mode:config.mode,liveOptIn:config.liveOptIn,
      proposed:{market:action.market,side:order.side,quantity:order.quantity.toString(),
        price:order.price.toString(),notionalUsd:order.notionalUsd},book:bookEvidence,
      note:"Observed only. No signed transaction was submitted.",
    });
    return;
  }
  // An opposite-side IOC is not a protocol-guaranteed reduce-only instruction.
  // Remain fail-closed until the venue's linked-bot reduce-only path is proven.
  if(action.kind==="reduce") {
    await record(s,versionId,event,"blocked",evaluation,{
      blockedBy:["REDUCE_ONLY_NOT_VERIFIED"],
      note:"No linked-bot reduce-only exchange guarantee; observe-only for this action",
    });
    return;
  }
  if(!bot)throw new Error("Live mode missing linked bot");
  // Final fresh control-plane check. It can still race with a pause; minimize the window.
  const refreshed=await api.state();
  if(!leaseGeneration||refreshed.status.global_pause||refreshed.status.lease_holder!==config.instance||
    refreshed.status.lease_generation?.toString()!==leaseGeneration||
    !refreshed.strategies.some(x=>x.id===s.id&&x.current_version===s.current_version)) {
    await record(s,versionId,event,"blocked",evaluation,{blockedBy:["PAUSED"]});
    return;
  }
  const intent=await record(s,versionId,event,"observed",evaluation,{blockedBy:[],protocolSizing:"passed",book:bookEvidence});
  if(!intent.created)return; // No second order on an already-evaluated event.
  const key=intentKey(versionId,event.id,action);
  const reserved=await api.reserve({
    key,decisionId:intent.id,poolAddress:market.poolAddress,
    instance:config.instance,generation:leaseGeneration,
    action:{kind:action.kind,market:action.market,side:order.side,
      quantity:order.quantity.toString(),price:order.price.toString(),orderType:order.orderType},
  });
  const generation=leaseGeneration;
  if(!reserved.created||!reserved.id||!generation)return;
  const intentId=reserved.id;
  await api.intentStatus(intentId,{instance:config.instance,generation,status:"submitting",result:{note:"Reserved; signer about to submit"}});
  try {
    const result=await bot.place({
      pool:market.poolAddress,isBid:order.side==="long",price:order.price,
      quantity:order.quantity,orderType:order.orderType,
    },hash=>api.intentStatus(intentId,{instance:config.instance,generation,status:"submitted",txHash:hash,result:{broadcastAt:new Date().toISOString()}}).then(()=>{}));
    let orderState:"unknown"|"resting"|"partially_filled"|"filled"|"canceled"|"ioc_no_fill"|"reverted"=result.orderState;
    let reconciliation:Record<string,unknown>|undefined;
    if(result.receiptStatus==="success"&&result.orderId) {
      try {
        reconciliation=await plane.reconcileOrder(market.poolAddress,result.orderId);
        const indexed=reconciliation.indexed as {status?:string}|null;
        if(indexed?.status?.toLowerCase()==="open")orderState=result.fillCount?"partially_filled":"resting";
        else if(indexed?.status?.toLowerCase().includes("fill"))orderState="filled";
        else if(indexed?.status?.toLowerCase().includes("cancel")||indexed?.status?.toLowerCase().includes("expire"))orderState="canceled";
        else if(reconciliation.chainResting)orderState=result.fillCount?"partially_filled":"resting";
      } catch(err) {reconciliation={error:textError(err).slice(0,220),indexerOrChainRead:"unavailable"};orderState="unknown";}
    }
    const evidenceComplete=result.receiptStatus==="reverted"||
      (result.fillCount>0&&!result.orderId)||
      orderState==="ioc_no_fill"||
      Boolean(result.orderId&&orderState!=="unknown");
    await api.intentStatus(intentId,{instance:config.instance,generation,status:evidenceComplete?"reconciled":"unknown",
      txHash:result.hash,orderId:result.orderId,receiptStatus:result.receiptStatus,accepted:result.accepted,orderState,
      result:{fillCount:result.fillCount,receiptStatus:result.receiptStatus,reconciliation,note:"Receipt and protocol event evidence are recorded separately from fill state"},
      lastError:evidenceComplete?undefined:"Receipt succeeded without an order or fill event"});
    if(!evidenceComplete)healthy=false;
  } catch(err) {
    // Fail closed. A network timeout MAY mean broadcast already occurred.
    // Neither this intent nor this event is automatically retried.
    await api.intentStatus(intentId,{instance:config.instance,generation,status:"unknown",
      result:{reason:textError(err).slice(0,250),autoRetry:false},lastError:textError(err).slice(0,250),
    }).catch(()=>{});
    console.error("order uncertain; manual reconciliation required",reserved.id,textError(err));
    healthy=false;
  }
}

async function processEvent(event:Event) {
  const state=cachedState;
  if(!state||Date.now()-cachedStateAt>30_000||
    !state.strategies.some(s=>{
      const selected=rulesFor(s);
      return selected?.rule.trigger.market===event.market&&selected.rule.trigger.event===event.kind;
    }))return;
  const proof=await publicClient.getTransactionReceipt({hash:event.txHash});
  if(proof.status!=="success"||proof.blockNumber!==event.blockNumber)return;
  const head=await publicClient.getBlockNumber();
  seenBlock=head.toString();
  // Do not execute events replayed far behind head after a reconnect.
  if(head-event.blockNumber>maxEventLagBlocks) {
    console.warn("Ignoring stale/replayed log",event.id);
    return;
  }
  await api.event({
    id:event.id,market:event.market,kind:event.kind,
    blockNumber:event.blockNumber.toString(),txHash:event.txHash,
    logIndex:event.logIndex,observedAt:event.observedAt,
    captured:{source:"somnia-pool-log",receiptStatus:proof.status,head:head.toString()},
  });
  for(const s of state.strategies) {
    try {await processStrategy(s,event,state.status);}
    catch(err) {
      console.error("Failed closed for",s.id,event.id,textError(err));
      healthy=false;
    }
  }
}

function enqueueRawLog(market:ReturnType<SomniaPlane["pools"]>[number],log:Log) {
  if(!log.transactionHash||log.blockNumber===null||log.logIndex===null)return;
  let name:string;
  try {
    name=decodeEventLog({abi:observedPoolAbi,data:log.data,topics:log.topics}).eventName;
  } catch {return;}
  if(!acceptableEvents.has(name))return;
  const kind=name as Event["kind"];
  const event:Event={
    market:market.baseSymbol,kind,txHash:log.transactionHash,
    blockNumber:log.blockNumber,logIndex:log.logIndex,
    observedAt:new Date().toISOString(),
    id:`50383:${log.transactionHash.toLowerCase()}:${log.logIndex}`,
  };
  if(!interested(event))return;
  const key=`${event.market}:${event.kind}`;
  // Replacing an already-pending event is deliberate: it is the same
  // decision stream and the older event cannot be useful once a newer one is
  // available. A distinct-stream overflow still fails closed.
  if(!pendingEvents.has(key)&&queued>=100) {
    healthy=false;feedHealthy=false;console.error("Event queue saturated; live execution halted");
    return;
  }
  pendingEvents.set(key,event);
  refreshEventQueueSize();
  drainEventQueue();
}

function rawSubscription() {
  if(!cachedState||Date.now()-cachedStateAt>30_000)return null;
  const markets=new Set<Market>();
  const kinds=new Set<Event["kind"]>();
  for(const strategy of cachedState.strategies) {
    const selected=rulesFor(strategy);
    if(!selected)continue;
    markets.add(selected.rule.trigger.market);
    kinds.add(selected.rule.trigger.event);
  }
  return {
    markets:plane.pools().filter(m=>markets.has(m.baseSymbol)),
    kinds:[...kinds],
  };
}

async function pollRawLogs() {
  if(stopped||rawSuspended||rawPollRunning)return;
  rawPollRunning=true;
  try {
    const head=await publicClient.getBlockNumber();
    if(!cachedState||Date.now()-cachedStateAt>30_000) {
      // Do not build an unbounded backlog while the control-plane state is
      // unavailable. Re-anchor at the current head and keep live execution
      // fail-closed until the next healthy state refresh.
      rawNextBlock=head;
      rawFeedHealthy=false;feedHealthy=false;
      return;
    }
    if(rawNextBlock===null)rawNextBlock=head;
    const subscription=rawSubscription();
    if(!subscription||subscription.markets.length===0||subscription.kinds.length===0) {
      rawNextBlock=head+1n;
      rawFeedHealthy=true;refreshFeedHealth();
      return;
    }
    if(head>=rawNextBlock) {
      if(head-rawNextBlock>rawMaxCatchupBlocks) {
        rawSuspended=true;rawFeedHealthy=false;feedHealthy=false;
        console.error("Event recovery gap exceeds safe replay window; live execution remains suspended",{
          from:rawNextBlock.toString(),to:head.toString(),
        });
        return;
      }
      const toBlock=head<rawNextBlock+rawBatchBlocks-1n?head:rawNextBlock+rawBatchBlocks-1n;
      const markets=subscription.markets;
      const byPool=new Map(markets.map(m=>[m.poolAddress.toLowerCase(),m]));
      const logs=(await Promise.all(subscription.kinds.map(kind=>{
        const event=observedPoolAbi.find(fragment=>fragment.type==="event"&&fragment.name===kind);
        return publicClient.getLogs({
          address:markets.map(m=>m.poolAddress),fromBlock:rawNextBlock,toBlock,
          event,
        } as any);
      }))).flat() as Log[];
      for(const log of logs) {
        const market=byPool.get(log.address.toLowerCase());
        if(market)enqueueRawLog(market,log);
      }
      rawNextBlock=toBlock+1n;
    }
    rawFeedHealthy=true;
    refreshFeedHealth();
  } catch(err) {
    rawFeedHealthy=false;feedHealthy=false;
    console.error("Raw onchain log polling failed; live execution suspended",textError(err));
  } finally {
    rawPollRunning=false;
    if(!stopped&&!rawSuspended)rawPollTimer=setTimeout(()=>{
      rawPollTimer=null;void pollRawLogs();
    },2_000);
  }
}

function watchAllPools() {
  while(stopWatchers.length)stopWatchers.pop()?.();
  if(rawPollTimer)clearTimeout(rawPollTimer);
  rawPollTimer=null;rawNextBlock=null;rawSuspended=false;
  void pollRawLogs();
  stopWatchers.push(()=>{
    if(rawPollTimer)clearTimeout(rawPollTimer);
    rawPollTimer=null;rawSuspended=true;
  });
}

function refreshFeedHealth() {
  try {
    sdkTail=plane.client.getLiveStatus();
    const poolsReady=plane.pools().every(m=>plane.client.getWatchStatus(m.poolAddress)==="live");
    const perpReady=plane.client.getPerpPlaneStatus()==="live";
    sdkFeedHealthy=sdkTail.mode==="tailing"&&sdkTail.wsConnected&&
      !sdkTail.failure&&poolsReady&&perpReady;
  } catch(err) {
    sdkFeedHealthy=false;
    console.error("SDK live-tail health read failed",textError(err));
  }
  feedHealthy=rawFeedHealthy&&sdkFeedHealthy;
}

async function startSdkFeed() {
  const epoch=++sdkFeedEpoch;
  try {
    const handles=await Promise.all(plane.pools().map(m=>plane.client.watchMarket(m.poolAddress)));
    if(epoch!==sdkFeedEpoch||stopped) {
      handles.forEach(handle=>handle.stop());
      throw new Error("Somnia SDK live-tail start was superseded");
    }
    sdkWatchers.push(...handles);
    const perpWatcher=await plane.client.watchPerpMarkets({marginBank:plane.info("BTC").marginBank});
    if(epoch!==sdkFeedEpoch||stopped) {
      perpWatcher.stop();
      handles.forEach(handle=>handle.stop());
      throw new Error("Somnia SDK perp-tail start was superseded");
    }
    sdkPerpWatcher=perpWatcher;
    sdkLiveUnsubscribe=plane.client.subscribeLive(()=>refreshFeedHealth());
    refreshFeedHealth();
    if(!sdkFeedHealthy)throw new Error("Somnia SDK live tail did not reach a healthy state");
  } catch(err) {
    stopSdkFeed();
    throw err;
  }
}

function stopSdkFeed() {
  sdkFeedEpoch++;
  invokeSdkCleanup(()=>sdkLiveUnsubscribe?.(),"SDK live listener cleanup");
  sdkLiveUnsubscribe=null;
  invokeSdkCleanup(()=>sdkPerpWatcher?.stop(),"SDK perp watcher cleanup");
  sdkPerpWatcher=null;
  while(sdkWatchers.length)invokeSdkCleanup(()=>sdkWatchers.pop()?.stop(),"SDK market watcher cleanup");
  invokeSdkCleanup(()=>plane.client.stopLive(),"SDK live-tail shutdown");
  sdkFeedHealthy=false;
  feedHealthy=false;
}

async function startSdkFeedBounded() {
  let timer:NodeJS.Timeout|undefined;
  const task=startSdkFeed();
  // A timed-out hydration may reject after the supervisor has moved on. Keep
  // that late rejection from becoming an unhandled process-fatal error.
  task.catch(()=>undefined);
  try {
    await Promise.race([
      task,
      new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new Error(`Somnia SDK live-tail start exceeded ${sdkStartTimeoutMs}ms`)),sdkStartTimeoutMs);
      }),
    ]);
  } catch(err) {
    stopSdkFeed();
    throw err;
  } finally {
    if(timer)clearTimeout(timer);
  }
}

async function recoverSdkFeed() {
  if(sdkFeedHealthy)return;
  const now=Date.now();
  if(now-sdkReconnectAt<30_000)return;
  sdkReconnectAt=now;
  // Do not let the previous heartbeat's healthy flag survive a feed-recovery
  // window. The API must fail closed while the SDK tail is not live.
  healthy=false;feedHealthy=false;
  try {
    stopSdkFeed();
    await startSdkFeedBounded();
    console.info("Somnia SDK live tail recovered",plane.client.getLiveStatus());
  } catch(err) {
    sdkFeedHealthy=false;feedHealthy=false;healthy=false;
    console.error("Somnia SDK live tail unavailable; execution remains suspended",textError(err));
  }
}

async function reconcileUnresolved() {
  const {intents}=await api.unresolved();
  for(const intent of intents) {
    if(!intent.tx_hash) {
      console.error("Unresolved intent lacks tx hash; manual investigation required",intent.id);
      return false;
    }
    try {
      const receipt=await publicClient.getTransactionReceipt({hash:intent.tx_hash as `0x${string}`});
      let orderState:"unknown"|"resting"|"partially_filled"|"filled"|"canceled"|"ioc_no_fill"|"reverted"="unknown";
      let reconciliation:Record<string,unknown>|undefined;
      const action=intent.action as {market?:string;orderType?:number};
      let orderId=intent.order_id;
      let fillCount=Number(intent.result?.fillCount??0);
      if(receipt.status==="reverted")orderState="reverted";
      else if(action.market) {
        try {
          const market=plane.info(action.market as Market);
          const decoded=decodePlaceOrder(receipt,market.poolAddress);
          fillCount=decoded.fills.length;
          if(decoded.orderId)orderId=decoded.orderId.toString();
          if(!orderId&&fillCount===0&&action.orderType===2)orderState="ioc_no_fill";
          if(orderId) {
            reconciliation=await plane.reconcileOrder(market.poolAddress,orderId);
            const indexed=reconciliation.indexed as {status?:string}|null;
            if(indexed?.status?.toLowerCase()==="open")orderState=fillCount?"partially_filled":"resting";
            else if(indexed?.status?.toLowerCase().includes("fill"))orderState="filled";
            else if(indexed?.status?.toLowerCase().includes("cancel")||indexed?.status?.toLowerCase().includes("expire"))orderState="canceled";
            else if(reconciliation.chainResting)orderState=fillCount?"partially_filled":"resting";
          } else if(fillCount>0)orderState="filled";
        } catch(err) {reconciliation={error:textError(err).slice(0,220)};}
      }
      const evidence=receipt.status==="reverted"||orderState!=="unknown"||fillCount>0;
      await api.intentStatus(intent.id,{instance:config.instance,generation:leaseGeneration!,
        status:evidence?"reconciled":"unknown",txHash:intent.tx_hash,orderId:orderId??undefined,
        accepted:evidence&&receipt.status==="success"&&orderState!=="ioc_no_fill",orderState,
        result:{...intent.result,reconciledOnRestart:true,receiptStatus:receipt.status,reconciliation,fillCount,
          note:"Restart reconciliation uses receipt events, chain-head order state, and indexer history"},
        lastError:evidence?undefined:"Receipt exists but protocol order state is unresolved"});
      if(!evidence)return false;
    } catch {
      console.error("Unresolved hash not yet in chain; manual reconciliation",intent.id);
      return false;
    }
  }
  return true;
}
async function publishAccount() {
  const first=plane.pools()[0];
  if(!first)return;
  const data=await plane.marginAccount(first.marginBank,config.owner);
  const positions:{market:string;size:string;markUsd:number;notionalUsd:number;
    entryPriceUsd:number|null;unrealizedPnlUsd:number;accruedFundingUsd:number;
    equityContributionUsd:number;liquidationPriceUsd:number|null;priceable:boolean;asOfBlock:string}[]=[];
  for(const active of data.activePerpPools) {
    const pool=plane.pools().find(m=>m.poolAddress.toLowerCase()===active.toLowerCase());
    if(!pool)throw new Error("Unknown pool holds account collateral");
    const [analytics,liquidation]=await Promise.all([
      plane.positionAnalytics({marginBank:pool.marginBank,account:config.owner,pool:pool.poolAddress}),
      plane.liquidationPrice({marginBank:pool.marginBank,account:config.owner,pool:pool.poolAddress}).catch(()=>null),
    ]);
    if(!analytics.priceable)throw new Error("Active pool oracle unavailable");
    if(analytics.size===0n)continue;
    const size=Number(formatUnits(analytics.size,pool.baseDecimals));
    const markUsd=Number(formatUnits(analytics.markPrice,pool.quoteDecimals));
    positions.push({market:pool.baseSymbol,size:size.toString(),markUsd,notionalUsd:Number(formatUnits(analytics.notional,pool.quoteDecimals)),
      entryPriceUsd:Number(formatUnits(analytics.avgEntryPrice,pool.quoteDecimals)),
      unrealizedPnlUsd:Number(formatUnits(analytics.unrealizedPnl,pool.quoteDecimals)),
      accruedFundingUsd:Number(formatUnits(analytics.accruedFunding,pool.quoteDecimals)),
      equityContributionUsd:Number(formatUnits(analytics.equityContribution,pool.quoteDecimals)),
      liquidationPriceUsd:liquidation===null?null:Number(formatUnits(liquidation,pool.quoteDecimals)),
      priceable:true,asOfBlock:analytics.asOfBlock.toString()});
  }
  const openOrders=await plane.openOrders();
  const openOrderRows=openOrders.orders.map(order=>{
    const market=plane.pools().find(m=>m.poolAddress.toLowerCase()===order.pool.toLowerCase());
    if(!market)throw new Error("Unknown pool in open-order read");
    return {market:market.baseSymbol,orderId:order.orderId.toString(),isBid:order.isBid,
      priceUsd:Number(formatUnits(order.price,market.quoteDecimals)),quantity:formatUnits(order.fullQuantity,market.baseDecimals),
      quantityRemaining:formatUnits(order.quantityRemaining,market.baseDecimals),expireTimestampNs:order.expireTimestampNs.toString(),
      asOfBlock:openOrders.blockNumber.toString()};
  });
  let portfolioStatus:"authoritative"|"partial"="authoritative";
  if(Date.now()-protectiveStopsObservedAt>60_000) {
    try {
      const refreshed=await Promise.race([
        plane.protectiveStops(),
        new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("protective stop index timeout")),5_000)),
      ]);
      cachedProtectiveStops=refreshed as unknown as Record<string,unknown>[];
      protectiveStopsObservedAt=Date.now();
    } catch(err) {
      portfolioStatus="partial";
      console.warn("Protective stop index unavailable; no empty-list claim",textError(err));
    }
  }
  const protectiveStops=cachedProtectiveStops;
  await api.account({
    observedAt:new Date().toISOString(),
    equityUsd:Number(formatUnits(data.equity,first.quoteDecimals)),
    availableMarginUsd:Number(formatUnits(data.unlockedCollateralBalance,first.quoteDecimals)),
    lockedMarginUsd:Number(formatUnits(data.lockedCollateral,first.quoteDecimals)),
    marginStatus:String(data.marginStatus),positions,openOrders:openOrderRows,protectiveStops,
    portfolioStatus,asOfBlock:openOrders.blockNumber.toString(),
  });
}
async function publishMarkets() {
  // Keep the public Markets and Risk views populated from current SDK reads,
  // even when no armed rule is interested in the latest pool event. A failed
  // sample rejects the whole publication cycle; supervise() then withholds
  // the heartbeat so the lease expires instead of presenting stale data as
  // live execution input.
  const snapshots=await Promise.all(plane.pools().map(m=>plane.sample(m.baseSymbol)));
  await Promise.all(snapshots.map(snapshot=>api.market(snapshot)));
}

async function supervise() {
  while(!stopped) {
    try {
      const lease=await api.lease();
      leased=lease.acquired&&Boolean(lease.generation);
      leaseGeneration=leased?lease.generation:null;
      if(!leased){healthy=false;console.error("Lost singleton signing lease");}
      else {
        await recoverSdkFeed();
        await refreshState();
        seenBlock=(await publicClient.getBlockNumber()).toString();
        const clean=await reconcileUnresolved();
        refreshFeedHealth();
        healthy=clean && queued<100 && feedHealthy;
        await publishMarkets();
        await publishAccount();
        await api.heartbeat(leaseGeneration!,seenBlock,healthy?null:"Unresolved order or feed/queue issue");
      }
    } catch(err) {
      healthy=false;leased=false;console.error("Heartbeat/lease failed",textError(err));
    }
    await sleep(15_000);
  }
}

async function main() {
  console.info("THRYNT start",{
    chainId:50383,mode:config.mode,liveOptIn:config.liveOptIn,
    owner:config.owner,botAddress:bot?.address??null,
    expectedBotAddress:config.expectedBotAddress??null,
  });
  await startHealthServer();
  console.info("Health server listening",{port:config.healthPort});
  const actualChain=await publicClient.getChainId();
  if(actualChain!==50383)throw new Error(`Wrong chain ID: ${actualChain}`);
  const symbols=await plane.initialize();
  console.info("Verified live perps",symbols);
  const lease=await api.lease();
  leased=lease.acquired&&Boolean(lease.generation);
  leaseGeneration=leased?lease.generation:null;
  if(!leased)throw new Error("Another engine instance holds the lease");
  try {
    healthy=await reconcileUnresolved();
  } catch(err) {
    healthy=false;
    console.error("Initial reconciliation unavailable; execution remains suspended",textError(err));
  }
  try {
    await startSdkFeedBounded();
    console.info("Somnia SDK live-tail subscriptions",{
      markets:plane.pools().length,
      perpPlane:plane.client.getPerpPlaneStatus(),
      status:plane.client.getLiveStatus(),
    });
  } catch(err) {
    sdkFeedHealthy=false;feedHealthy=false;healthy=false;
    console.error("Initial Somnia SDK live tail unavailable; retrying in supervisor",textError(err));
  }
  // Load the control-plane state before starting raw-log recovery. Starting
  // the fallback poller first lets it observe an empty cache and then chase a
  // backlog while the first heartbeat is still in flight. On Hideki that can
  // exceed the bounded replay window and permanently suspend the raw feed.
  // The initial state read is a fail-closed startup gate, so the poller is
  // anchored at the current head only after its market/event subscription is
  // known.
  try {
    await refreshState();
    console.info("Initial execution state loaded",{
      strategyCount:cachedState?.strategies.length??0,
      loadedAt:new Date(cachedStateAt).toISOString(),
    });
  } catch(err) {
    cachedState=null;cachedStateAt=0;healthy=false;
    console.error("Initial control-plane state unavailable; retrying in supervisor",textError(err));
  }
  watchAllPools();
  console.info("Onchain pool log subscriptions",stopWatchers.length);
  await supervise();
}
async function shutdown(signal:string) {
  if(stopped)return;
  stopped=true;healthy=false;stopWatchers.forEach(f=>f());
  stopSdkFeed();
  if(rawPollTimer)clearTimeout(rawPollTimer);
  await stopHealthServer();
  try {await plane.close();} catch(err) {console.error("Shutdown close failed",textError(err));}
  console.info("THRYNT stopped",{signal});
}
process.once("SIGTERM",()=>{void shutdown("SIGTERM");});
process.once("SIGINT",()=>{void shutdown("SIGINT");});
main().catch(async err=>{
  console.error("FATAL THRYNT",textError(err));
  await shutdown("fatal");
  process.exitCode=1;
});

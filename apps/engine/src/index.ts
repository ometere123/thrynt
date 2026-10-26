import {decodeEventLog,formatUnits} from "viem";
import {perpPoolEventsAbi,orderBookEventsAbi} from "@somnia-chain/markets-sdk";
import {checkRisk,type Market,type MetricSnapshot,type Rule} from "@thrynt/core";
import {ThryntApi,type StoredStrategy} from "./api.js";
import {configFromEnv} from "./config.js";
import {decide,intentKey,prepareTrade} from "./decision.js";
import {SomniaPlane} from "./markets.js";
import {LinkedBot} from "./operator.js";

const config=configFromEnv();
const api=new ThryntApi(config);
const plane=new SomniaPlane(config);
const bot=config.botPrivateKey
  ?new LinkedBot(config.owner,config.botPrivateKey,plane.chain,config.rpc):null;
const publicClient=plane.client.getViemClient();
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const textError=(err:unknown)=>err instanceof Error?err.message:String(err);
const acceptableEvents=new Set(["FundingUpdated","OpenInterestUpdated","OrderPlaced"]);
const observedPoolAbi=[...perpPoolEventsAbi,...orderBookEventsAbi] as const;
type Event={
  id:string;market:Market;kind:"FundingUpdated"|"OpenInterestUpdated"|"OrderPlaced";
  txHash:`0x${string}`;blockNumber:bigint;logIndex:number;observedAt:string;
};
let stopped=false;
let leased=false;
let leaseGeneration:string|null=null;
let healthy=false;
let feedHealthy=true;
let seenBlock:string|null=null;
let queue=Promise.resolve();
let queued=0;
const stopWatchers:(()=>void)[]=[];
let restartTimer:ReturnType<typeof setTimeout>|null=null;

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
  let order;
  try {order=prepareTrade(rule,snap,market,position);}
  catch(err) {
    await record(s,versionId,event,"blocked",evaluation,{blockedBy:["SIZE_INVALID"],detail:textError(err)});
    return;
  }

  // All decisions use fresh cross-margin state from the bank, plus protocol-side sizing.
  const [account,exposure,permission,activity,sizing]=await Promise.all([
    plane.client.getMarginAccount(market.marginBank,config.owner),
    plane.exposureUsd(),
    bot?(action.kind==="reduce"?bot.reduceAuthorized(market.poolAddress):bot.authorized(market.poolAddress)):Promise.resolve(false),
    api.activity(s.id),
    plane.client.getMaxPerpOrderSize({
      pool:market.poolAddress,marginBank:market.marginBank,account:config.owner,
      isBid:order.side==="long",price:order.price,autoPull:false,
    }),
  ]);
  const now=Date.now();
  const oldest=Math.min(...snaps.map(x=>Date.parse(x.observedAt)));
  const risk=checkRisk(rule,{
    nowMs:now,armed:s.state==="armed",engineHealthy:healthy&&leased,
    marketObservedAtMs:oldest,linkedBotPermission:permission,
    availableMarginUsd:Number(formatUnits(account.unlockedCollateralBalance,market.quoteDecimals)),
    currentExposureUsd:exposure,proposedNotionalUsd:order.notionalUsd,
    actionsToday:activity.actionsToday,
    lastActionAtMs:activity.lastActionAt?Date.parse(activity.lastActionAt):undefined,
    marketPriceable:sizing.priceable&&sizing.placeable&&order.quantity<=sizing.maxQuantity,
    duplicate:false,reduciblePositionSize:Number(position<0n?-position:position),
  });
  if(!risk.allowed) {
    await record(s,versionId,event,"blocked",evaluation,{
      blockedBy:risk.blockedBy,protocolLimit:sizing.priceable?sizing.limitedBy??null:"unpriceable",
    });
    return;
  }
  if(config.mode!=="live"||!config.liveOptIn) {
    await record(s,versionId,event,"observed",evaluation,{
      blockedBy:[],mode:config.mode,liveOptIn:config.liveOptIn,
      proposed:{market:action.market,side:order.side,quantity:order.quantity.toString(),
        price:order.price.toString(),notionalUsd:order.notionalUsd},
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
  const intent=await record(s,versionId,event,"observed",evaluation,{blockedBy:[],protocolSizing:"passed"});
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
    let orderState:"unknown"|"resting"|"partially_filled"|"filled"|"canceled"|"reverted"=result.orderState;
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
  const proof=await publicClient.getTransactionReceipt({hash:event.txHash});
  if(proof.status!=="success"||proof.blockNumber!==event.blockNumber)return;
  const head=await publicClient.getBlockNumber();
  seenBlock=head.toString();
  // Do not execute events replayed far behind head after a reconnect.
  if(head-event.blockNumber>3n) {
    console.warn("Ignoring stale/replayed log",event.id);
    return;
  }
  const snapshot=await api.state();
  await api.event({
    id:event.id,market:event.market,kind:event.kind,
    blockNumber:event.blockNumber.toString(),txHash:event.txHash,
    logIndex:event.logIndex,observedAt:event.observedAt,
    captured:{source:"somnia-pool-log",receiptStatus:proof.status,head:head.toString()},
  });
  for(const s of snapshot.strategies) {
    try {await processStrategy(s,event,snapshot.status);}
    catch(err) {
      console.error("Failed closed for",s.id,event.id,textError(err));
      healthy=false;
    }
  }
}

function watchAllPools() {
  while(stopWatchers.length)stopWatchers.pop()?.();
  for(const market of plane.pools()) {
    const stop=publicClient.watchEvent({
      address:market.poolAddress,
      onLogs:logs=>{
        for(const log of logs) {
          if(!log.transactionHash||log.blockNumber===null||log.logIndex===null)continue;
          let name:string;
          try {
            name=decodeEventLog({abi:observedPoolAbi,data:log.data,topics:log.topics}).eventName;
          } catch {continue;}
          if(!acceptableEvents.has(name))continue;
          const kind=name as Event["kind"];
          const event:Event={
            market:market.baseSymbol,kind,txHash:log.transactionHash,
            blockNumber:log.blockNumber,logIndex:log.logIndex,
            observedAt:new Date().toISOString(),
            id:`50383:${log.transactionHash.toLowerCase()}:${log.logIndex}`,
          };
          if(queued>=100) {
            healthy=false;feedHealthy=false;console.error("Event queue saturated; live execution halted");
            break;
          }
          queued++;
          queue=queue.then(()=>processEvent(event)).catch(err=>{
            healthy=false;console.error("event handler error",textError(err));
          }).finally(()=>{queued--;});
        }
      },
      onError:error=>{
        healthy=false;feedHealthy=false;
        console.error("WS stream unhealthy; restart after verifying chain recovery",textError(error));
        if(!restartTimer&&!stopped) {
          restartTimer=setTimeout(async()=>{
            restartTimer=null;
            try {
              const head=await publicClient.getBlockNumber();
              if(seenBlock&&head-BigInt(seenBlock)>3n) {
                console.error("Event recovery gap exceeds safe replay window; live execution remains suspended",{from:seenBlock,to:head.toString()});
                return;
              }
              watchAllPools();feedHealthy=true;
              console.info("Somnia event subscriptions restarted after a bounded gap");
            } catch(err) {console.error("Event subscription recovery failed",textError(err));}
          },5_000);
        }
      },
    });
    stopWatchers.push(stop);
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
      let orderState:"unknown"|"resting"|"partially_filled"|"filled"|"canceled"|"reverted"="unknown";
      let reconciliation:Record<string,unknown>|undefined;
      const action=intent.action as {market?:string};
      if(receipt.status==="reverted")orderState="reverted";
      else if(intent.order_id&&action.market) {
        try {
          const market=plane.info(action.market as Market);
          reconciliation=await plane.reconcileOrder(market.poolAddress,intent.order_id);
          const indexed=reconciliation.indexed as {status?:string}|null;
          if(indexed?.status?.toLowerCase()==="open")orderState="resting";
          else if(indexed?.status?.toLowerCase().includes("fill"))orderState="filled";
          else if(indexed?.status?.toLowerCase().includes("cancel")||indexed?.status?.toLowerCase().includes("expire"))orderState="canceled";
          else if(reconciliation.chainResting)orderState="resting";
        } catch(err) {reconciliation={error:textError(err).slice(0,220)};}
      }
      const fillCount=Number(intent.result?.fillCount??0);
      const evidence=receipt.status==="reverted"||orderState!=="unknown"||fillCount>0;
      await api.intentStatus(intent.id,{instance:config.instance,generation:leaseGeneration!,
        status:evidence?"reconciled":"unknown",txHash:intent.tx_hash,
        accepted:evidence&&receipt.status==="success",orderState,
        result:{...intent.result,reconciledOnRestart:true,receiptStatus:receipt.status,reconciliation,
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
  const data=await plane.client.getMarginAccount(first.marginBank,config.owner);
  const positions:{market:string;size:string;markUsd:number;notionalUsd:number}[]=[];
  for(const active of data.activePerpPools) {
    const pool=plane.pools().find(m=>m.poolAddress.toLowerCase()===active.toLowerCase());
    if(!pool)throw new Error("Unknown pool holds account collateral");
    const [position,price]=await Promise.all([
      plane.client.getPerpPosition({marginBank:pool.marginBank,account:config.owner,pool:pool.poolAddress}),
      plane.client.getPerpHealthSnapshot(pool.poolAddress),
    ]);
    if(!price.priceable)throw new Error("Active pool oracle unavailable");
    const size=Number(formatUnits(position.size,pool.baseDecimals));
    const markUsd=Number(formatUnits(price.markPrice,18));
    positions.push({market:pool.baseSymbol,size:size.toString(),markUsd,notionalUsd:Math.abs(size)*markUsd});
  }
  await api.account({
    observedAt:new Date().toISOString(),
    equityUsd:Number(formatUnits(data.equity,first.quoteDecimals)),
    availableMarginUsd:Number(formatUnits(data.unlockedCollateralBalance,first.quoteDecimals)),
    lockedMarginUsd:Number(formatUnits(data.lockedCollateral,first.quoteDecimals)),
    marginStatus:String(data.marginStatus),positions,
  });
}

async function supervise() {
  while(!stopped) {
    try {
      const lease=await api.lease();
      leased=lease.acquired&&Boolean(lease.generation);
      leaseGeneration=leased?lease.generation:null;
      if(!leased){healthy=false;console.error("Lost singleton signing lease");}
      else {
        seenBlock=(await publicClient.getBlockNumber()).toString();
        const clean=await reconcileUnresolved();
        healthy=clean && queued<100 && feedHealthy;
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
  });
  const actualChain=await publicClient.getChainId();
  if(actualChain!==50383)throw new Error(`Wrong chain ID: ${actualChain}`);
  const symbols=await plane.initialize();
  console.info("Verified live perps",symbols);
  const lease=await api.lease();
  leased=lease.acquired&&Boolean(lease.generation);
  leaseGeneration=leased?lease.generation:null;
  if(!leased)throw new Error("Another engine instance holds the lease");
  healthy=await reconcileUnresolved();
  watchAllPools();
  console.info("Onchain pool log subscriptions",stopWatchers.length);
  await supervise();
}
process.on("SIGTERM",()=>{stopped=true;healthy=false;stopWatchers.forEach(f=>f());});
process.on("SIGINT",()=>{stopped=true;healthy=false;stopWatchers.forEach(f=>f());});
main().catch(async err=>{
  console.error("FATAL THRYNT",textError(err));
  try{await plane.close();}catch{}
  process.exitCode=1;
});

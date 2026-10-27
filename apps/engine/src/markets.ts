import {
  SomniaMarkets,SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  type BookTopsOnchain,type MarginAccount,type OnchainOrder,
  type PerpFeedStatus,type PerpHealthSnapshot,type PerpMaxOrderSize,
  type PerpPosition,type PerpPositionRef,type PerpStateOnchain,
} from "@somnia-chain/markets-sdk";
import {hidekiTestnet} from "@somnia-chain/markets-sdk/chains";
import {createPublicClient,formatUnits,http} from "viem";
import type {PublicClient} from "viem";
import type {Market,MetricSnapshot} from "@thrynt/core";
import type {EngineConfig} from "./config.js";

export interface MarketInfo {
  poolAddress:`0x${string}`;marginBank:`0x${string}`;baseSymbol:Market;
  baseDecimals:number;quoteDecimals:number;
  tickSize:bigint;lotSize:bigint;minQuantity:bigint;
}
export interface OrderBookTop {
  blockNumber:bigint;
  bestBid:bigint|null;
  bestAsk:bigint|null;
}
export function numberRaw(raw:bigint|string,decimals:number):number {
  return Number(formatUnits(BigInt(raw),decimals));
}
export function downToGrid(value:bigint,step:bigint):bigint {
  if(step<=0n)throw new Error("Invalid market grid size");
  return (value/step)*step;
}
export function upToGrid(value:bigint,step:bigint):bigint {
  if(step<=0n)throw new Error("Invalid market grid size");
  return ((value+step-1n)/step)*step;
}

type SdkHttpReads={
  getBookTopsOnchain:(markets:{id:string;poolAddress:`0x${string}`}[],client:PublicClient)=>Promise<BookTopsOnchain>;
  getOrderOnchain:(pool:`0x${string}`,orderId:bigint,client:PublicClient)=>Promise<OnchainOrder|null>;
  getMarginAccount:(marginBank:`0x${string}`,account:`0x${string}`,client:PublicClient)=>Promise<MarginAccount>;
  getMaxPerpOrderSize:(params:{
    pool:`0x${string}`;marginBank:`0x${string}`;account:`0x${string}`;
    isBid:boolean;price:bigint;autoPull?:boolean;builderFeeBpsTimes1k?:bigint;
  },client:PublicClient)=>Promise<PerpMaxOrderSize>;
  getPerpHealthSnapshot:(pool:`0x${string}`,client:PublicClient)=>Promise<PerpHealthSnapshot>;
  getPerpState:(pool:`0x${string}`,client:PublicClient)=>Promise<PerpStateOnchain>;
  getPerpFeedStatus:(pool:`0x${string}`,client:PublicClient)=>Promise<PerpFeedStatus>;
  getPerpPosition:(ref:PerpPositionRef,client:PublicClient)=>Promise<PerpPosition>;
};

// 0.32.1 keeps these connection-scoped helpers private to the SDK barrel.
// Load the pinned installed artifact rather than copying its ABI/decoding code.
// The production image preserves the monorepo node_modules layout.
const sdkDist=new URL("../../../node_modules/@somnia-chain/markets-sdk/dist/",import.meta.url);
const sdkHttpReads:Promise<SdkHttpReads>=Promise.all([
  import(new URL("./orders.js",sdkDist).href),
  import(new URL("./perp/margin.js",sdkDist).href),
  import(new URL("./perp/state.js",sdkDist).href),
]).then(([orders,margin,state])=>({
  getBookTopsOnchain:orders.getBookTopsOnchain,
  getOrderOnchain:orders.getOrderOnchain,
  getMarginAccount:margin.getMarginAccount,
  getMaxPerpOrderSize:margin.getMaxPerpOrderSize,
  getPerpHealthSnapshot:margin.getPerpHealthSnapshot,
  getPerpState:state.getPerpState,
  getPerpFeedStatus:state.getPerpFeedStatus,
  getPerpPosition:state.getPerpPosition,
} as SdkHttpReads));

export class SomniaPlane {
  readonly sdk:SomniaMarkets;
  readonly httpClient:PublicClient;
  private marketMap=new Map<Market,MarketInfo>();
  constructor(private readonly config:EngineConfig) {
    this.sdk=new SomniaMarkets({
      chain:hidekiTestnet,wsRpcUrl:config.ws,indexerUrl:config.indexer,
      addresses:SOMNIA_HIDEKI_TESTNET_ADDRESSES,account:config.owner,
    });
    // Hideki can keep live subscriptions connected while WebSocket chain
    // reads time out. Keep the feed on the SDK's WS transport, but use the
    // configured HTTP RPC for authoritative snapshots. HTTP failures throw.
    this.httpClient=createPublicClient({
      chain:hidekiTestnet,
      transport:http(config.rpc,{timeout:15_000}),
      pollingInterval:2_000,
    });
  }
  get chain(){return hidekiTestnet;}
  get client(){return this.sdk.client;}
  async initialize() {
    const markets=await this.sdk.client.listPerpMarkets();
    this.marketMap.clear();
    for(const market of markets) {
      if(!market.baseSymbol||!["BTC","ETH","SOL","XRP","DOGE"].includes(market.baseSymbol))continue;
      this.marketMap.set(market.baseSymbol as Market,{
        poolAddress:market.poolAddress,marginBank:market.marginBank,
        baseSymbol:market.baseSymbol as Market,
        baseDecimals:market.baseDecimals,quoteDecimals:market.quoteDecimals,
        tickSize:BigInt(market.tickSize),lotSize:BigInt(market.lotSize),
        minQuantity:BigInt(market.minQuantity),
      });
    }
    if(this.marketMap.size===0)throw new Error("No DreamDEX perp markets returned on Hideki");
    return [...this.marketMap.keys()];
  }
  info(symbol:Market):MarketInfo {
    const market=this.marketMap.get(symbol);
    if(!market)throw new Error(`Perp market ${symbol} not available on Hideki`);
    return market;
  }
  async topOfBook(symbol:Market):Promise<OrderBookTop> {
    const market=this.info(symbol);
    const reads=await sdkHttpReads;
    const result=await reads.getBookTopsOnchain([{
      id:symbol,poolAddress:market.poolAddress,
    }],this.httpClient);
    const top=result.tops[symbol.toLowerCase()];
    return {
      blockNumber:result.blockNumber,
      bestBid:top?.bestBid?BigInt(top.bestBid):null,
      bestAsk:top?.bestAsk?BigInt(top.bestAsk):null,
    };
  }
  pools(){return [...this.marketMap.values()];}
  async sample(symbol:Market):Promise<MetricSnapshot> {
    const market=this.info(symbol);
    const reads=await sdkHttpReads;
    const [health,state,account,feed,block]=await Promise.all([
      reads.getPerpHealthSnapshot(market.poolAddress,this.httpClient),
      reads.getPerpState(market.poolAddress,this.httpClient),
      reads.getMarginAccount(market.marginBank,this.config.owner,this.httpClient),
      reads.getPerpFeedStatus(market.poolAddress,this.httpClient),
      this.httpClient.getBlockNumber(),
    ]);
    if(!health.priceable||!feed.markPriceOk||feed.markPrice<=0n)
      throw new Error(`Stale/unpriceable oracle on ${symbol}`);
    const markUsd=numberRaw(health.markPrice,18);
    const indexUsd=numberRaw(state.indexPrice,18);
    if(!(markUsd>0&&indexUsd>0))throw new Error("Invalid mark/index");
    const window=Number(state.fundingWindowSec);
    if(!(window>0))throw new Error("Funding window unavailable");
    const fundingBps8h=Number(state.fundingRate)/1e18*10_000*(28_800/window);
    const availableMarginUsd=numberRaw(account.unlockedCollateralBalance,market.quoteDecimals);
    const mm=Number(account.mmReq);
    const equity=Number(account.equity);
    const marginRatioBps=mm>0?equity/mm*10_000:1_000_000_000;
    // The pool counts matched OI once, in base units.
    const openInterestUsd=numberRaw(state.openInterest,market.baseDecimals)*markUsd;
    const snap:MetricSnapshot={
      market:symbol,observedAt:new Date().toISOString(),blockNumber:block.toString(),
      markUsd,indexUsd,premiumBps:(markUsd/indexUsd-1)*10_000,
      fundingBps8h,openInterestUsd,availableMarginUsd,marginRatioBps,
    };
    if(!Object.values(snap).every(v=>typeof v!=="number"||Number.isFinite(v)))
      throw new Error("Nonfinite market measurement");
    return snap;
  }
  async exposureUsd() {
    // Fail closed on unsupported held pools: no fabricated zero exposure.
    const markets=this.pools();
    if(markets.length===0)throw new Error("Market set unavailable");
    const primary=markets[0]!;
    const account=await this.marginAccount(primary.marginBank,this.config.owner);
    const active=account.activePerpPools as `0x${string}`[];
    let total=0;
    for(const pool of active) {
      const market=markets.find(m=>m.poolAddress.toLowerCase()===pool.toLowerCase());
      if(!market)throw new Error("Cannot value position on unknown pool");
      const [position,health]=await Promise.all([
        this.position({marginBank:market.marginBank,account:this.config.owner,pool}),
        this.health(pool),
      ]);
      if(!health.priceable)throw new Error("Active position on unpriceable market");
      const units=Math.abs(numberRaw(position.size,market.baseDecimals));
      total+=units*numberRaw(health.markPrice,18);
    }
    return total;
  }
  async reducible(symbol:Market) {
    const m=this.info(symbol);
    const position=await this.position({
      marginBank:m.marginBank,account:this.config.owner,pool:m.poolAddress,
    });
    return BigInt(position.size);
  }
  async marginAccount(marginBank:`0x${string}`,account:`0x${string}`) {
    const reads=await sdkHttpReads;
    return reads.getMarginAccount(marginBank,account,this.httpClient);
  }
  async maxPerpOrderSize(params:{
    pool:`0x${string}`;marginBank:`0x${string}`;account:`0x${string}`;
    isBid:boolean;price:bigint;autoPull?:boolean;builderFeeBpsTimes1k?:bigint;
  }) {
    const reads=await sdkHttpReads;
    return reads.getMaxPerpOrderSize(params,this.httpClient);
  }
  async position(ref:{marginBank:`0x${string}`;account:`0x${string}`;pool:`0x${string}`}) {
    const reads=await sdkHttpReads;
    return reads.getPerpPosition(ref,this.httpClient);
  }
  async health(pool:`0x${string}`) {
    const reads=await sdkHttpReads;
    return reads.getPerpHealthSnapshot(pool,this.httpClient);
  }
  async reconcileOrder(poolAddress:`0x${string}`,orderId:string) {
    const id=BigInt(orderId);
    const reads=await sdkHttpReads;
    const [onchain,history]=await Promise.all([
      reads.getOrderOnchain(poolAddress,id,this.httpClient),
      this.sdk.client.listPerpOrderHistory(this.config.owner,{pool:poolAddress,limit:100}),
    ]);
    const indexed=history.find(row=>row.orderId===orderId)??null;
    return {chainResting:Boolean(onchain),indexed:indexed?{
      status:indexed.status,rested:indexed.rested,filledQuantity:indexed.filledQuantity,
      quantityRemaining:indexed.quantityRemaining,cancelReason:indexed.cancelReason,
    }:null};
  }
  async close() {await this.sdk.close();}
}

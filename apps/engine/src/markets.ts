import {
  SomniaMarkets,SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  type PerpMarket as SdkPerpMarket,
} from "@somnia-chain/markets-sdk";
import {hidekiTestnet} from "@somnia-chain/markets-sdk/chains";
import {formatUnits} from "viem";
import type {Market,MetricSnapshot} from "@thrynt/core";
import type {EngineConfig} from "./config.js";

export interface MarketInfo {
  poolAddress:`0x${string}`;marginBank:`0x${string}`;baseSymbol:Market;
  baseDecimals:number;quoteDecimals:number;
  tickSize:bigint;lotSize:bigint;minQuantity:bigint;
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

export class SomniaPlane {
  readonly sdk:SomniaMarkets;
  private marketMap=new Map<Market,MarketInfo>();
  constructor(private readonly config:EngineConfig) {
    this.sdk=new SomniaMarkets({
      chain:hidekiTestnet,wsRpcUrl:config.ws,indexerUrl:config.indexer,
      addresses:SOMNIA_HIDEKI_TESTNET_ADDRESSES,account:config.owner,
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
  pools(){return [...this.marketMap.values()];}
  async sample(symbol:Market):Promise<MetricSnapshot> {
    const market=this.info(symbol);
    const [health,state,account,feed,block]=await Promise.all([
      this.sdk.client.getPerpHealthSnapshot(market.poolAddress),
      this.sdk.client.getPerpState(market.poolAddress),
      this.sdk.client.getMarginAccount(market.marginBank,this.config.owner),
      this.sdk.client.getPerpFeedStatus(market.poolAddress),
      this.sdk.client.getViemClient().getBlockNumber(),
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
    const account=await this.client.getMarginAccount(primary.marginBank,this.config.owner);
    const active=account.activePerpPools as `0x${string}`[];
    let total=0;
    for(const pool of active) {
      const market=markets.find(m=>m.poolAddress.toLowerCase()===pool.toLowerCase());
      if(!market)throw new Error("Cannot value position on unknown pool");
      const [position,health]=await Promise.all([
        this.client.getPerpPosition({marginBank:market.marginBank,account:this.config.owner,pool}),
        this.client.getPerpHealthSnapshot(pool),
      ]);
      if(!health.priceable)throw new Error("Active position on unpriceable market");
      const units=Math.abs(numberRaw(position.size,market.baseDecimals));
      total+=units*numberRaw(health.markPrice,18);
    }
    return total;
  }
  async reducible(symbol:Market) {
    const m=this.info(symbol);
    const position=await this.client.getPerpPosition({
      marginBank:m.marginBank,account:this.config.owner,pool:m.poolAddress,
    });
    return BigInt(position.size);
  }
  async close() {await this.sdk.close();}
}

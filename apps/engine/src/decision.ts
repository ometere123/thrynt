import {createHash} from "node:crypto";
import {parseUnits} from "viem";
import {checkRisk,evaluate,validateRule,type Market,type MetricSnapshot,type Rule} from "@thrynt/core";
import type {MarketInfo} from "./markets.js";

export function intentKey(version:string,eventId:string,action:unknown) {
  return createHash("sha256").update(JSON.stringify([version,eventId,action])).digest("hex");
}
export interface PreparedOrder {
  market:Market;side:"long"|"short";quantity:bigint;price:bigint;notionalUsd:number;
  orderType:2|3;
}
export function prepareTrade(
  rule:Rule,snapshot:MetricSnapshot,info:MarketInfo,
  reduciblePosition=0n,
):PreparedOrder {
  const action=rule.action;
  if(action.kind!=="trade"&&action.kind!=="reduce")throw new Error("No exchange order action");
  if(snapshot.market!==action.market||info.baseSymbol!==action.market)
    throw new Error("Market/snapshot mismatch");
  let quantity:bigint;
  let side:"long"|"short";
  if(action.kind==="trade") {
    quantity=parseUnits(action.quantity,info.baseDecimals);
    side=action.side;
  } else {
    if(reduciblePosition===0n)throw new Error("Nothing to reduce");
    side=reduciblePosition>0n?"short":"long";
    const abs=reduciblePosition<0n?-reduciblePosition:reduciblePosition;
    quantity=abs*BigInt(action.percent)/100n;
  }
  if(info.lotSize<=0n||info.tickSize<=0n)throw new Error("Market grid invalid");
  quantity=quantity/info.lotSize*info.lotSize;
  if(quantity<info.minQuantity)throw new Error("Quantity below market minimum");
  const slip=action.slippageBps;
  const reference=parseUnits(snapshot.markUsd.toFixed(8),18);
  const raw=side==="long"
    ? reference*BigInt(10_000+slip)/10_000n
    : reference*BigInt(10_000-slip)/10_000n;
  const price=side==="long"
    ? ((raw+info.tickSize-1n)/info.tickSize)*info.tickSize
    : (raw/info.tickSize)*info.tickSize;
  if(price<=0n)throw new Error("Order price invalid");
  const notionalUsd=Number(quantity)/10**info.baseDecimals*snapshot.markUsd;
  if(!Number.isFinite(notionalUsd)||notionalUsd<=0)throw new Error("Invalid trade notional");
  return {market:action.market,side,quantity,price,notionalUsd,
    orderType:action.kind==="trade"&&action.orderType==="POST_ONLY"?3:2};
}

export function decide(rule:Rule,snapshots:MetricSnapshot[]) {
  const check=validateRule(rule);
  if(!check.valid||!check.rule)throw new Error(`Invalid stored rule: ${check.errors.join("; ")}`);
  return evaluate(check.rule,snapshots);
}
export {checkRisk};

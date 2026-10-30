import {formatUnits} from "viem";
import type {MarketInfo,OrderBookTop} from "./markets.js";

export type PositionSide="long"|"short";

export interface BestEffortClosePlan {
  side:PositionSide;
  quantity:bigint;
  price:bigint;
  notionalUsd:number;
  positionSize:bigint;
  effectiveReducingCapacity:bigint;
  bookBlock:bigint;
  guaranteedReduceOnly:false;
  reversalRisk:"possible-if-position-changes-before-fill";
}

function down(value:bigint,step:bigint) {
  if(step<=0n)throw new Error("Market lot/tick grid invalid");
  return value/step*step;
}
function up(value:bigint,step:bigint) {
  if(step<=0n)throw new Error("Market lot/tick grid invalid");
  return (value+step-1n)/step*step;
}

/**
 * Build a bounded opposite-side IOC plan for an existing position.
 *
 * This is intentionally only a plan. DreamDEX's linked-bot route has no
 * reduce-only flag, so callers must obtain a separate owner authorization,
 * reserve a durable intent, re-read capacity immediately before broadcast and
 * reconcile the resulting position. The engine's autonomous strategy path
 * remains disabled for this route.
 */
export function planBestEffortClose(input:{
  positionSize:bigint;
  effectiveReducingCapacity:bigint;
  percent:number;
  maxSlippageBps:number;
  book:OrderBookTop;
  info:MarketInfo;
  maxNotionalUsd?:number;
}):BestEffortClosePlan {
  const {positionSize,effectiveReducingCapacity,percent,maxSlippageBps,book,info}=input;
  if(positionSize===0n)throw new Error("Nothing to close");
  if(effectiveReducingCapacity<=0n)throw new Error("No reducing capacity available");
  if(!Number.isInteger(percent)||percent<1||percent>100)throw new Error("Close percentage invalid");
  if(!Number.isInteger(maxSlippageBps)||maxSlippageBps<0||maxSlippageBps>50)
    throw new Error("Close slippage invalid");
  const side:PositionSide=positionSize>0n?"short":"long";
  const executable=side==="long"?book.bestAsk:book.bestBid;
  if(executable===null)throw new Error(`No executable ${side} side in the order book`);
  const absolute=positionSize<0n?-positionSize:positionSize;
  const capacity=effectiveReducingCapacity<absolute?effectiveReducingCapacity:absolute;
  const quantity=down(capacity*BigInt(percent)/100n,info.lotSize);
  if(quantity<=0n||quantity<info.minQuantity)throw new Error("Close quantity below market minimum");
  const raw=side==="long"
    ? executable*BigInt(10_000+maxSlippageBps)/10_000n
    : executable*BigInt(10_000-maxSlippageBps)/10_000n;
  const price=side==="long"?up(raw,info.tickSize):down(raw,info.tickSize);
  if(price<=0n)throw new Error("Close price invalid");
  const notionalUsd=Number(quantity)/10**info.baseDecimals*
    Number(formatUnits(price,info.quoteDecimals));
  if(!Number.isFinite(notionalUsd)||notionalUsd<=0)throw new Error("Close notional invalid");
  if(input.maxNotionalUsd!==undefined&&notionalUsd>input.maxNotionalUsd)
    throw new Error("Close notional exceeds bounded limit");
  return {side,quantity,price,notionalUsd,positionSize,
    effectiveReducingCapacity:capacity,bookBlock:book.blockNumber,
    guaranteedReduceOnly:false,reversalRisk:"possible-if-position-changes-before-fill"};
}

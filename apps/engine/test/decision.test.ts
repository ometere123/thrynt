import {describe,expect,it} from "vitest";
import {templates} from "@thrynt/core";
import {parseUnits} from "viem";
import {intentKey,prepareTrade} from "../src/decision.js";

describe("order preparation",()=>{
  const input={market:"ETH" as const,observedAt:new Date().toISOString(),blockNumber:"99",
    markUsd:4000,indexUsd:3990,premiumBps:25,fundingBps8h:2,
    openInterestUsd:1e6,availableMarginUsd:200,marginRatioBps:50000};
  const info={baseSymbol:"ETH" as const,baseDecimals:18,quoteDecimals:18,
    poolAddress:"0x1111111111111111111111111111111111111111" as const,
    marginBank:"0x2222222222222222222222222222222222222222" as const,
    tickSize:1000000000000000n,lotSize:1000000000000000n,minQuantity:1000000000000000n};
  it("aligns order to the pool tick/lot and never exceeds configured price band",()=>{
    const p=prepareTrade(templates()[0]!,input,info);
    expect(p.quantity%info.lotSize).toBe(0n);
    expect(p.price%info.tickSize).toBe(0n);
    expect(p.side).toBe("short");
    expect(p.orderType).toBe(2);
  });
  it("uses a deterministic intent identity",()=>{
    expect(intentKey("v1","evt",{})).toBe(intentKey("v1","evt",{}));
    expect(intentKey("v2","evt",{})).not.toBe(intentKey("v1","evt",{}));
  });
  it("refuses a nonsensical reduction",()=>{
    const rule=templates()[0]!;
    rule.action={kind:"reduce",market:"ETH",percent:50,slippageBps:10};
    expect(()=>prepareTrade(rule,input,info,0n)).toThrow("Nothing to reduce");
  });
  it("uses the fresh best bid as a side-aware short execution floor",()=>{
    const book={blockNumber:99n,bestBid:parseUnits("4000",18),bestAsk:parseUnits("4001",18)};
    const p=prepareTrade(templates()[0]!,input,info,0n,book);
    expect(p.price).toBeLessThanOrEqual(book.bestBid);
    expect(p.notionalUsd).toBeCloseTo(0.004*4000,8);
  });
  it("uses the fresh best ask as a side-aware long execution ceiling",()=>{
    const rule=structuredClone(templates()[0]!);
    if(rule.action.kind!=="trade")throw new Error("expected trade template");
    rule.action.side="long";
    const book={blockNumber:99n,bestBid:parseUnits("3999",18),bestAsk:parseUnits("4000",18)};
    const p=prepareTrade(rule,input,info,0n,book);
    expect(p.price).toBeGreaterThanOrEqual(book.bestAsk);
  });
  it("fails closed when the executable side of the book is empty",()=>{
    const book={blockNumber:99n,bestBid:null,bestAsk:parseUnits("4001",18)};
    expect(()=>prepareTrade(templates()[0]!,input,info,0n,book)).toThrow("No executable short side");
  });
  it("fails closed when a long has no executable ask",()=>{
    const rule=structuredClone(templates()[0]!);
    if(rule.action.kind!=="trade")throw new Error("expected trade template");
    rule.action.side="long";
    const book={blockNumber:99n,bestBid:parseUnits("3999",18),bestAsk:null};
    expect(()=>prepareTrade(rule,input,info,0n,book)).toThrow("No executable long side");
  });
});

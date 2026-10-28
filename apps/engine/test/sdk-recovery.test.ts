import {describe,expect,it} from "vitest";
import {sdkIndexerLagIsAcceptable,sdkRecoveryDelayMs,sdkMaxIndexerLagBlocks} from "../src/sdk-recovery.js";

describe("SDK live-tail recovery policy",()=>{
  it("withholds SDK hydration when indexer freshness is unavailable or too old",()=>{
    expect(sdkIndexerLagIsAcceptable(null)).toBe(false);
    expect(sdkIndexerLagIsAcceptable(sdkMaxIndexerLagBlocks+1n)).toBe(false);
    expect(sdkIndexerLagIsAcceptable(sdkMaxIndexerLagBlocks)).toBe(true);
  });

  it("backs off repeated upstream recovery failures",()=>{
    expect(sdkRecoveryDelayMs(1)).toBe(30_000);
    expect(sdkRecoveryDelayMs(2)).toBe(60_000);
    expect(sdkRecoveryDelayMs(3)).toBe(120_000);
    expect(sdkRecoveryDelayMs(99)).toBe(5*60_000);
  });
});

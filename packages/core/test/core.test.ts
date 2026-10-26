import {describe, expect, it} from "vitest";
import {evaluate, checkRisk, templates, validateRule} from "../src/index.js";

const example = () => templates()[0]!;
const snapshot = (market: "BTC" | "ETH") => ({
  market, observedAt: new Date().toISOString(), blockNumber: "123",
  markUsd: market === "BTC" ? 110000 : 4000,
  indexUsd: market === "BTC" ? 109900 : 3992,
  premiumBps: 20, fundingBps8h: 3, openInterestUsd: 30000,
  availableMarginUsd: 100, marginRatioBps: 18000,
});

describe("Strategy Studio core", () => {
  it("accepts the three configured templates", () => {
    for (const template of templates()) expect(validateRule(template).errors).toEqual([]);
  });
  it("detects impossible ranges", () => {
    const rule = example();
    rule.groups[0]!.conditions = [
      {id: "a", market: "BTC", metric: "fundingBps8h", compare: "gt", value: 5},
      {id: "b", market: "BTC", metric: "fundingBps8h", compare: "lt", value: 2},
    ];
    expect(validateRule(rule).errors.join(" ")).toContain("Contradictory");
  });
  it("intersects equality without erasing a strict contradictory bound", () => {
    const rule=example();
    rule.groups[0]!.conditions=[
      {id:"a",market:"BTC",metric:"markUsd",compare:"gt",value:100},
      {id:"b",market:"BTC",metric:"markUsd",compare:"eq",value:80},
    ];
    expect(validateRule(rule).valid).toBe(false);
  });
  it("rejects an unsafe expiry and 3-market strategy", () => {
    const rule = example();
    rule.limits.expiresAt = "2020-01-01T00:00:00.000Z";
    rule.groups[0]!.conditions.push({id: "sol", market: "SOL", metric: "markUsd", compare: "gt", value: 10});
    expect(validateRule(rule).errors).toHaveLength(2);
  });
  it("evaluates cross-market AND from one deterministic snapshot", () => {
    expect(evaluate(example(), [snapshot("BTC"), snapshot("ETH")]).matched).toBe(true);
    expect(evaluate(example(), [snapshot("BTC")]).matched).toBe(false);
  });
  it("never lets OR bypass mandatory risk checks", () => {
    const rule = example();
    rule.groupsOperator = "ANY";
    const now = Date.now();
    const risk = checkRisk(rule, {
      nowMs: now, armed: true, engineHealthy: true, marketObservedAtMs: now - 200000,
      linkedBotPermission: true, availableMarginUsd: 100, currentExposureUsd: 0,
      proposedNotionalUsd: 30, actionsToday: 0, marketPriceable: true, duplicate: false,
    });
    expect(risk.allowed).toBe(false);
    expect(risk.blockedBy).toContain("STALE_MARKET");
  });
  it("blocks duplicate intents and unlinked bots", () => {
    const now = Date.now();
    const decision = checkRisk(example(), {
      nowMs: now, armed: true, engineHealthy: true, marketObservedAtMs: now,
      linkedBotPermission: false, availableMarginUsd: 100, currentExposureUsd: 0,
      proposedNotionalUsd: 50, actionsToday: 0, marketPriceable: true, duplicate: true,
    });
    expect(decision.blockedBy).toEqual(["NO_PERMISSION", "DUPLICATE"]);
  });
  it("does not accept NaN account inputs as a pass",()=>{
    const now=Date.now();
    expect(checkRisk(example(),{
      nowMs:now,armed:true,engineHealthy:true,marketObservedAtMs:now,
      linkedBotPermission:true,availableMarginUsd:NaN,currentExposureUsd:NaN,
      proposedNotionalUsd:40,actionsToday:NaN,marketPriceable:true,duplicate:false,
    }).allowed).toBe(false);
  });
});

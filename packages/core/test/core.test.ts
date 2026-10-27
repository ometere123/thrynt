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
  it("fails closed when a referenced metric is missing", () => {
    const rule = structuredClone(example());
    rule.groups[0]!.conditions = [{id: "missing", market: "ETH", metric: "fundingBps8h", compare: "gt", value: 0}];
    const result = evaluate(rule, [snapshot("BTC")]);
    expect(result.matched).toBe(false);
    expect(result.reasons).toContain("ETH fundingBps8h unavailable");
    expect(result.conditions[0]?.actual).toBeUndefined();
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
  it("blocks expiry, pause and engine-health failures independently", () => {
    const rule = structuredClone(example());
    rule.limits.expiresAt = new Date(Date.now() - 1).toISOString();
    const result = checkRisk(rule, {
      nowMs: Date.now(), armed: false, engineHealthy: false, marketObservedAtMs: Date.now(),
      linkedBotPermission: true, availableMarginUsd: 100, currentExposureUsd: 0,
      proposedNotionalUsd: 10, actionsToday: 0, marketPriceable: true, duplicate: false,
    });
    expect(result.blockedBy).toEqual(expect.arrayContaining(["PAUSED", "EXPIRED", "ENGINE_UNHEALTHY"]));
  });
  it("blocks unpriceable and invalid order size before submission", () => {
    const result = checkRisk(example(), {
      nowMs: Date.now(), armed: true, engineHealthy: true, marketObservedAtMs: Date.now(),
      linkedBotPermission: true, availableMarginUsd: 100, currentExposureUsd: 0,
      proposedNotionalUsd: Number.NaN, actionsToday: 0, marketPriceable: false, duplicate: false,
    });
    expect(result.blockedBy).toEqual(expect.arrayContaining(["UNPRICEABLE", "SIZE_INVALID"]));
  });
  it("does not accept NaN account inputs as a pass",()=>{
    const now=Date.now();
    expect(checkRisk(example(),{
      nowMs:now,armed:true,engineHealthy:true,marketObservedAtMs:now,
      linkedBotPermission:true,availableMarginUsd:NaN,currentExposureUsd:NaN,
      proposedNotionalUsd:40,actionsToday:NaN,marketPriceable:true,duplicate:false,
    }).allowed).toBe(false);
  });
  it("enforces margin, notional, exposure, daily and cooldown gates independently",()=>{
    const rule=example();
    rule.limits.minAvailableMarginUsd=200;rule.limits.maxNotionalUsd=50;
    rule.limits.maxTotalExposureUsd=100;rule.limits.maxDailyActions=2;rule.limits.cooldownSeconds=60;
    const now=Date.now();
    const decision=checkRisk(rule,{nowMs:now,armed:true,engineHealthy:true,marketObservedAtMs:now,
      linkedBotPermission:true,availableMarginUsd:10,currentExposureUsd:90,proposedNotionalUsd:60,
      actionsToday:2,lastActionAtMs:now-1_000,marketPriceable:true,duplicate:false});
    expect(decision.allowed).toBe(false);
    expect(decision.blockedBy).toEqual(expect.arrayContaining(["LOW_MARGIN","NOTIONAL_LIMIT","EXPOSURE_LIMIT","DAILY_LIMIT","COOLDOWN"]));
  });
  it("requires an actual position before allowing reduction",()=>{
    const rule=example();rule.action={kind:"reduce",market:"ETH",percent:50,slippageBps:0};
    const now=Date.now();
    const decision=checkRisk(rule,{nowMs:now,armed:true,engineHealthy:true,marketObservedAtMs:now,
      linkedBotPermission:true,availableMarginUsd:100,currentExposureUsd:0,proposedNotionalUsd:0,
      actionsToday:0,marketPriceable:true,duplicate:false,reduciblePositionSize:0});
    expect(decision.blockedBy).toContain("NO_POSITION");
  });
  it("rejects duplicate condition IDs and post-only slippage", () => {
    const rule = structuredClone(example());
    rule.groups[0]!.conditions[0]!.id = rule.groups[0]!.conditions[1]?.id ?? "same";
    if (rule.action.kind !== "trade") throw new Error("expected trade template");
    rule.action.orderType = "POST_ONLY";
    rule.action.slippageBps = 1;
    const result = validateRule(rule);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Condition IDs must be unique",
      "A post-only order cannot request taker slippage",
    ]));
  });
});

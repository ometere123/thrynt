import {RuleSchema, type Condition, type Rule} from "./schema.js";

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  rule?: Rule;
}
type Bounds = {min: number; minClosed: boolean; max: number; maxClosed: boolean};

function bounds(conditions: Condition[]): string[] {
  const errors: string[] = [];
  const metrics = new Map<string, Condition[]>();
  for (const condition of conditions) {
    const key = `${condition.market}:${condition.metric}`;
    metrics.set(key, [...(metrics.get(key) ?? []), condition]);
  }
  for (const [key, rows] of metrics) {
    const range: Bounds = {min: -Infinity, minClosed: false, max: Infinity, maxClosed: false};
    for (const row of rows) {
      const v = row.value;
      if ((row.compare === "gt" || row.compare === "gte") && v >= range.min) {
        if (v > range.min || (row.compare === "gt" && range.minClosed)) {
          range.min = v; range.minClosed = row.compare === "gte";
        }
      }
      if ((row.compare === "lt" || row.compare === "lte") && v <= range.max) {
        if (v < range.max || (row.compare === "lt" && range.maxClosed)) {
          range.max = v; range.maxClosed = row.compare === "lte";
        }
      }
      if (row.compare === "eq") {
        // Equality intersects existing bounds; it must never overwrite and hide a conflict.
        if (v > range.min || (v === range.min && !range.minClosed)) {
          range.min = v; range.minClosed = true;
        }
        if (v < range.max || (v === range.max && !range.maxClosed)) {
          range.max = v; range.maxClosed = true;
        }
      }
    }
    if (range.min > range.max || (range.min === range.max && (!range.minClosed || !range.maxClosed))) {
      errors.push(`Contradictory bounds on ${key}: no value can satisfy every condition`);
    }
  }
  return errors;
}

export function validateRule(input: unknown, now = new Date()): ValidationReport {
  const parsed = RuleSchema.safeParse(input);
  if (!parsed.success) {
    return {valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`), warnings: []};
  }
  const rule = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const all = rule.groups.flatMap((g) => g.conditions);
  const ids = all.map((c) => c.id);
  if (new Set(ids).size !== ids.length) errors.push("Condition IDs must be unique");
  const markets = new Set([rule.trigger.market, ...all.map((c) => c.market),
    ...("market" in rule.action ? [rule.action.market] : [])]);
  if (markets.size > 2) errors.push("At most two markets may be referenced in one strategy");
  if (new Date(rule.limits.expiresAt).getTime() <= now.getTime()) errors.push("Strategy expiry must be in the future");
  if (rule.action.kind === "trade" && Number(rule.action.quantity) <= 0) errors.push("Order quantity must be greater than zero");
  if (rule.action.kind === "trade" && rule.action.orderType === "POST_ONLY" && rule.action.slippageBps > 0) {
    errors.push("A post-only order cannot request taker slippage");
  }
  for (const group of rule.groups) {
    if (group.operator === "ALL") errors.push(...bounds(group.conditions));
  }
  if (rule.groupsOperator === "ALL" && rule.groups.every((g) => g.operator === "ALL")) {
    errors.push(...bounds(all));
  }
  if (all.every((c) => c.market !== rule.trigger.market)) {
    warnings.push("Trigger market does not appear among conditions; cross-market evaluation still works");
  }
  if (rule.groupsOperator === "ANY" || rule.groups.some((g) => g.operator === "ANY")) {
    warnings.push("OR changes only market conditions. Mandatory runtime safety gates can never be bypassed");
  }
  return {valid: errors.length === 0, errors: [...new Set(errors)], warnings, rule};
}

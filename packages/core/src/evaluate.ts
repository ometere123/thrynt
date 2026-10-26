import type {Condition, Market, MetricSnapshot, Rule} from "./schema.js";

export interface ConditionResult {
  id: string;
  market: Market;
  metric: string;
  compare: string;
  threshold: number;
  actual?: number;
  matched: boolean;
  reason?: string;
}
export interface Evaluation {
  matched: boolean;
  conditions: ConditionResult[];
  groupResults: boolean[];
  reasons: string[];
}

export function compareNumbers(actual: number, op: Condition["compare"], threshold: number): boolean {
  switch (op) {
    case "gt": return actual > threshold;
    case "gte": return actual >= threshold;
    case "lt": return actual < threshold;
    case "lte": return actual <= threshold;
    case "eq": return actual === threshold;
  }
}

export function evaluate(rule: Rule, snapshots: MetricSnapshot[]): Evaluation {
  const byMarket = new Map(snapshots.map((s) => [s.market, s]));
  const reasons: string[] = [];
  const conditions: ConditionResult[] = [];
  const groupResults = rule.groups.map((group) => {
    const results = group.conditions.map((condition) => {
      const snapshot = byMarket.get(condition.market);
      const raw = snapshot?.[condition.metric];
      const missing = typeof raw !== "number" || !Number.isFinite(raw);
      const matched = !missing && compareNumbers(raw, condition.compare, condition.value);
      const row: ConditionResult = {
        id: condition.id, market: condition.market, metric: condition.metric,
        compare: condition.compare, threshold: condition.value,
        ...(missing ? {reason: "Missing or invalid metric"} : {actual: raw}),
        matched,
      };
      if (missing) reasons.push(`${condition.market} ${condition.metric} unavailable`);
      conditions.push(row);
      return matched;
    });
    return group.operator === "ALL" ? results.every(Boolean) : results.some(Boolean);
  });
  const matched = rule.groupsOperator === "ALL" ? groupResults.every(Boolean) : groupResults.some(Boolean);
  if (!matched && reasons.length === 0) reasons.push("Configured market conditions did not match");
  return {matched, conditions, groupResults, reasons};
}

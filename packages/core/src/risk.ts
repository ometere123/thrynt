import type {Rule} from "./schema.js";

export type RiskCode =
  | "PAUSED" | "EXPIRED" | "STALE_MARKET" | "NO_PERMISSION"
  | "LOW_MARGIN" | "EXPOSURE_LIMIT" | "NOTIONAL_LIMIT" | "DAILY_LIMIT"
  | "LIFETIME_LIMIT" | "COOLDOWN" | "ENGINE_UNHEALTHY" | "UNPRICEABLE" | "DUPLICATE"
  | "NO_POSITION" | "SIZE_INVALID";
export interface RiskInput {
  nowMs: number;
  armed: boolean;
  engineHealthy: boolean;
  marketObservedAtMs: number;
  linkedBotPermission: boolean;
  availableMarginUsd: number;
  currentExposureUsd: number;
  proposedNotionalUsd: number;
  actionsToday: number;
  actionsLifetime?: number;
  lastActionAtMs?: number;
  marketPriceable: boolean;
  duplicate: boolean;
  reduciblePositionSize?: number;
}
export interface RiskDecision {allowed: boolean; blockedBy: RiskCode[]}

export function checkRisk(rule: Rule, input: RiskInput): RiskDecision {
  const blockedBy: RiskCode[] = [];
  if (!input.armed) blockedBy.push("PAUSED");
  if (Date.parse(rule.limits.expiresAt) <= input.nowMs) blockedBy.push("EXPIRED");
  if (!input.engineHealthy) blockedBy.push("ENGINE_UNHEALTHY");
  if (!Number.isFinite(input.marketObservedAtMs) ||
      input.marketObservedAtMs > input.nowMs + 2000 ||
      input.nowMs - input.marketObservedAtMs > rule.limits.maxDataAgeSeconds * 1000) blockedBy.push("STALE_MARKET");
  if ((rule.action.kind === "trade" || rule.action.kind === "reduce") && !input.linkedBotPermission) blockedBy.push("NO_PERMISSION");
  if (!input.marketPriceable) blockedBy.push("UNPRICEABLE");
  if (!Number.isFinite(input.availableMarginUsd)||
      input.availableMarginUsd < rule.limits.minAvailableMarginUsd) blockedBy.push("LOW_MARGIN");
  if (!Number.isFinite(input.proposedNotionalUsd) || input.proposedNotionalUsd < 0) blockedBy.push("SIZE_INVALID");
  if (input.proposedNotionalUsd > rule.limits.maxNotionalUsd) blockedBy.push("NOTIONAL_LIMIT");
  if (rule.action.kind === "trade" &&
      (!Number.isFinite(input.currentExposureUsd)||
      input.currentExposureUsd + input.proposedNotionalUsd > rule.limits.maxTotalExposureUsd))
    blockedBy.push("EXPOSURE_LIMIT");
  if (!Number.isInteger(input.actionsToday)||input.actionsToday < 0||
      input.actionsToday >= rule.limits.maxDailyActions) blockedBy.push("DAILY_LIMIT");
  const lifetimeLimit=rule.limits.maxLifetimeActions??20;
  if (input.actionsLifetime !== undefined &&
      (!Number.isInteger(input.actionsLifetime)||input.actionsLifetime < 0||
      input.actionsLifetime >= lifetimeLimit)) blockedBy.push("LIFETIME_LIMIT");
  if (input.lastActionAtMs !== undefined &&
      (!Number.isFinite(input.lastActionAtMs)||
      input.nowMs-input.lastActionAtMs < rule.limits.cooldownSeconds*1000))
    blockedBy.push("COOLDOWN");
  if (input.duplicate) blockedBy.push("DUPLICATE");
  if (rule.action.kind === "reduce" && !(input.reduciblePositionSize && input.reduciblePositionSize > 0))
    blockedBy.push("NO_POSITION");
  return {allowed: blockedBy.length === 0, blockedBy};
}

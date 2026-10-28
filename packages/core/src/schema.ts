import { z } from "zod";

export const MARKET_CODES = ["BTC", "ETH", "SOL", "XRP", "DOGE"] as const;
export const METRIC_CODES = [
  "markUsd", "indexUsd", "premiumBps", "fundingBps8h", "openInterestUsd",
  "availableMarginUsd", "marginRatioBps",
] as const;
export const MarketCode = z.enum(MARKET_CODES);
export const MetricCode = z.enum(METRIC_CODES);
export const Comparator = z.enum(["gt", "gte", "lt", "lte", "eq"]);

const Condition = z.object({
  id: z.string().min(1).max(30).regex(/^[a-zA-Z0-9_-]+$/),
  market: MarketCode,
  metric: MetricCode,
  compare: Comparator,
  value: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
}).strict();

const Group = z.object({
  id: z.string().min(1).max(30),
  operator: z.enum(["ALL", "ANY"]),
  conditions: z.array(Condition).min(1).max(3),
}).strict();

const Trade = z.object({
  kind: z.literal("trade"),
  market: MarketCode,
  side: z.enum(["long", "short"]),
  quantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/),
  orderType: z.enum(["IOC", "POST_ONLY"]),
  slippageBps: z.number().int().min(0).max(50),
}).strict();

const Reduce = z.object({
  kind: z.literal("reduce"),
  market: MarketCode,
  percent: z.number().int().min(1).max(100),
  slippageBps: z.number().int().min(0).max(50),
}).strict();

const Notify = z.object({kind: z.literal("notify"), message: z.string().min(2).max(180)}).strict();
const Pause = z.object({kind: z.literal("pause")}).strict();

export const RuleSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(3).max(72),
  description: z.string().max(420),
  trigger: z.object({
    kind: z.literal("market_event"),
    market: MarketCode,
    // Only observed SDK event names may be activated by the engine.
    event: z.enum(["FundingUpdated", "OpenInterestUpdated", "OrderPlaced"]),
  }).strict(),
  groupsOperator: z.enum(["ALL", "ANY"]),
  groups: z.array(Group).min(1).max(2),
  action: z.discriminatedUnion("kind", [Trade, Reduce, Notify, Pause]),
  limits: z.object({
    maxNotionalUsd: z.number().positive().max(1000),
    maxDailyActions: z.number().int().min(1).max(20),
    // Older persisted rules omit this field; the bounded default keeps them
    // safe while new versions persist an explicit lifetime cap.
    maxLifetimeActions: z.number().int().min(1).max(100).default(20),
    cooldownSeconds: z.number().int().min(30).max(86400),
    maxDataAgeSeconds: z.number().int().min(5).max(120),
    minAvailableMarginUsd: z.number().min(0).max(100000),
    maxTotalExposureUsd: z.number().positive().max(5000),
    expiresAt: z.string().datetime({offset: true}),
  }).strict(),
}).strict();

export type Rule = z.infer<typeof RuleSchema>;
export type Condition = z.infer<typeof Condition>;
export type Group = z.infer<typeof Group>;
export type TradeAction = z.infer<typeof Trade>;
export type Market = z.infer<typeof MarketCode>;
export type Metric = z.infer<typeof MetricCode>;

export const MetricSnapshotSchema = z.object({
  market: MarketCode,
  observedAt: z.string().datetime({offset: true}),
  blockNumber: z.string().regex(/^\d+$/),
  markUsd: z.number().finite().positive(),
  indexUsd: z.number().finite().positive(),
  premiumBps: z.number().finite(),
  fundingBps8h: z.number().finite(),
  openInterestUsd: z.number().finite().nonnegative(),
  availableMarginUsd: z.number().finite().nonnegative(),
  marginRatioBps: z.number().finite().nonnegative(),
}).strict();
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;

export const SimulationRequestSchema = z.object({
  rule: RuleSchema,
  snapshots: z.array(MetricSnapshotSchema).min(1).max(2),
  time: z.string().datetime({offset: true}),
}).strict();

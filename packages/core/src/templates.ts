import type {Rule} from "./schema.js";

const expiry = () => new Date(Date.now() + 3 * 86400_000).toISOString();
const limits = () => ({
  maxNotionalUsd: 100, maxDailyActions: 3, cooldownSeconds: 300,
  maxDataAgeSeconds: 30, minAvailableMarginUsd: 25,
  maxTotalExposureUsd: 300, expiresAt: expiry(),
});

export function templates(): Rule[] {
  return [
    {
      schemaVersion: 1, name: "Cross-Market Confirmation",
      description: "Combine BTC funding and ETH mark premium before a capped ETH trade.",
      trigger: {kind: "market_event", market: "BTC", event: "FundingUpdated"},
      groupsOperator: "ALL", groups: [{
        id: "confirmed", operator: "ALL", conditions: [
          {id: "btc-funding", market: "BTC", metric: "fundingBps8h", compare: "gt", value: 1},
          {id: "eth-premium", market: "ETH", metric: "premiumBps", compare: "gt", value: 10},
        ],
      }],
      action: {kind: "trade", market: "ETH", side: "short", quantity: "0.001", orderType: "IOC", slippageBps: 15},
      limits: limits(),
    },
    {
      schemaVersion: 1, name: "Funding Divergence",
      description: "Alert when BTC funding and mark-to-index divergence align.",
      trigger: {kind: "market_event", market: "BTC", event: "FundingUpdated"},
      groupsOperator: "ALL", groups: [{id: "divergence", operator: "ALL", conditions: [
        {id: "funding", market: "BTC", metric: "fundingBps8h", compare: "gt", value: 2},
        {id: "premium", market: "BTC", metric: "premiumBps", compare: "gt", value: 8},
      ]}],
      action: {kind: "notify", message: "BTC funding divergence threshold matched"},
      limits: limits(),
    },
    {
      schemaVersion: 1, name: "Margin Sentinel",
      description: "Pause the strategy when cross-margin availability falls below a chosen threshold.",
      trigger: {kind: "market_event", market: "ETH", event: "OpenInterestUpdated"},
      groupsOperator: "ALL", groups: [{id: "account", operator: "ALL", conditions: [
        {id: "margin", market: "ETH", metric: "availableMarginUsd", compare: "lt", value: 50},
      ]}],
      action: {kind: "pause"}, limits: {...limits(), minAvailableMarginUsd: 0},
    },
  ];
}

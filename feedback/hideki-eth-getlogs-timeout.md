# Hideki `eth_getLogs` / SDK hydration evidence

Status: reproducible builder-infrastructure report, not a security finding.

## Environment

- Network: Somnia Hideki testnet, chain ID `50383`.
- RPC: `https://api.hideki2.infra.testnet.somnia.network`.
- WebSocket: `wss://api.hideki2.infra.testnet.somnia.network/ws`.
- SDK: `@somnia-chain/markets-sdk@0.32.1`.
- Engine: one Fly.io machine, observation-only.

## Reproduction

1. Connect to the Hideki WebSocket and subscribe to `newHeads` and an ETH perp
   pool log filter. Both subscriptions accept messages and advance block heads.
2. Call `eth_getLogs` over a small recent block range using HTTP and the same
   WebSocket transport. In the degraded window, requests timed out, including a
   nine-block range.
3. Start the pinned SDK live tail. The SDK uses WebSocket chain reads and a bounded
   `eth_getLogs` response deadline while hydrating/backfilling watched pools. Its
   watcher cannot report `tailing` until hydration completes.
4. At the same time, the indexer watermark reported a large catch-up lag. The SDK
   tail therefore failed to hydrate even though the socket itself was connected.

## Expected versus observed

Expected: a connected feed should hydrate current watched pools and backfill a small
gap, or expose an actionable upstream read failure.

Observed: `eth_subscribe` stayed usable while `eth_getLogs` timed out and indexer
freshness fell outside a safe window. A socket-connected boolean was insufficient to
represent feed health.

## THRYNT workaround

THRYNT now keeps raw receipt-backed observation and authoritative HTTP account/market
reads separate from the SDK tail. It refuses SDK hydration when the indexer watermark
is unavailable or more than 2,000 blocks behind, bounds startup, exposes lag/error/
retry state on `/healthz`, and backs off recovery. `/readyz` remains unhealthy and
signing remains disabled until the complete SDK tail is live. On 2026-10-30 Fly
reported a recovered bounded sample with six watch lanes, `wsConnected=true`, no SDK
failure and 19-block lag.

The evidence currently establishes an upstream Hideki/indexer reliability boundary,
not an SDK vulnerability. The report should not be treated as a confirmed protocol
defect until DreamDEX/Somnia operators reproduce it against their provider logs.

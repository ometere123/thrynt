# Engineering verification matrix

This is a release-gate checklist. Checked items below have recorded evidence. One bounded
Hideki order was authorized, broadcast once, independently reconciled and then shut down
safely on 2026-10-28. The deployed engine is observation-only with the global pause enabled.

## Static checks

- [x] A clean Windows `npm ci` completed successfully on 2026-10-28. npm reported development-tree advisories during install; `npm audit --omit=dev --audit-level=high` returned `found 0 vulnerabilities`.
- [x] The final local run passed `npm run typecheck`, `npm test` (15 core + 8 engine tests), `npm run build`, `npm run test:e2e` (6 active checks passed, 2 intentionally skipped without an injected authenticated storage state), and the production-only audit. One transient production edge reset was reproduced as a single failed browser request and passed on immediate isolated rerun.
- [x] GitHub Actions run [40703200840](https://github.com/ometere123/thrynt/actions/runs/40703200840) passed for final commit `4a94ad0c27da520cf0d96d5f115884e9add8b9ad`, including install, production audit, typecheck, unit tests, build and Playwright checks.
- [x] Secrets never referenced by `NEXT_PUBLIC_` except publishable credentials.
- [x] Supabase anonymous REST access to application tables is denied by privileges/RLS; service-role telemetry read succeeds.
- [x] Worker denies anonymous and malformed trader authentication; the approved production session completed owner writes through the explicit `TRADER_USER_ID` allowlist. A separate valid JWT for an unapproved identity was not created solely for testing.
- [x] Cloudflare CORS returns the production Vercel origin only; an unrelated Origin receives no allow-origin header.
- [ ] One strategy version cannot be updated or deleted.
- [ ] Compiler and tests reject contradictory conditions, third market, expired rules, invalid units, post-only slippage, duplicate action.

## Real Hideki integration

- [x] Chain ID resolves to 50383, independent read via RPC.
- [x] SDK 0.32.1 discovers real perp markets and correct pool addresses.
- [x] Fly runtime received real BTC `OpenInterestUpdated` logs; SDK ABI decoding classified events with block, transaction and log index. The production engine starts five official SDK `watchMarket` lanes plus the perp plane; Fly `/readyz` reports `mode=tailing`, `wsConnected=true`, `watchCount=6`, fresh block progress and healed gaps. Receipt-backed raw discovery uses bounded HTTP polling because Hideki raw WS delivery can replay or time out.
- [x] After a Hideki SDK `eth_blockNumber` read timeout, authoritative snapshots/order-book/margin/sizing reads were moved to the pinned SDK 0.32.1 read helpers over the configured Hideki HTTP RPC. The SDK WebSocket tail remains a separate required health signal; failed HTTP reads still fail closed.
- [x] Two-market observation reads current mark/index/funding state through the SDK at evaluation time; account state is read from MarginBank rather than fabricated UI values.
- [x] A captured event includes a real transaction hash, block and log index; receipt lookup remains a required pre-signing/reconciliation gate.
- [x] Direct MarginBank read at block `35495448` reports approximately 1,000 USDso-equivalent equity/available margin, zero locked collateral and `Healthy`; the current owner account is flat. The earlier `-0.004 ETH` position was independently closed outside THRYNT and is preserved as separate owner-managed evidence below.
- [x] Funding normalization uses the SDK-reported `fundingWindowSec`; current Hideki reads report the documented 28,800-second window and are normalized to 8 hours.
- [x] Trade precision is read from each discovered pool and applied with bigint tick/lot/minimum checks; current authoritative reads cover BTC's 8 and ETH's 18 base decimals and the CI order-preparation tests.
- [x] Linked-bot permission is verified onchain for place, cancel and reduce selectors on all five discovered Hideki markets; the DreamDEX UI shows `Perps - every market`.
- [x] Voucher campaign and owner voucher state are read from chain: claimed voucher, 1,000-unit floor, 20x campaign cap, and `alreadyClaimed` eligibility response.
- [x] Deterministic risk tests cover low margin, stale market, excessive notional, exposure, cooldown, daily cap, duplicate intent, unpriceable inputs, expiry, pause and engine health; live onchain margin, permission and protocol sizing reads are independently verified before any live gate.
- [x] One supervised small live **testnet** IOC was submitted once by the linked bot for the owner: ETH-PERP short, 0.004 ETH, IOC, bounded by 9.50 USDso and 15 bps.
- [x] Receipt classified `success`; DreamDEX order ID, one fill, filled quantity and no-resting-order state were reconciled independently from receipt events, SDK order history and active-order reads.
- [x] A controlled Fly machine restart completed successfully with signing disabled; startup re-established the SDK tail, singleton lease and ready state. The persisted filled intent was then reconciled without a second submission.
- [x] After the broadcast, an engine restart reconciled the persisted intent from the receipt and indexed order history without submitting another transaction; the trace records `reconciledOnRestart=true`.
- [x] A live Hideki RPC timeout and SDK-tail abort were observed after the order; the engine withheld the heartbeat, kept signing disabled, remained fail-closed, and recovered the observation tail after restart/retry instead of broadcasting or retrying an order.
- [x] SDK cleanup rejection containment was deployed after Hideki `eth_unsubscribe` timeouts: asynchronous cleanup errors now mark the feed unhealthy and suspend execution without crashing the process or creating a retry path.
- [ ] Engine restart with missing hash blocks live trading until manually investigated.
- [x] Fly is configured and scaled to one active machine; the database lease/fencing and concurrency tests are in source. A two-machine rollout was observed to be unsafe for event throughput and was immediately reduced to one.
- [x] Global pause blocks genuine matched live events; the public trace shows `BLOCKED`/pause evidence and no new execution intent. Per-strategy pause was exercised through the approved owner workflow. The one IOC order is terminally filled and no resting order remains.
- [x] Post-order safety state was verified on 2026-10-28: Fly `mode=observe`, `liveOptIn=false`, one leased/healthy machine with `wsConnected=true`, Cloudflare `global_pause=true`, and the completed controlled strategy was paused through the authenticated owner workflow. The public trace contains exactly one reconciled transaction intent for the supervised order. The temporary authorized sell-floor secret was removed.
- [x] Lifetime action caps are now stored in immutable rule versions and enforced independently of the daily UTC counter; the regression test covers a terminal lifetime rejection.
- [x] Chain-head open orders and SDK position analytics are published as account telemetry; protective-stop enumeration is bounded and reports `partial` on indexer failure rather than claiming an empty protection set.
- [ ] Filled-position reduction and exchange-held TP/SL are not enabled: direct Hideki reads show the bot's `reduce` permission, but the documented `reduceOrderFor` route targets resting orders and the ETH stop-registry owner authorization is not enabled. THRYNT remains fail-closed and the frontend does not transmit an ordinary opposite-side close.

### Position-management investigation

- [x] SDK `0.32.1` source and ABI were inspected. `placePerpOrder`/`placeOrderFor` carry no reduce-only argument; `reduceOrderFor` accepts an order ID and new remaining quantity, so it operates on resting orders.
- [x] SDK `placePerpStopOrder` was inspected. Its default intent is `reduceOnly`; it routes through `PerpStopOrderRegistry` and requires the registry to be owner-approved for the pool's `placeOrderFor` selector. The current ETH pool read returned `false` for owner → ETH stop registry, so THRYNT did not grant or use it.
- [x] Direct Hideki authorization read at the current verification block returned bot `placeOrderFor=true`, `cancelOrderFor=true`, `reduceOrderFor=true`; registry `placeOrderFor=false`, `cancelOrderFor=false`, `reduceOrderFor=false`; ETH pool `isRestricted=false`.
- [x] The previous short is no longer open. SDK `listPerpPositionChanges` reports `CLOSE` at block `35487793`, tx [`0xc41fc769df942e19ed493f837a3d241cfbc2b92c7bd9f86c1a4254bfab12e042`](https://explorer.testnet.somnia.network/tokyo/tx/0xc41fc769df942e19ed493f837a3d241cfbc2b92c7bd9f86c1a4254bfab12e042), order `21121521964397447187584`, `0.004 ETH` closed at `2323.45 USDso`; the transaction was owner-managed and is not attributed to THRYNT.
- [ ] No THRYNT close/reduction transaction was broadcast. A future THRYNT exit requires either a verified bot-controlled reduce-only protocol route or an explicitly implemented owner-wallet signing flow; an owner grant to the ETH stop registry would be a separate owner-authorized onchain action.

## End-to-end UX

- [x] Playwright public shell runs on desktop and Pixel 5 mobile; the production page has also been inspected at desktop and narrow layouts. Exact 768/1280/1600 screenshot baselines are not maintained.
- [x] Public visitor sees real engine/account state and honest empty traces without login.
- [x] Empty decision history is rendered honestly while real market/account telemetry remains present; no fake transaction, balance or profit is inserted.
- [x] Approved owner email-link sign-in works with the production redirect domain; the approved session saved, simulated, armed and paused immutable strategy versions.
- [ ] A second authenticated identity was not created solely for testing; anonymous and malformed-token owner requests are denied, and the Worker allowlist is explicit. A separate unapproved-user test requires a second user identity.
- [x] The frontend now fails closed on the owner authorization read: a valid Supabase session alone does not enable save, arm, pause or emergency controls.
- [x] Guest Strategy Studio template → edit → validate → illustrative simulation path works; save/arm correctly remain disabled without the approved trader.
- [x] The three templates were exercised through the authenticated production workflow; Cross-Market was revised to a valid Hideki ETH lot, and all three were armed and then paused.
- [x] CI covers the public seven-screen shell on desktop and Pixel 5 mobile, including mobile drawer navigation, keyboard navigation and anonymous/malformed owner API rejection. The authenticated owner test is present but skipped unless `THRYNT_E2E_STORAGE_STATE` is provided outside CI.
- [ ] Editing an armed strategy is denied until paused; new version invalidates previous simulation.
- [x] Decision Trace links the correct Somnia transaction and displays separate intent/receipt/fill states; the production trace feed requests the bounded 200-record evidence window and renders a reconciled fill as `FILLED`.
- [ ] Demo video labels all synthetic input as simulations.

## Security gates before mainnet consideration

Mainnet trading, multi-tenant custody, key rotation, 24/7 operational support, alerting, professional security audit, persistent exchange stop orders and legal compliance are OUT OF SCOPE. Do not relabel a testnet bounty demo as production-ready or promote it directly to mainnet.

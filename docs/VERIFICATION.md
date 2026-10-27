# Engineering verification matrix

This is a release-gate checklist, not a claim the tests have already passed.

## Static checks

- [x] An earlier clean `npm ci` completed locally; the Fly image also ran `npm ci --no-audit --no-fund` successfully.
- [ ] The final post-change Windows `npm ci` rerun stalled during dependency extraction and was interrupted; rerun this gate in Linux CI before treating the release as fully green.
- [x] `npm run typecheck`, `npm test`, `npm run build` pass locally; CI/provider checks remain separate evidence.
- [x] Secrets never referenced by `NEXT_PUBLIC_` except publishable credentials.
- [x] Supabase anonymous REST access to application tables is denied by privileges/RLS; service-role telemetry read succeeds.
- [x] Worker denies missing trader authentication and a wrong/short engine key. Approved-user and wrong-owner JWT tests remain blocked until an Auth user exists.
- [x] Cloudflare CORS returns the production Vercel origin only; an unrelated Origin receives no allow-origin header.
- [ ] One strategy version cannot be updated or deleted.
- [ ] Compiler and tests reject contradictory conditions, third market, expired rules, invalid units, post-only slippage, duplicate action.

## Real Hideki integration

- [x] Chain ID resolves to 50383, independent read via RPC.
- [x] SDK 0.32.1 discovers real perp markets and correct pool addresses.
- [x] Direct WebSocket subscription from the workstation and Fly runtime received real BTC pool logs; SDK ABI decoding classified a real `OpenInterestUpdated` event with block, transaction and log index. Unsupported event names remain filtered.
- [ ] Two-market observation fetches the current mark/index/funding state, not stale indexer-row values.
- [ ] Each event has an actual chain receipt, transaction hash, block and log index.
- [x] Direct MarginBank read reports 1,000 USDso-equivalent equity/available margin, zero locked collateral, zero active positions and `Healthy`; the same real values are published by the Fly engine and Worker.
- [ ] Funding normalization reflects `fundingWindowSec` across cadence changes.
- [ ] Trade market tick, lot and min-size parsing correct for BTC's 8 and ETH's 18 base decimals.
- [x] Linked-bot permission is verified onchain for place, cancel and reduce selectors on BTC-PERP and ETH-PERP; the DreamDEX UI shows `Perps - every market`.
- [x] Voucher campaign and owner voucher state are read from chain: claimed voucher, 1,000-unit floor, 20x campaign cap, and `alreadyClaimed` eligibility response.
- [ ] Risk gate catches low margin, stale oracle, excessive exposure, cooldown, daily cap, duplicate event, shutdown and restart.
- [ ] One supervised small live **testnet** IOC is submitted by the bot *for the owner*.
- [ ] Transaction receipt classified success/revert; fill/order ID and actual resting status reconciled independently.
- [ ] Engine restart with a pending hash reconciles receipt rather than submitting a second order.
- [ ] Engine restart with missing hash blocks live trading until manually investigated.
- [x] Fly is configured and scaled to one active machine; the database lease/fencing and concurrency tests are in source. A two-machine rollout was observed to be unsafe for event throughput and was immediately reduced to one.
- [ ] Global pause and per-strategy pause block new submissions; outstanding orders deliberately remain unchanged.

## End-to-end UX

- [ ] Mobile/desktop layout renders at 375, 768, 1280 and 1600 px.
- [x] Public visitor sees real engine/account state and honest empty traces without login.
- [ ] No deployed data results in honest empty states, **not** fake transactions.
- [ ] Approved owner OTP works with production redirect domain; no Supabase Auth user exists yet.
- [ ] Unapproved Supabase Auth user cannot save, revise, simulate, arm or pause.
- [x] Guest Strategy Studio template → edit → validate → illustrative simulation path works; save/arm correctly remain disabled without the approved trader.
- [ ] Editing an armed strategy is denied until paused; new version invalidates previous simulation.
- [ ] Decision Trace links the correct Somnia transaction and displays separate submission/fill states.
- [ ] Demo video labels all synthetic input as simulations.

## Security gates before mainnet consideration

Mainnet trading, multi-tenant custody, key rotation, 24/7 operational support, alerting, professional security audit, persistent exchange stop orders and legal compliance are OUT OF SCOPE. Do not relabel a testnet bounty demo as production-ready or promote it directly to mainnet.

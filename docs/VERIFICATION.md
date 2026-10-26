# Engineering verification matrix

This is a release-gate checklist, not a claim the tests have already passed.

## Static checks

- [ ] `npm ci` reproducible on Ubuntu and Windows runners.
- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] Secrets never referenced by `NEXT_PUBLIC_` except publishable credentials.
- [ ] Supabase anon/authenticated can neither SELECT nor mutate application tables.
- [ ] Worker denies wrong JWT, wrong owner, and a wrong/short engine key.
- [ ] Cloudflare CORS permits only configured production Vercel origin.
- [ ] One strategy version cannot be updated or deleted.
- [ ] Compiler and tests reject contradictory conditions, third market, expired rules, invalid units, post-only slippage, duplicate action.

## Real Hideki integration

- [ ] Chain ID resolves to 50383, independent read via RPC.
- [ ] SDK 0.32.1 discovers real perp markets and correct pool addresses.
- [ ] WebSocket receives `FundingUpdated`, `OpenInterestUpdated` and `OrderPlaced` as expected; unsupported ABI log names disabled.
- [ ] Two-market observation fetches the current mark/index/funding state, not stale indexer-row values.
- [ ] Each event has an actual chain receipt, transaction hash, block and log index.
- [ ] Account telemetry agrees with DreamDEX UI including cross-margin and open positions.
- [ ] Funding normalization reflects `fundingWindowSec` across cadence changes.
- [ ] Trade market tick, lot and min-size parsing correct for BTC's 8 and ETH's 18 base decimals.
- [ ] Linked-bot permission is verified per market and revoked permission blocks.
- [ ] Voucher-limited or isolated account restrictions are surfaced accurately.
- [ ] Risk gate catches low margin, stale oracle, excessive exposure, cooldown, daily cap, duplicate event, shutdown and restart.
- [ ] One supervised small live **testnet** IOC is submitted by the bot *for the owner*.
- [ ] Transaction receipt classified success/revert; fill/order ID and actual resting status reconciled independently.
- [ ] Engine restart with a pending hash reconciles receipt rather than submitting a second order.
- [ ] Engine restart with missing hash blocks live trading until manually investigated.
- [ ] Two Fly instances cannot simultaneously hold the lease or both sign.
- [ ] Global pause and per-strategy pause block new submissions; outstanding orders deliberately remain unchanged.

## End-to-end UX

- [ ] Mobile/desktop layout renders at 375, 768, 1280 and 1600 px.
- [ ] Public visitor sees real market state and decision traces without login.
- [ ] No deployed data results in honest empty states, **not** fake transactions.
- [ ] Approved owner OTP works with production redirect domain.
- [ ] Unapproved Supabase Auth user cannot save, revise, simulate, arm or pause.
- [ ] Strategy flow: template → edit → validate → save → simulate → arm → observe → pause.
- [ ] Editing an armed strategy is denied until paused; new version invalidates previous simulation.
- [ ] Decision Trace links the correct Somnia transaction and displays separate submission/fill states.
- [ ] Demo video labels all synthetic input as simulations.

## Security gates before mainnet consideration

Mainnet trading, multi-tenant custody, key rotation, 24/7 operational support, alerting, professional security audit, persistent exchange stop orders and legal compliance are OUT OF SCOPE. Do not relabel a testnet bounty demo as production-ready or promote it directly to mainnet.

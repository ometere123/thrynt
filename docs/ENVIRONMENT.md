# Environment and secret inventory

Values below are names and handling rules only. Real secrets must be entered through the provider secret UI/CLI or an ignored local file; they do not belong in GitHub, Vercel public variables, the browser bundle, or logs.

| Variable | Service | Public? | Required | Source / validation |
|---|---|---:|---:|---|
| `NEXT_PUBLIC_API_URL` | Vercel/browser | Yes | Yes | Cloudflare `thrynt` Worker HTTPS URL; no trailing slash. |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel/browser | Yes | Yes | Authorized Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel/browser | Publishable | Yes | Same Supabase project publishable/anon key. Never use a service key. |
| `SUPABASE_URL` | Cloudflare | No | Yes | Same Supabase project URL. |
| `SUPABASE_SECRET_KEY` | Cloudflare | No | Yes | Current Supabase server/service secret; verify it against the target project before `wrangler secret put`. |
| `TRADER_USER_ID` | Cloudflare | No | Yes | UUID of the one approved Supabase Auth trader. |
| `ENGINE_API_KEY` | Cloudflare | No | Yes | Random 32+ byte shared secret, distinct from all wallet/database keys. |
| `ALLOWED_ORIGIN` | Cloudflare | No | Yes | Exact production Vercel origin; no wildcard. Local development may use `http://localhost:3000`. |
| `THRYNT_API_URL` | Fly | No | Yes | Cloudflare Worker HTTPS URL. |
| `THRYNT_ENGINE_API_KEY` | Fly | No | Yes | Same value as `ENGINE_API_KEY`, entered separately as a Fly secret. |
| `OWNER_ADDRESS` | Fly | Public identifier | Yes | Full DreamDEX owner/trading wallet address; verify on chain and against linked-bot permissions. |
| `BOT_PRIVATE_KEY` | Fly | No | Live only | Dedicated bot key; derive its address and compare with DreamDEX linked-bot address before any signing. |
| `EXPECTED_BOT_ADDRESS` | Fly | Public identifier | Live only | Full public address displayed by DreamDEX for the linked bot; live mode refuses to start on a mismatch. |
| `SOMNIA_RPC_URL` | Fly/local | Yes | Yes | Hideki RPC; must be HTTPS and resolve to chain 50383. |
| `SOMNIA_WS_URL` | Fly/local | Yes | Yes | Hideki secure WebSocket endpoint. |
| `SOMNIA_INDEXER_URL` | Fly/local | Yes | Yes | Hideki GraphQL indexer. |
| `EXECUTION_MODE` | Fly/local | No | Yes | `observe`, `simulate`, or `live`; default is `observe`. |
| `ENABLE_TESTNET_EXECUTION` | Fly/local | No | Yes | Must remain `false` until explicit owner authorization; the engine also requires `EXECUTION_MODE=live`. |
| `THRYNT_AUTHORIZED_MAX_PRICE_USD` | Fly/local | No | Temporary | Optional positive USD ceiling applied to the prepared order price during a single explicitly bounded authorization window; unset after reconciliation. |
| `THRYNT_AUTHORIZED_MIN_SELL_PRICE_USD` | Fly/local | No | Temporary | Optional positive absolute floor applied to a prepared short sell price during a single explicitly bounded authorization window; unset after reconciliation. |
| `ENGINE_INSTANCE_ID` | Fly/local | No | Yes | Stable unique executor identity used by the fenced lease. |
| `PORT` | Fly/local | No | Optional | Health server port; defaults to `8080` and is the only Fly service port. |

## Observed deployment status (2026-10-27)

- Vercel project `thrynt` is linked to `ometere123/thrynt`, rooted at `apps/web`, and its production deployment is READY. `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and the matching publishable `NEXT_PUBLIC_SUPABASE_ANON_KEY` are configured for production, preview, and development.
- Cloudflare Worker `thrynt` has `SUPABASE_URL`, the server-only Supabase service key, a random 32-byte `ENGINE_API_KEY`, and the approved trader's `TRADER_USER_ID` configured as secrets. Its public overview returns real account/engine telemetry. The approved UUID is not present in frontend code, source control, logs or this document.
- Supabase project `qpvgldadpwiipqgynxzd` is `ACTIVE_HEALTHY` in `eu-west-1`. Migrations 0001–0005 are applied, all application tables have RLS enabled, anonymous table access is denied, and the service-role read path is working. Auth site/redirect URLs include `https://thrynt.vercel.app`, `http://localhost:3000`, and `http://127.0.0.1:3000`; exactly one approved Auth identity was verified through the administration interface. The authenticated owner workflow completed save, simulation, arm and pause operations.
- Fly app `thrynt-engine` is deployed with one `lhr` machine, a health server, persistent Hideki pool subscriptions, `OWNER_ADDRESS` set to the verified public owner wallet, and `EXECUTION_MODE=observe`. `BOT_PRIVATE_KEY` is configured only as a Fly secret; the runtime derives the expected linked-bot address without logging the key. `/healthz` and `/readyz` report ready after the runtime establishes its lease and feed. The temporary `THRYNT_AUTHORIZED_MIN_SELL_PRICE_USD` secret used for the expired bounded-order window has been removed.
- Direct chain verification found owner `0xdA80A0D2FBDEF6eEe94e2e27F82a34896B444126`, linked bot `0x94d8333f14a5ED04634F0F5b7200f5c2f1D294F1`, 15 STT owner gas, 5 STT bot gas, a 1,000 USDso-equivalent voucher margin account, and place/cancel/reduce authorization on all five discovered Hideki markets (BTC, ETH, SOL, XRP and DOGE). These are public testnet reads; balances and permissions can change.

Do not enable live mode or submit a testnet order until the current account/market reads and protocol sizing are rechecked, global pause is deliberately cleared only for the approved bounded window, and the owner authorizes the exact preflight. The approved Auth identity, Fly secret, signer/address comparison and owner/bot separation have already been verified.

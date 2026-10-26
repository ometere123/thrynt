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
| `SOMNIA_RPC_URL` | Fly/local | Yes | Yes | Hideki RPC; must be HTTPS and resolve to chain 50383. |
| `SOMNIA_WS_URL` | Fly/local | Yes | Yes | Hideki secure WebSocket endpoint. |
| `SOMNIA_INDEXER_URL` | Fly/local | Yes | Yes | Hideki GraphQL indexer. |
| `EXECUTION_MODE` | Fly/local | No | Yes | `observe`, `simulate`, or `live`; default is `observe`. |
| `ENABLE_TESTNET_EXECUTION` | Fly/local | No | Yes | Must remain `false` until explicit owner authorization; the engine also requires `EXECUTION_MODE=live`. |
| `ENGINE_INSTANCE_ID` | Fly/local | No | Yes | Stable unique executor identity used by the fenced lease. |

## Deployment status at the last verification

- Vercel project `thrynt` had no environment variables configured.
- Cloudflare Worker `thrynt` existed and its health route returned chain 50383, but its secret inventory was empty.
- The configured Supabase public URL/anon key answered Auth settings, while the local server key was rejected and the application table endpoint returned 404. This means the target schema and server credential must be re-established before telemetry can be called operational.
- Fly had no `thrynt-engine` application visible to the authenticated account.

Do not enable live mode or submit a testnet order until this inventory is populated and independently verified.

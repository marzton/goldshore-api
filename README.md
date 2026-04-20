# goldshore-api — GoldShore API Worker

## Repo → Worker → Domain
| Script | CF Worker | Domain | Status |
|--------|-----------|--------|--------|
| `src/index.ts` | `gs-api` Worker | `api.goldshore.ai` | ✅ Live |

## Cloudflare Account
- **Account:** Gold Shore Labs (`f77de112d2019e5456a3198a8bb50bd2`)
- **Worker:** `gs-api`
- **D1:** `gs_platform_db` (binding: `DB`) · `gs_audit_db` (binding: `AUDIT_DB`)
- **KV:** `GS_API_DATA` (binding: `KV`)
- **R2:** `gs-assets` (binding: `ASSETS`)
- **Queue producer:** `goldshore-jobs` (binding: `QUEUE`)

## Routes
- `GET  /health` — public health check
- `POST /api/contact` — lead form → D1 + MailChannels
- `POST /api/lead` — alias for contact
- `GET  /api/status` — worker status
- `POST /armsway/order` — PayPal order (future)

## Secrets needed
`OPENAI_API_KEY` · `GEMINI_API_KEY` · `CONTROL_SYNC_TOKEN` · `CF_AIG_TOKEN`

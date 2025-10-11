# GoldShore Monorepo

Monorepo for:
- **Admin UI** (Cloudflare Pages)
- **API Worker** (Cloudflare Workers, name: `GoldShore`)
- Shared packages (`packages/ui`, `packages/utils`)

## Quick start

```bash
# choose one package manager; pnpm recommended
corepack enable
pnpm i
pnpm -w ./apps/admin dev
```

## Deploy

* Admin → Cloudflare Pages via `.github/workflows/deploy-pages.yml`
* API → Cloudflare Worker via `.github/workflows/deploy-worker.yml`

Secrets (repo → Settings → Secrets and variables → Actions):

* CLOUDFLARE_ACCOUNT_ID
* CLOUDFLARE_API_TOKEN
* CF_PAGES_PROJECT (e.g. `goldshore-admin`)
* ALPACA_KEY (paper)
* ALPACA_SECRET (paper)
* TRADE_API_TOKEN (Bearer token required for `/trade` requests)
* OPENAI_API_KEY (if used later)

## Phase 1 DNS handoff

Deployment work starts with normalising DNS. Track progress in [`docs/dns/PHASE1_DNS_CHECKLIST.md`](docs/dns/PHASE1_DNS_CHECKLIST.md) and use `scripts/check-dns.sh` to confirm propagation:

```bash
scripts/check-dns.sh
```

Override `EXPECTED_*` environment variables if the Cloudflare targets ever change.


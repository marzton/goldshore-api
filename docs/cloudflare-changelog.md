# Cloudflare Change Ledger

| Date | Area | Before | After | Notes |
| --- | --- | --- | --- | --- |
| 2024-11-20 | Access | Separate admin + API apps, GitHub login disabled | Unified `goldshore-admin` app covers workers.dev + `api.goldshore.org`, GitHub IdP enabled | Aligns with admin console rollout and Access merge |
| 2024-11-12 | DNS | Apex + subdomains pointing to legacy A records and circular CNAMES | Apex/web/www → `goldshore-web.pages.dev`, api → `goldshore-api.gslabs.workers.dev` (proxied) | Legacy records purged; configuration now idempotent |
| 2024-11-12 | Pages | Multiple stale projects + preview aliases | Only `goldshore-web` active, previews protected by Access | Delete orphaned preview routes |
| 2024-11-12 | Access | Mixed login methods (OTP, GitHub, Google) | Single OIDC issuer, allow list for Gold Shore staff, deny-all fallback | Session durations (web: 1d, api: 12h) |
| 2024-11-12 | Workers | Duplicate services/routes (`GoldShore`, `goldshore-staging`) | Single worker `goldshore-api` with deterministic route | Added CORS + Access enforcement |
| 2024-11-12 | GitHub | `gh-pages` branch + Pages enabled | GitHub Pages disabled, branch removed | Wrangler deploy action remains |

> Update this ledger whenever a production-impacting change lands. Keep entries chronological and ensure the “After” column
> always matches [docs/desired-state.md](./desired-state.md).

# Gold Shore Labs · Desired State (Cloudflare + GitHub)

> This document is the single source of truth for the production posture of `goldshore.org`. Every run of our
> automation should compare the live environment to this table and only mutate resources that drift.

## DNS (zone: goldshore.org)

| Name | Type | Target | Proxy | Notes |
| --- | --- | --- | --- | --- |
| `@` | CNAME | `goldshore-web.pages.dev` | Proxied | Apex flattening keeps the record compatible with Pages |
| `www` | CNAME | `goldshore-web.pages.dev` | Proxied | Canonical marketing hostname |
| `web` | CNAME | `goldshore-web.pages.dev` | Proxied | Alternate marketing hostname |
| `api` | CNAME | `goldshore-api.gslabs.workers.dev` | Proxied | Worker production route |
| `*` | (none) | — | — | Wildcard **not** configured; stray hosts must 404 |

All legacy A/AAAA records (`100.2.111.41`, etc.) and circular CNAMES must be deleted.

## Cloudflare Pages (project: `goldshore-web`)

- Production branch: `main`
- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Custom domains: `goldshore.org`, `www.goldshore.org`, `web.goldshore.org` (all TLS active)
- Preview domains: protected by Cloudflare Access (`https://*.goldshore-web.pages.dev/*`)
- Static asset: `public/access-denied.html` published for Access failures

## Cloudflare Workers (service: `goldshore-api`)

- Routes: `api.goldshore.org/*` (zone `goldshore.org`, proxy ON)
- workers.dev: enabled for smoke testing (`https://goldshore-api.gslabs.workers.dev`)
- Entry module: `src/index.ts`
- CORS: allows Gold Shore web origins, `Cf-Access-Jwt-Assertion` header permitted
- Health check: `GET /health` → `{ "ok": true, "service": "goldshore-api" }`
- Authenticated introspection: `GET /v1/whoami` (requires valid Access token)
- Secrets: stored via Wrangler (`wrangler secret put`) using names `ACCESS_ISSUER`, `ACCESS_JWKS_URL`, optional future
  service bindings as needed

## Cloudflare Access

### Login methods

- **Enabled**: OIDC `https://goldshore.cloudflareaccess.com/cdn-cgi/access/sso/oidc/07665be501c60fa585bd8c697d77ebf86ce14f993fa7745ab52f54ad93f523fc`
- **Disabled**: One-time PIN, GitHub, Google, Facebook, service auth that is unused

### Applications

1. **Gold Shore Web (Prod)**
   - Domains: `https://*.goldshore.org/*`, `https://*.goldshore-web.pages.dev/*`
   - Policies (order matters):
     1. Allow: `marstonr6@gmail.com`, domain `goldshore.org`
     2. Default deny
   - Session duration: 1 day
   - Appearance: tags `Gold Shore`, `Web`, `Prod`; logo `https://goldshore-web.pages.dev/images/penrose_logo.svg`
   - Identity failure redirect: `https://goldshore-web.pages.dev/access-denied`

2. **Gold Shore API (Prod)**
   - Domains: `https://api.goldshore.org/*`
   - Policies: same allow list → deny-all
   - Session duration: 12 hours
   - Appearance: tags `Gold Shore`, `API`, `Prod`; same logo
   - Optional: Service Token policy for CI using named tokens (`goldshore-api-ci`)

## GitHub hygiene

- GitHub Pages: **disabled** for `goldshore-web` and `goldshore-api`
- `gh-pages` branch: deleted (if ever recreated, automation removes it)
- No `CNAME` files checked into the repos
- Repository secrets: `CF_ACCOUNT_ID`, `CF_API_TOKEN` (scoped as above)

## Security + Observability

- Access session duration: Web = 24h, API = 12h
- Logs: monitor via Cloudflare Zero Trust → Access → Logs; export to SIEM weekly
- Alerting: pending integration with PagerDuty (stub for future work)

Maintainers must update this document whenever the intended state changes. Treat it as part of the deployment contract.

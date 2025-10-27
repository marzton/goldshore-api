# Gold Shore Labs · API + Access Infrastructure

This repository defines the hardened baseline for the `goldshore-api` Cloudflare Worker and the supporting
Cloudflare Access configuration. Every change is built to be **idempotent**: you can apply the same automation twice and
receive the same result without duplicating resources.

## Components

| Component | Purpose | Desired State |
| --- | --- | --- |
| Cloudflare Worker `goldshore-agent` | Serves AI automation routes behind Access | Routes `api.goldshore.org/*`, `api.banproof.me/*`; workers.dev enabled for smoke tests |
| Cloudflare Pages `goldshore-web` | Marketing + access-denied static assets | Custom domains `goldshore.org`, `www.goldshore.org`, `web.goldshore.org` |
| Cloudflare Pages `goldshore-admin` | Astro-based admin console derived from Cloudflare's SaaS template | Protect behind Access; staging at `goldshore-admin.goldshore.workers.dev`, prod via `/admin` once cut over |
| Cloudflare Access | Enforces SSO before any request touches Pages or the API | Unified `goldshore-admin` Access app covering staging + `api.goldshore.org`; BanProof alias read-only |
| DNS (zone `goldshore.org`) | Routes traffic through Cloudflare with flattening | Apex + subdomains CNAME to Cloudflare-managed targets (see [Desired State](docs/desired-state.md)) |

## Local development

```bash
npm install
npm run build
npm run dev # runs wrangler dev with workers_dev enabled
```

Set the following environment variables when running locally so the worker can validate Cloudflare Access assertions:

- `ACCESS_ISSUER`
- `ACCESS_JWKS_URL`
- `CORS_ORIGINS`

Wrangler automatically reads these values from `wrangler.toml` in development. To impersonate an Access user locally you
can copy the `Cf-Access-Jwt-Assertion` header from a production request and attach it with `--header` when issuing curl
commands against `http://127.0.0.1:8787`.

## Deployment workflow

1. Ensure GitHub secrets `CF_ACCOUNT_ID` and `CF_API_TOKEN` are present (token scope: `Workers KV Storage:Edit`,
   `Workers Routes:Edit`, `Workers Scripts:Edit`, `Pages:Edit`, `Account Settings:Read`).
2. `npm run deploy` → runs `wrangler deploy` using the deterministic configuration in `wrangler.toml`.
3. Visit the Cloudflare dashboard once to confirm the route `api.goldshore.org/*` is attached and proxied.
4. If a re-run of the pipeline finds no drift, the deploy should become a NOOP.

## Access enforcement

- Worker routes must include the header `Cf-Access-Jwt-Assertion` which is verified against the JWKS published by
  Cloudflare Access (`ACCESS_JWKS_URL`).
- The helper in `src/lib/access.ts` caches JWKS responses for five minutes to respect rate limits while staying
  responsive to rotations.
- A branded Access denied page lives at `public/access-denied.html`; configure Access → Authentication → Custom Pages to
  redirect identity failures to `https://goldshore-web.pages.dev/access-denied`.
- The single self-hosted Access application `goldshore-admin` now covers both
  `https://goldshore-admin.goldshore.workers.dev/*` (staging) and `https://api.goldshore.org/*` (production). Require sign
  in with either a Gold Shore Labs email address (`*@goldshore.org`) or a GitHub account granted Access.

## Admin console

The Astro-based admin console lives in [`apps/admin`](apps/admin) and mirrors Cloudflare's SaaS Admin Template. Local
workflow:

```bash
cd apps/admin
npm install
npm run dev
```

`wrangler.jsonc` in that directory documents the bindings that must exist before deploying to Cloudflare Pages. Build
artifacts live in `apps/admin/dist/` and should be published through Pages once Access validates staging traffic at
`goldshore-admin.goldshore.workers.dev`.

## Files of interest

- [`wrangler.toml`](wrangler.toml) — deterministic worker configuration (routes, vars, compatibility date).
- [`src/index.ts`](src/index.ts) — entry point implementing CORS, `/health`, `/status`, `/logs`, `/codex-agent`, `/autoapply`, and `/v1/whoami`.
- [`src/admin.ts`](src/admin.ts) — Access-protected CRUD endpoints for customers and subscriptions stored in D1.
- [`src/risk.ts`](src/risk.ts) — Access-protected risk configuration, rule evaluation, and killswitch controls backed by KV.
- [`src/lib/access.ts`](src/lib/access.ts) — Access JWT validation against Gold Shore Labs' JWKS.
- [`public/access-denied.html`](public/access-denied.html) — Cloudflare Access identity failure landing page.
- [`docs/desired-state.md`](docs/desired-state.md) — compliance summary of DNS, Access, and worker configuration.
- [`docs/cloudflare-changelog.md`](docs/cloudflare-changelog.md) — before/after ledger for any Cloudflare change.

## Validation checklist

1. `curl https://api.goldshore.org/health` returns `{ "ok": true }` with CORS headers allowing your origin.
2. `curl https://api.goldshore.org/v1/whoami` with a valid Access JWT returns the authenticated subject/email.
3. Navigate to any protected domain without being logged in → redirected to Cloudflare Access → failing sign-in ends on
   the branded access denied page.
4. DNS for `goldshore.org`, `www.goldshore.org`, and `web.goldshore.org` resolves to Cloudflare (flattened CNAME →
   `goldshore-web.pages.dev`); `api.goldshore.org` resolves to `goldshore-api.gslabs.workers.dev`.
5. Cloudflare Access dashboard shows OIDC + GitHub login methods enabled with two applications (Web + Admin). The
   `goldshore-admin` app should list domains `goldshore-admin.goldshore.workers.dev/*` and `api.goldshore.org/*`, apply the
   email glob `*@goldshore.org`, allow Gold Shore's GitHub organization, then fall back to deny-all.

Re-running this checklist after each deploy should yield the same answers unless a deliberate change is introduced.

## Admin + Risk API quickstart

All admin and risk routes require a valid Cloudflare Access assertion or the `Cf-Access-Authenticated-User-Email` header. The
following examples assume you have copied an Access JWT into `$ACCESS_TOKEN` and your user has permission to reach the worker.

```bash
# List customers
curl -H "Cf-Access-Jwt-Assertion: $ACCESS_TOKEN" https://api.goldshore.org/v1/admin/customers

# Create a subscription with features
curl -X POST \
  -H "Cf-Access-Jwt-Assertion: $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "core",
        "description": "Baseline membership",
        "price": 1999,
        "features": [
          { "name": "alerts", "description": "Email + SMS alerts" }
        ]
      }' \
  https://api.goldshore.org/v1/admin/subscriptions

# Evaluate a risk metric
curl -X POST \
  -H "Cf-Access-Jwt-Assertion: $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "metric": "max_drawdown", "value": 3.5 }' \
  https://api.goldshore.org/v1/risk/check
```

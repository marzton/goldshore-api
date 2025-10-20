# Gold Shore Labs · API + Access Infrastructure

This repository defines the hardened baseline for the `goldshore-api` Cloudflare Worker and the supporting
Cloudflare Access configuration. Every change is built to be **idempotent**: you can apply the same automation twice and
receive the same result without duplicating resources.

## Components

| Component | Purpose | Desired State |
| --- | --- | --- |
| Cloudflare Worker `goldshore-api` | Serves API routes behind Access | Route `api.goldshore.org/*`, workers.dev enabled for smoke tests |
| Cloudflare Pages `goldshore-web` | Marketing + access-denied static assets | Custom domains `goldshore.org`, `www.goldshore.org`, `web.goldshore.org` |
| Cloudflare Access | Enforces SSO before any request touches Pages or the API | Only the Gold Shore Labs OIDC provider is enabled; allow Gold Shore staff, deny all else |
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

## Files of interest

- [`wrangler.toml`](wrangler.toml) — deterministic worker configuration (routes, vars, compatibility date).
- [`src/index.ts`](src/index.ts) — entry point implementing CORS, `/health`, and `/v1/whoami` with Access enforcement.
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
5. Cloudflare Access dashboard shows **only** the OIDC login method enabled and two applications (Web + API) with allow
   policy for `marstonr6@gmail.com` and `*@goldshore.org`, followed by a deny-all policy.

Re-running this checklist after each deploy should yield the same answers unless a deliberate change is introduced.

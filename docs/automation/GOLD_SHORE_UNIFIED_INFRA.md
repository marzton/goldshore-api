# Gold Shore Unified Infrastructure Agent Directive

Here’s the precise agent prompt you can give to your deployment or GitHub Actions automation to make it fully understand how api.goldshore.org and goldshore-web coexist and integrate cleanly under the same Cloudflare + GitHub setup:

---

## 🧭 Agent Directive: Gold Shore Unified Infrastructure

### Objective

Maintain a unified Cloudflare + GitHub deployment where:
- **goldshore-web** serves the public front-end (Astro + Tailwind via Cloudflare Pages).
- **api.goldshore.org** serves the backend API (TypeScript Worker deployed via Wrangler).
- Both operate under the same domain **goldshore.org** without conflicts or downtime.

---

## Architecture Overview

| Component            | URL                                         | Platform                  | Purpose                                                      |
| -------------------- | ------------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| Front-end (web)      | https://goldshore.org & https://www.goldshore.org | Cloudflare Pages (goldshore-web) | Public-facing UI, marketing, and admin dashboard routes.     |
| API (backend)        | https://api.goldshore.org                   | Cloudflare Workers (goldshore-api) | Handles trading data, AI endpoints, backtests, and integrations. |
| Auth / Access        | https://goldshore.cloudflareaccess.com      | Cloudflare Zero Trust     | Protects /admin and private /v1/* routes across both layers. |

---

## Rules of Operation

### 1. GoldShore-Web (Pages project)
- **Repository:** `goldshore/goldshore-web`
- **Framework:** Astro + Tailwind
- **Build command:**
  ```bash
  npm run build
  ```
- **Output directory:** `dist`
- **Custom domains:**
  - `goldshore.org`
  - `www.goldshore.org`
  - `web.goldshore.org`
- Pages project automatically uses Cloudflare CDN and CNAME flattening for root-level delivery.

### 2. GoldShore-API (Worker project)
- **Repository:** `goldshore/goldshore-api`
- **Deployment via:** `npx wrangler deploy`
- **Route mapping (Cloudflare → Workers):**
  ```json
  {
    "pattern": "api.goldshore.org/*",
    "zone_name": "goldshore.org"
  }
  ```
- **Worker subdomain (auto):** `https://goldshore-api.gslabs.workers.dev`
- The Worker binds automatically to the goldshore.org zone through Wrangler configuration:
  ```json
  {
    "name": "goldshore-api",
    "routes": [
      { "pattern": "api.goldshore.org/*", "zone_name": "goldshore.org" }
    ]
  }
  ```

### 3. DNS Configuration (Cloudflare DNS tab)
- ✅ `goldshore.org` → `goldshore-web.pages.dev` (proxied)
- ✅ `www.goldshore.org` → `goldshore-web.pages.dev` (proxied)
- ❌ `api.goldshore.org` should not have a CNAME — the Worker route automatically binds traffic. (If present, remove any `api → goldshore.org` CNAME record.)

### 4. Access Integration
- Protected routes use Cloudflare Access policy with:
  - `ACCESS_ISSUER=https://goldshore.cloudflareaccess.com`
  - `ACCESS_JWKS_URL=https://goldshore.cloudflareaccess.com/cdn-cgi/access/certs`
- Workers verify JWT headers to restrict internal `/admin` and `/v1/private` endpoints.

---

## Automation Logic for the Agent

When updating or deploying:
1. **Check repository context.**
   - If repo = `goldshore-web`: use Cloudflare Pages build + deploy.
   - If repo = `goldshore-api`: use Wrangler Worker deploy only.
2. **Verify DNS state before deploy.**
   - `api.goldshore.org` must have no CNAME or A record.
   - Root (`goldshore.org`) must CNAME to `goldshore-web.pages.dev`.
3. **Run Wrangler validation.**
   - Confirm Worker is bound to `goldshore.org` zone and has route defined:
     ```
     api.goldshore.org/*
     ```
   - Confirm environment variables exist:
     - `CORS_ORIGINS`
     - `ACCESS_ISSUER`
     - `ACCESS_JWKS_URL`
4. **Auto-repair if mismatch found:**
   - If `api.goldshore.org` is missing route: create via `wrangler routes add`.
   - If DNS points to wrong origin: correct via Cloudflare API call.
   - If web and api share a Pages project: decouple automatically (delete Jekyll Pages builds).

---

## Verification Tests

After each deployment, run:
```bash
curl -I https://goldshore.org        # should return HTML headers
curl -I https://api.goldshore.org    # should return JSON or 200 from Worker
curl -I https://goldshore-api.gslabs.workers.dev  # backup worker endpoint
```

### Expected results
- `goldshore.org` → `200 OK` HTML
- `api.goldshore.org` → `200 OK` JSON
- No redirect loops or 522 errors.

---

## Final Notes
- The Worker never needs a Pages project.
- The Pages project never needs Wrangler.
- Cloudflare DNS + Wrangler route = handshake between the two.
- `api.goldshore.org` and `goldshore.org` live symbiotically, not hierarchically.

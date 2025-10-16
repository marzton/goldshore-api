# GoldShore Monorepo

Monorepo for:
- **Admin UI** (Cloudflare Pages)
- **API Worker** (Cloudflare Workers, name: `GoldShore`)
- **Marketing Web** (Astro static site in `apps/web`)
- Shared packages (`packages/ui`, `packages/utils`)

## Quick start

```bash
# choose one package manager; pnpm recommended
corepack enable
pnpm i
pnpm -w ./apps/admin dev

# marketing site lives in apps/web
cd apps/web
npm install
npm run dev
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
* OPENAI_API_KEY (if used later)

## Phase 1 DNS handoff

Deployment work starts with normalising DNS. Track progress in [`docs/dns/PHASE1_DNS_CHECKLIST.md`](docs/dns/PHASE1_DNS_CHECKLIST.md) and use `scripts/check-dns.sh` to confirm propagation:

```bash
scripts/check-dns.sh
```

Override `EXPECTED_*` environment variables if the Cloudflare targets ever change.

# goldshore-api

GoldShore API. See [README-API.md](README-API.md) for the modular Cloudflare Worker surface, bindings, and endpoint map.

## Phase 1 Deployment: DNS reset and verification

This repository coordinates the infrastructure work required to bring the GoldShore API online. The following brief captures the current environment status and the exact steps the deployment agent should execute first.

### Current state snapshot

| Component | Status | Notes |
| --- | --- | --- |
| GitHub org `goldshore` | ✅ created, repos `goldshore-web` and `goldshore-api` | |
| GoldShore Deployer (App ID 2099597) | ✅ owned by org, permissions correct, webhook points to `api.goldshore.org/webhook/github` | |
| Secrets | ✅ in both repos (no `GITHUB_` prefixes) | |
| OpenAI + Cloudflare tokens | ✅ stored | |
| DNS | ❌ old records still pointing at wrong places | |
| Worker | ⏳ not deployed yet | |
| Pages site | ⏳ waiting for DNS + first build | |

### Agent issue template

- **Repository:** `goldshore-api`
- **Issue title:** `DNS reset and domain verification (Phase 1 Deployment)`

#### Summary

Fix all DNS mis-points and verify that both the Pages and Worker environments resolve before proceeding with app or pipeline work.

#### Step-by-step execution

1. **Export backup of existing DNS zone**
   - Cloudflare → goldshore.org → DNS → Advanced → Export zone file (save copy).
2. **Clean base DNS**

   | Type | Name | Target | Proxy | Purpose |
   | --- | --- | --- | --- | --- |
   | CNAME | `@` | `goldshore-web.pages.dev` | **Proxied** | root site |
   | CNAME | `www` | `goldshore-web.pages.dev` | **Proxied** | alias |
   | CNAME | `api` | `workers.dev` | **Proxied** | Worker endpoint placeholder |
   | MX / TXT | keep existing | | | email |

   - Remove all other A/AAAA/CNAME records that point to dev or staging hosts.
3. **Verify propagation**
   - `nslookup goldshore.org` → should return Cloudflare IPs.
   - `nslookup api.goldshore.org` → should return Cloudflare IPs.
   - Wait until DNS tab shows green checks for all three records.
4. **Attach domains**
   - Pages → project `goldshore-web` → Custom Domains → add `goldshore.org` and `www.goldshore.org`.
   - Worker → service `GoldShore` → Triggers → Add Route `api.goldshore.org/*`.
5. **Verify SSL/TLS**
   - Cloudflare → SSL/TLS → mode = **Full (strict)**.
6. **Confirm reachability**
   - `https://goldshore.org` → returns Pages splash (after deploy).
   - `https://api.goldshore.org/health` → returns `ok` (once Worker live).
7. **Post DNS summary**
   - Include Cloudflare DNS table (redact MX/TXT if sensitive).
   - Confirm domain verification success for Pages + Worker.

### Next steps after DNS

1. Trigger the first Pages deploy via workflow `deploy-pages.yml` in `goldshore-web` (branch `main`).
2. Deploy the Worker via workflow `deploy-worker.yml` in this repository.
3. Verify GitHub App webhooks: App → Recent Deliveries → expect 200 from `/webhook/github`.

> **TL;DR for the agent:** Normalize goldshore.org DNS, attach Pages and Worker domains, ensure SSL is set to Full (strict), then proceed to the initial deploy workflows once verification is complete.

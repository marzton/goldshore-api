# GoldShore API Repository

This repository houses the GoldShore API Cloudflare Worker and supporting packages. The worker is the only active deployment target; any legacy Pages or admin references from earlier iterations have been retired.

## Quick start

```bash
npm install
npm run dev
```

The dev server listens on `http://127.0.0.1:8787`. Provide `CF-Access-*` headers when exercising `/v1/*` routes locally.

## Deploy

* API → Cloudflare Worker via `.github/workflows/deploy-worker.yml`

Required repository secrets (Settings → Secrets and variables → Actions):

* `CLOUDFLARE_ACCOUNT_ID`
* `CLOUDFLARE_API_TOKEN`
* `ALPACA_KEY` (paper)
* `ALPACA_SECRET` (paper)
* `OPENAI_API_KEY` (if used later)

## Environment snapshot

| Component | Status | Notes |
| --- | --- | --- |
| GitHub org `goldshore` | ✅ created, repos `goldshore-web` and `goldshore-api` | `goldshore-web` is archived; deployments run only from this repo. |
| GoldShore Deployer (App ID 2099597) | ✅ owned by org, permissions correct, webhook points to `api.goldshore.org/webhook/github` | |
| Secrets | ✅ stored without `GITHUB_` prefixes | |
| DNS | ❌ old records still pointing at wrong places | Reset to worker-only targets per checklist below. |
| Worker | ⏳ not deployed yet | Use the deploy workflow once DNS is correct. |

## Phase 1 deployment: DNS reset and verification

Only the API worker should be reachable during this phase. The checklist below replaces the previous Pages + Worker dual setup.

### Agent issue template

- **Repository:** `goldshore-api`
- **Issue title:** `DNS reset and domain verification (Phase 1 Deployment)`

#### Summary

Fix all DNS mis-points and verify that the Worker environment resolves before proceeding with app or pipeline work.

#### Step-by-step execution

1. **Export backup of existing DNS zone**
   - Cloudflare → goldshore.org → DNS → Advanced → Export zone file (save copy).
2. **Clean base DNS**

   | Type | Name | Target | Proxy | Purpose |
   | --- | --- | --- | --- | --- |
   | CNAME | `api` | `workers.dev` | **Proxied** | Worker endpoint placeholder |
   | MX / TXT | keep existing | | | email |

   - Remove A/AAAA/CNAME records that point to unused Pages or staging hosts.
3. **Verify propagation**
   - `nslookup api.goldshore.org` → should return Cloudflare IPs.
   - Wait until the DNS tab shows green checks for the records above.
4. **Attach domain to Worker**
   - Worker → service `GoldShore` → Triggers → Add Route `api.goldshore.org/*`.
5. **Verify SSL/TLS**
   - Cloudflare → SSL/TLS → mode = **Full (strict)**.
6. **Confirm reachability**
   - `https://api.goldshore.org/health` → returns `ok` (once Worker live).
7. **Post DNS summary**
   - Include Cloudflare DNS table (redact MX/TXT if sensitive).
   - Confirm domain verification success for the Worker route.

### Next steps after DNS

1. Deploy the Worker via workflow `deploy-worker.yml` in this repository.
2. Verify GitHub App webhooks: App → Recent Deliveries → expect 200 from `/webhook/github`.

> **TL;DR for the agent:** Normalize the goldshore.org DNS so only the API worker is routed, ensure SSL is set to Full (strict), then use the Worker deploy workflow once verification is complete.

# Cloudflare Manual Cutover Gate (Dashboard-Only)

## Repository
`marzton/goldshore-api`

## Purpose
This runbook is the **manual cutover gate** for Cloudflare dashboard changes that cannot be safely automated from this repository.

## Locked Host Map (freeze before cutover)

### goldshore.ai
- `gw.goldshore.ai` → Worker `gs-platform`
- `api.goldshore.ai` → Worker `gs-api` (standby/migration target; not primary while `.org` is canonical)
- `agent.goldshore.ai` → Worker `gs-agent`
- `goldshore.ai` and `www.goldshore.ai` → Pages (`gs-web`) if intentionally web-owned

### goldshore.org
- `goldshore.org` and `www.goldshore.org` → Pages
- `api.goldshore.org` → Worker route/custom domain only if still required by the `.org` stack

> Decision gate: do **not** leave both `api.goldshore.ai` and `api.goldshore.org` as ambiguous primary API hosts. Confirm one primary per environment and document redirects explicitly.

## Ordered Execution Plan

### 1) Fix Cloudflare Access first (highest risk)
For the active Access app protecting the runtime surface:
- Replace policy: `non_identity + everyone`
- With policy: `identity` with the existing production allowlist preserved (`*@goldshore.org` and existing break-glass identities)
- Only add `*@goldshore.ai` after a planned identity migration that keeps `.org` access functional during transition

Why first:
- Existing posture behaves like an open gate.

After policy correction, delete stale Access applications:
- `gs-mail` ×2
- `gs-platform` ×2
- `gs-api` ×2
- `goldshore-core` ×2
- `banproof-me` ×2

Control:
- Perform policy correction before deleting stale apps so the active app is not lost.

### 2) Attach Worker custom domains
In Workers:
- `gs-platform` → add `gw.goldshore.ai`
- `gs-api` → keep `api.goldshore.org` as the active production API custom domain (current repo contract)
- `gs-agent` → add `agent.goldshore.ai`
- Do **not** switch production clients to `api.goldshore.ai` in this runbook unless the repository config (`apps/api-worker/wrangler.toml`, `apps/web/wrangler.toml`, and `apps/web/_headers` CSP `connect-src`) is migrated in the same change window

After each binding, verify:
1. Custom domain is attached to the intended Worker.
2. No duplicate hostname is attached elsewhere.
3. Health endpoint responds after binding.

### 3) Disconnect redundant `goldshore-ai` build
In Workers / Pages / Build settings for `goldshore-ai`:
- Disconnect Git build.

Constraint:
- Do **not** delete the Worker yet unless all dependencies have been confirmed absent.

### 4) Fix `goldshore.org` mail DNS
In DNS for `goldshore.org`, add:
- SPF TXT at apex (`@`):
  - `v=spf1 include:_spf.mx.cloudflare.net ~all`
- DMARC TXT at `_dmarc`:
  - `v=DMARC1; p=none; rua=mailto:<reporting-address>`

Note:
- If no reporting inbox is ready, use the standardized Cloudflare-generated reporting address.

### 5) Fix `armsway.com` mail routing
In DNS for `armsway.com`, add Cloudflare Email Routing MX records with Cloudflare-required priorities:
- `route1.mx.cloudflare.net`
- `route2.mx.cloudflare.net`
- `route3.mx.cloudflare.net`

Also verify:
- SPF record exists and is valid.
- Conflicting legacy MX records are removed.

### 6) Verify hostnames and health
Run after changes propagate:
- `curl -I https://gw.goldshore.ai/health`
- `curl -I https://api.goldshore.org/health`
- `curl -I https://agent.goldshore.ai/health`

Optional (migration readiness only, not production cutover):
- `curl -I https://api.goldshore.ai/health`

Also verify public DNS resolution for:
- New TXT records (SPF/DMARC)
- New MX records

### 7) Continue deploy/cutover only after verification
No deploy/cutover continuation until steps 1-6 succeed.

## Architecture cautions
1. **`api.goldshore.ai` vs `api.goldshore.org`**
   - Current production contract in-repo is `api.goldshore.org`; treat it as canonical until configuration is migrated.
   - If both must exist temporarily, document exact ownership and redirects before any client/API switch.
2. **`goldshore.ai` ownership model**
   - If Git build is disconnected for `goldshore-ai`, ensure `gs-web` Pages is the intentional owner of `goldshore.ai`.
   - Remove split-brain paths from docs and deployment automation.

## Change Control Checklist
- [ ] Access policy updated to identity while preserving current `*@goldshore.org` allowlist (and break-glass identities)
- [ ] Stale Access apps removed (listed duplicates)
- [ ] Worker custom domains attached (`gw`, `api`, `agent`)
- [ ] `api.goldshore.org` remains the active production API endpoint unless coordinated config migration (`apps/api-worker/wrangler.toml`, `apps/web/wrangler.toml`, and `apps/web/_headers` CSP `connect-src`) is completed
- [ ] `goldshore-ai` Git build disconnected
- [ ] `goldshore.org` SPF + DMARC records added
- [ ] `armsway.com` Cloudflare MX added with correct priorities
- [ ] Health checks return expected status
- [ ] Public DNS checks confirm TXT/MX propagation
- [ ] Deploy/cutover resumed only after all checks pass

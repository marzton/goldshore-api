# Phase 1 DNS reset and verification

This checklist mirrors the GoldShore Phase 1 deployment instructions. Update it whenever DNS changes are applied so the next operator can see the latest state.

## 1. Export current zone file
- [ ] Downloaded Cloudflare zone export and attached to the operations vault.
- Notes:

## 2. Required records
Confirm the Cloudflare DNS table matches this baseline:

| Type | Name | Target | Proxy | Verified |
| ---- | ---- | ------ | ----- | -------- |
| CNAME | @ | `goldshore-web.pages.dev` | Proxied | [ ] |
| CNAME | www | `goldshore-web.pages.dev` | Proxied | [ ] |
| CNAME | api | `workers.dev` | Proxied | [ ] |
| MX/TXT | (existing) | (unchanged) | — | [ ] |

Additional notes:

## 3. Propagation checks
Run `scripts/check-dns.sh` or the commands below and record results.

```bash
nslookup goldshore.org
nslookup api.goldshore.org
```

- Apex resolves to Cloudflare IPs: [ ]
- API subdomain resolves to Cloudflare IPs: [ ]

## 4. Domain attachments
- [ ] Cloudflare Pages project `goldshore-web` has `goldshore.org` and `www.goldshore.org` verified.
- [ ] Cloudflare Worker service `goldshore-api` has the route `api.goldshore.org/*` configured in Wrangler.

## 5. SSL/TLS
- [ ] Cloudflare SSL/TLS mode is **Full (strict)**.

## 6. Reachability (after deploys)
- [ ] `https://goldshore.org` returns the Pages splash (record screenshot or hash).
- [ ] `https://api.goldshore.org/health` returns `ok`.

## 7. Summary
Document any deviations, pending tasks, or tickets created during this phase.

- Status:
- Follow-ups:
- Timestamp:

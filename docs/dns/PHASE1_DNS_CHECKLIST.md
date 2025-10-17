# Phase 1 DNS reset and verification

This checklist mirrors the GoldShore Phase 1 deployment instructions. Update it whenever DNS changes are applied so the next operator can see the latest state.

## 1. Export current zone file
- [ ] Downloaded Cloudflare zone export and attached to the operations vault.
- Notes:

## 2. Required records
Confirm the Cloudflare DNS table matches this worker-only baseline:

| Type | Name | Target | Proxy | Verified |
| ---- | ---- | ------ | ----- | -------- |
| CNAME | api | `workers.dev` | Proxied | [ ] |
| MX/TXT | (existing) | (unchanged) | — | [ ] |

Additional notes:

## 3. Propagation checks
Run `scripts/check-dns.sh` or the commands below and record results.

```bash
nslookup api.goldshore.org
```

- API subdomain resolves to Cloudflare IPs: [ ]

## 4. Domain attachments
- [ ] Cloudflare Worker service `GoldShore` has the route `api.goldshore.org/*`.

## 5. SSL/TLS
- [ ] Cloudflare SSL/TLS mode is **Full (strict)**.

## 6. Reachability (after deploys)
- [ ] `https://api.goldshore.org/health` returns `ok`.

## 7. Summary
Document any deviations, pending tasks, or tickets created during this phase.

- Status:
- Follow-ups:
- Timestamp:

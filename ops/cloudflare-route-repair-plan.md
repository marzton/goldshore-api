# Cloudflare Route and Binding Repair Plan

## Repository
`marzton/goldshore-api`

## Objective
Make runtime ownership explicit for API traffic while preventing route collisions with static Pages properties.

## Target ownership
- `api.goldshore.ai`: API worker
- `admin.goldshore.ai`: placeholder or admin shell when routed here
- `preview.goldshore.ai`: staging entry when routed here
- apex and `www`: static-first, not intercepted by this service

## Guardrails
- Verify required KV namespaces, D1, R2, service bindings, secrets, and environment variables before deploy.
- Verify DNS records exist for required routed hosts.
- Verify staging and production bindings are separated.
- Fail deployment when any critical binding or DNS target is missing.

## Validation
- `api.goldshore.ai/health` returns 200.
- No route owned by this worker captures apex or `www` traffic.
- Admin and preview routes resolve only if intentionally attached.

## Rollback
Capture prior route IDs, script names, binding names, and DNS record IDs before cutover.

# Infra notes

## Cloudflare Access (Auth)
- Protect `https://goldshore.org/admin/*`
- Zero Trust → Access → Applications → Self-hosted
- Policy: Email OTP or Google SSO (your addresses)

## DNS
- `goldshore.org` → Pages project (admin)
- `api.goldshore.org/*` → Worker route → Service: `goldshore-api`

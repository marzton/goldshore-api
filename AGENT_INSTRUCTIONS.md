# GoldShore – Agent Instructions

## Architecture

- API: `apps/api` (Cloudflare Worker, Hono)
- Admin Dashboard: `apps/admin` (React / Next / Astro – specify here)
- Marketing Site: `apps/web`
- AI Gateway: `apps/gateway`
- Shared types: `packages/schema`
- Shared UI: `packages/ui`
- Infra: `goldshore-infra` Terraform (Cloudflare Pages + Workers + DNS + Access)

## Protocols

1. **The API contract is available at the `/openapi.json` endpoint** of the `api.goldshore.org` service. Always consult this endpoint before touching admin/web that depend on the API.
2. **Always import types from `@goldshore/schema`** instead of re-defining shapes.
3. **Do not edit Cloudflare in the dashboard** – use `goldshore-infra` Terraform only.

## Feature Changelog

### `apps/api`

- 2025-11-19 – `GET /v1/users/{id}` added. See `apps/api/openapi.json`.

### `apps/admin`

- 2025-11-19 – User detail panel consumes `GET /v1/users/{id}` and displays `User` type.

### `apps/web`

- 2025-11-19 – Restored "Shaping Waves" hero + theme tokens from `packages/ui`.

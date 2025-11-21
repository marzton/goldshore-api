# Agent Identity: Canonical GoldShore Backend

This project (`goldshore-api`) is the single, authoritative backend service for the GoldShore organization.

## Core Directives

- **Canonical Source:** This repository is the only source of truth for the Cloudflare Worker named `goldshore-api`.
- **No Duplication:** No other repository is permitted to define or deploy a Worker with the name `goldshore-api`.
- **External Dependency:** All other GoldShore projects and repositories **must** treat the API as an external service, available only at its public URL.
- **Public URL:** The single, canonical public endpoint for this service is `https://api.goldshore.org`. All absolute URLs required by the application should be constructed using the `API_PUBLIC_URL` environment variable.

## Agent Scope

- Agents operating in this repository are authorized to modify, deploy, and manage the `goldshore-api` Worker.
- Agents **must not** attempt to manage or configure resources belonging to other projects (e.g., `goldshore-web`, `goldshore-admin`) from this codebase.

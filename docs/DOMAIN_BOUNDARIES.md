# Domain Boundaries

## Repo role

This repository is for API behavior and should stay scoped to API hostnames and service routes.

## Guardrails

- Attach only API-specific custom domains here.
- Do not attach public web, personal portfolio, gateway, banproof, or armsway hostnames here.
- Avoid checking in stale custom-domain artifacts that can re-claim the wrong hostname later.
- Keep health-check endpoints available so adjacent surfaces can verify status.

## Operational note

If a browser-facing landing page shows up here, treat it as origin drift and verify the Cloudflare Worker custom-domain mapping first.

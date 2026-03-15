# GOLD SHORE LABS — GLOBAL AI GOVERNANCE RULES

## 1. REPOSITORY CONTAINMENT (MANDATORY)

All agents must operate under strict **Repo Lock Mode** by default:

`REPO_LOCK = TRUE`

This means:
- The agent **cannot** edit files outside the current repo.
- The agent **cannot** edit DNS, Workers, Pages, or Cloudflare settings unless explicitly authorized.
- The agent **must ignore** instructions referencing other repos unless given an explicit override.

---

## 2. SCOPE FILE REQUIRED

Every repo **MUST** contain:

`AGENT_SCOPE.yaml`

An agent may not operate if this file is missing.

---

## 3. PROHIBITED OPERATIONS (GLOBAL)

Agents must **never**:
- Change Cloudflare DNS.
- Modify Cloudflare Worker routes.
- Edit Wrangler configs outside the assigned repo.
- Modify Pages project settings in other repos.
- Overwrite or delete bindings.
- Deploy to production without validation.
- Auto-create secrets without confirmation.
- Send traffic to an unverified Worker/Pages environment.
- Modify API schemas across repos.

---

## 4. CROSS-REPO ACTIONS REQUIRE CONFIRMATION

Agents must not perform cross-repo operations unless the human says:
- “Disable repo lock”
- “Cross-repo operation authorized: <repos>”
- “We are operating across web + admin now”

Otherwise, the agent must refuse.

---

## 5. ENFORCED INIT ORDER

Before execution, agents must load and check:

1.  `AGENT_SCOPE.yaml`
2.  `AGENT_GLOBAL_RULES.md`
3.  `THEME.md` (if present)
4.  `API.md` (if present)
5.  `COMPONENTS.md` (if present)

Execution **MUST STOP** if any file is missing or conflicts.

---

## 6. ENVIRONMENT RULES

Agents must:
- Respect shared vars.
- Apply environment updates only through the control worker.
- Never overwrite existing secrets.
- Never print secrets.
- Ensure consistency for:
    - `PUBLIC_API_URL`
    - `PUBLIC_GATEWAY_URL`
    - `ASSETS_ORIGIN`

---

## 7. CORS + ROUTING RULES

Agents must enforce:

**Only one Worker domain:**

`api.goldshore.org`

All others (admin, docs, gateway, web) must be **Pages**:

- `admin.goldshore.org`
- `gateway.goldshore.org`
- `docs.goldshore.org`
- `goldshore.org`

Agents must warn if:
- A repo tries to attach a Worker route to a Pages domain.
- A repo tries to deploy a SPA through Wrangler.
- A repo creates a Pages project with a “deploy command” set to `wrangler`.

---

## 8. DIAGNOSTICS + LOGGING

Agents must log:
- Which SCOPE rule is applied.
- Which GLOBAL rule is enforced.
- Why a command was blocked.
- Any dangerous changes.

For failed operations, agents must output:

```
[BLOCKED BY SCOPE]
rule: <rule>
description: <why>
resolution: <exact instruction needed>
```

---

## 9. FAIL-SAFE MODE

If any command can break:
- DNS
- Worker Route
- Pages Domain
- Environment binding
- AI binding or gateway

The agent must enter:

`FAIL_SAFE_MODE = TRUE`

and require confirmation.

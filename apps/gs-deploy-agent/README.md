# gs-deploy-agent

Gold Shore Labs deployment orchestration worker.
Manages GitHub branch/commit/PR operations and Cloudflare Worker deployments via REST API.

## Deploy in 4 steps

### 1. Run the D1 migration

```bash
wrangler d1 execute gs_audit_db \
  --file=migrations/001_agent_audit.sql \
  --remote
```

### 2. Set secrets

```bash
# GitHub fine-grained PAT
# Permissions: Contents RW, Pull requests RW, Metadata R, Administration RW
wrangler secret put GITHUB_TOKEN --name gs-deploy-agent

# Cloudflare account-owned token
# Permissions: Workers Scripts:Edit, Workers Routes:Edit, Account Settings:Read
wrangler secret put CLOUDFLARE_API_TOKEN --name gs-deploy-agent

# Agent auth token (protects all /api/* routes)
# Generate: openssl rand -hex 32
wrangler secret put AGENT_TOKEN --name gs-deploy-agent
```

### 3. Deploy

```bash
wrangler deploy
```

### 4. Add DNS record for control UI (optional)

```
Type:  CNAME
Name:  agent-deploy
Value: gs-deploy-agent.<your-subdomain>.workers.dev
Proxy: true
```

Then the UI is at: `https://agent-deploy.goldshore.ai`

---

## API reference

All `/api/*` routes require: `Authorization: Bearer <AGENT_TOKEN>`

| Method | Path | Body |
|--------|------|------|
| POST | `/api/github/branch` | `{repo, branch, from?}` |
| POST | `/api/github/commit` | `{repo, branch, files:[{path,content}], message}` |
| POST | `/api/github/pr` | `{repo, head, base?, title, body?, draft?}` |
| GET  | `/api/repos` | — |
| POST | `/api/cf/deploy` | `{scriptName, source, compatibilityDate?, bindings?, routes?}` |
| POST | `/api/cf/secret` | `{scriptName, name, value}` |
| POST | `/api/cf/route` | `{scriptName, pattern, zoneId}` |
| GET  | `/api/workers` | — |
| POST | `/api/pipeline` | `{repo, branch, files, commitMessage, prTitle, prBody?, deploy?}` |
| GET  | `/health` | — |

---

## Pipeline example (curl)

```bash
curl -X POST https://agent-deploy.goldshore.ai/api/pipeline \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "rmarston.github.io",
    "branch": "feat/agent-real-site-2026-04-18",
    "commitMessage": "feat: replace bootstrap demo with real rmarston.com site",
    "prTitle": "[Agent] Real rmarston.com site — DM Serif, terracotta, no Bootstrap",
    "prBody": "Auto-deployed by gs-deploy-agent.\n\n## Changes\n- dist/index.html replaced with real personal hub\n- wrangler.jsonc updated with production bindings",
    "files": [
      {
        "path": "dist/index.html",
        "content": "<html>...</html>"
      },
      {
        "path": "wrangler.jsonc",
        "content": "{ \"name\": \"rmarston-com\" ... }"
      }
    ]
  }'
```

Response:
```json
{
  "ok": true,
  "prUrl": "https://github.com/marzton/rmarston.github.io/pull/42",
  "steps": {
    "branch": { "ok": true, "url": "https://github.com/marzton/rmarston.github.io/tree/feat/agent-real-site-2026-04-18" },
    "commit": { "ok": true, "results": [{"path":"dist/index.html","ok":true}] },
    "pr": { "ok": true, "url": "...", "number": 42 }
  }
}
```

PRs are always created as **draft** — human reviews before merge.

---

## Repos in scope

- `marzton/rmarston.github.io`
- `marzton/goldshore.github.io`
- `marzton/banproof.me`
- `marzton/goldshore-ai`
- `marzton/armsway` (create if needed)

---

## Security notes

- `AGENT_TOKEN` never touches GitHub or Cloudflare — it only authenticates to this agent
- Secret values are never logged (only secret names appear in audit)
- PRs are always created as draft — no auto-merge
- All operations are written to `gs_audit_db` D1 table `agent_audit`

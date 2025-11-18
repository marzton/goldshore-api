# Infra notes

## Cloudflare Access (Auth)
- Protect `https://goldshore.org/admin/*`
- Zero Trust → Access → Applications → Self-hosted
- Policy: Email OTP or Google SSO (your addresses)

## DNS
- `api.goldshore.org/*` → Worker route → Service: `GoldShore`

### Prevent Cloudflare 522 on goldshore.org

When `goldshore.org` is served through Cloudflare but hosted on GitHub Pages, a misconfigured DNS zone can trigger Cloudflare
Error 522 (connection timed out). Use the following checklist whenever we provision or audit the marketing site's DNS:

1. **Root A records** – only the four GitHub Pages IP addresses should exist for the apex domain and each must stay proxied:

   | Type | Name | Value | Proxy Status |
   | ---- | ---- | ----- | ------------ |
   | A | @ | 185.199.108.153 | Proxied |
   | A | @ | 185.199.109.153 | Proxied |
   | A | @ | 185.199.110.153 | Proxied |
   | A | @ | 185.199.111.153 | Proxied |

2. **`www` CNAME** – point `www.goldshore.org` to the GitHub Pages host (e.g. `goldshore.github.io`) and keep the record proxied.

3. **SSL/TLS mode** – in Cloudflare → SSL/TLS → Overview, set the mode to **Full (Strict)** so Cloudflare requires GitHub's
   certificate.

4. **GitHub Pages settings** – in the repository Settings → Pages screen, set the Custom domain to `www.goldshore.org` and
   enable **Enforce HTTPS** so GitHub issues the certificate Cloudflare validates against.

5. **Propagation** – after adjustments, allow 5–10 minutes for DNS to propagate and then retest `https://www.goldshore.org/`.

Following this playbook keeps Cloudflare and GitHub Pages in sync and prevents 522 timeouts when visitors resolve the apex or
`www` hostnames.

## Secret bundle distribution

The repository now tracks `env.secrets.bundle.json`, a canonical map of Cloudflare, GitHub, and provider credentials. Publish the
bundle to the destinations that need it without overwriting existing copies.

### Cloudflare KV (Workers)

Upload the bundle to a Cloudflare KV namespace as a single JSON blob:

```bash
# Uses metadata from env.secrets.bundle.json by default
node infra/scripts/publish-env-bundle.mjs \
  --bundle env.secrets.bundle.json \
  --namespaces CONFIG_KV \
  --key ENV_SECRETS_BUNDLE
```

The script pulls `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from (in order) CLI flags, environment variables, or the
`cloudflare` section inside the bundle. Before writing the payload it checks the namespace for the same key and skips the write if
a value already exists, satisfying the "do not overwrite" requirement for production KV stores. Run the script again only after
the upstream value has been removed or rotated manually.

### GitHub repositories

To mirror the bundle into a GitHub repository (for example `goldshore-gateway`) without force pushing or overwriting files that
already exist, use the companion uploader:

```bash
node infra/scripts/publish-github-bundle.mjs \
  --bundle env.secrets.bundle.json \
  --repo goldshore/goldshore-gateway \
  --path infra/env.secrets.bundle.json \
  --branch main
```

`publish-github-bundle.mjs` checks for the target path on the specified branch and exits early if the file is already present. It
pulls the GitHub token from `--token`, `GITHUB_TOKEN`, or `codex_agent.GITHUB_TOKEN` inside the bundle (in that order). Pass
`--force` if you need to re-upload after deleting the previous version in the remote repository.

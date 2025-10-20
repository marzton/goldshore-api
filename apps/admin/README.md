# Gold Shore Labs Admin Console

This package hosts the Gold Shore Labs admin experience, adapted from Cloudflare's [SaaS Admin Template](https://github.com/cloudflare/templates/tree/main/saas-admin-template). It ships as an Astro application backed by Cloudflare D1 and Workflows and is intended to be deployed as a Cloudflare Pages project (with Functions) alongside the existing `goldshore-api` Worker.

## Local development

```bash
cd apps/admin
npm install
npm run db:migrate    # applies migrations against the local D1 database
npm run dev           # starts Astro on http://localhost:4321
```

The Astro dev server proxies bindings defined in [`wrangler.jsonc`](./wrangler.jsonc) so that D1, Workflows, and secrets behave the same way they do in production. Update the `database_id` with your Cloudflare D1 database identifier before running remote migrations or deploying.

### Environment variables

| Name        | Purpose                                        |
| ----------- | ---------------------------------------------- |
| `API_TOKEN` | Shared secret that gates the admin REST API.   |

Create a `.dev.vars` file in this directory to supply local values:

```bash
API_TOKEN=replace-with-dev-token
```

## Database migrations

The SaaS admin schema migrations live in [`../../drizzle/admin`](../../drizzle/admin). Wrangler is configured to point at that directory, so the usual commands continue to work:

```bash
npm run db:migrate         # apply locally
npm run db:migrate:remote  # apply against the remote D1 database
npm run db:reset           # reset the local database
```

## Deployment

1. Provision the required bindings (D1 database, Workflow, and the `API_TOKEN` secret) in your Cloudflare account.
2. Run `npm run build` to produce the optimized Astro output.
3. Deploy through the Cloudflare Pages pipeline. The build output in `dist/` can be uploaded directly, and Pages Functions will execute the API routes located under [`src/pages/api`](./src/pages/api).

Once deployed, route `/admin` (or your chosen hostname) through Access so the dashboard inherits the same controls as the API worker.

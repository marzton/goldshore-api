# Goldshore API Worker

Cloudflare Workers API that orchestrates trading, market data, news/filings, research, ads, reports, and backtests for Goldshore. This document captures the modular `/v1` surface so new providers can plug in without touching the entrypoint.

## Routing overview

- `GET /health` — public readiness probe.
- `/v1/*` — protected by Cloudflare Access (requires `CF-Access-*` headers).

### Auth & session
- `GET /v1/whoami` — returns the Access-authenticated email address.

### Trading & accounts (Alpaca)
- `GET /v1/broker/orders?status=open|closed`
- `POST /v1/broker/orders`

### Market data (Polygon primary, room for Yahoo fallback)
- `GET /v1/market/quote?symbol=AAPL`
- `GET /v1/market/ohlc?symbol=SPY&tf=day&limit=100`

### News & filings
- `GET /v1/news/headlines?symbols=AAPL,MSFT`
- `GET /v1/edgar/filings?cik=0000320193&type=10-K`

### YouTube research
- `GET /v1/youtube/search?q=...`

### Reports & backtests
- `POST /v1/reports/generate`
- `GET /v1/reports/:id`
- `POST /v1/backtests/run`
- `GET /v1/backtests/:id`

## Platform bindings (configure in `wrangler.jsonc`)

- KV namespace `KV_CACHE` for response caching.
- D1 database `DB` for user/report/backtest metadata.
- R2 bucket `R2` for report/backtest artifacts (future work: signed URLs).
- Queue producer `JOBS` (and matching consumer) for async workers (report + backtest jobs).

### Provisioning resources

Create the Cloudflare resources once per environment (names/IDs can be swapped to match your account):

```bash
# KV
wrangler kv namespace create KV_CACHE

# D1 (then load schema with the command below)
wrangler d1 create goldshore_db

# Queues (binds as "jobs" in wrangler.jsonc)
wrangler queues create jobs

# R2
wrangler r2 bucket create goldshore-reports
```

Update the generated IDs in `wrangler.jsonc` after creation.

## Required secrets

Set via `wrangler secret put ...` or Dashboard:

- `ALPACA_KEY`, `ALPACA_SECRET`
- `POLYGON_KEY`
- `YOUTUBE_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`, `GOOGLE_CSE_ID`
- Any ad platform tokens when those handlers are implemented.

Optional:
- `ALPACA_BASE_URL` to override the API host (live trading vs paper).
- `TRADE_WEBHOOK_TOKEN` if the trade UI pushes jobs directly.

The worker exposes feature toggles (`FEATURE_NEWS`, `FEATURE_REPORTS`, `FEATURE_BACKTESTS`) and TTL knobs (`NEWS_MAX_AGE`, `QUOTES_MAX_AGE`) in `wrangler.jsonc`. Override them per-environment via the `env` blocks (`preview`, `staging`, `production`) and remember to keep `/v1/*` routes behind Cloudflare Access in production deployments.

## D1 schema

Schema lives in [`schema/d1.sql`](schema/d1.sql). Apply with:

```bash
npx wrangler d1 execute goldshore_db --file=schema/d1.sql --remote
```

## Local development

```bash
npm install
npm run dev
```

Use `CF-Access-*` headers locally to hit `/v1` routes or stub `requireAccess` if you prefer an open dev mode.

## Smoke tests

```bash
curl -si http://127.0.0.1:8787/health
curl -si "http://127.0.0.1:8787/v1/market/quote?symbol=AAPL" \
  -H "CF-Access-Authenticated-User-Email: test@goldshore.org"
```

> Production deployments should keep `/v1/*` behind Access. Rotate API keys and respect provider rate limits/licensing.

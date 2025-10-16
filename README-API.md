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

### Research & integrations
- `GET /v1/research/lookup`
- `GET /v1/ads/summary`
- `POST /v1/webhooks/:provider`

## Endpoint wiring cheatsheet

Each `/v1` handler returns placeholder JSON from `src/handlers/*` until a provider is connected. The router in [`src/router.ts`](src/router.ts) maps the method + path to a typed `RequestContext` that exposes the original `Request`, `Env`, parsed `URL`, and dynamic params. Future implementations can swap in real provider calls without modifying [`src/index.ts`](src/index.ts).

| Route | Handler | Required bindings | TODO summary |
| --- | --- | --- | --- |
| `GET /v1/whoami` | [`handleWhoami`](src/handlers/auth.ts) | Access headers (runtime) | Resolve Access identity into user profile metadata. |
| `GET /v1/broker/orders` | [`handleGetOrders`](src/handlers/broker.ts) | `ALPACA_KEY`, `ALPACA_SECRET` | Call Alpaca orders API and respect status filters. |
| `POST /v1/broker/orders` | [`handleCreateOrder`](src/handlers/broker.ts) | `ALPACA_KEY`, `ALPACA_SECRET` | Submit trade ticket to Alpaca and persist audit log. |
| `GET /v1/market/quote` | [`handleMarketQuote`](src/handlers/market.ts) | `POLYGON_KEY`, `KV_CACHE` | Fetch NBBO quote from Polygon with cache + fallback. |
| `GET /v1/market/ohlc` | [`handleMarketOHLC`](src/handlers/market.ts) | `POLYGON_KEY`, `KV_CACHE` | Aggregate candle data and cache. |
| `GET /v1/news/headlines` | [`handleNewsHeadlines`](src/handlers/news.ts) | `POLYGON_KEY`, `KV_CACHE` | Fan out to news providers and normalize. |
| `GET /v1/edgar/filings` | [`handleEdgarFilings`](src/handlers/edgar.ts) | `KV_CACHE` | Pull SEC EDGAR filings and cache metadata. |
| `GET /v1/youtube/search` | [`handleYouTubeSearch`](src/handlers/youtube.ts) | `YOUTUBE_API_KEY` | Query YouTube search API for research clips. |
| `POST /v1/reports/generate` | [`handleGenerateReport`](src/handlers/reports.ts) | `DB`, `R2`, `JOBS` | Persist report job, enqueue worker, return tracking ID. |
| `GET /v1/reports/:id` | [`handleGetReport`](src/handlers/reports.ts) | `DB`, `R2` | Return report status and signed artifacts. |
| `POST /v1/backtests/run` | [`handleRunBacktest`](src/handlers/backtests.ts) | `DB`, `R2`, `JOBS` | Persist backtest request and enqueue worker. |
| `GET /v1/backtests/:id` | [`handleGetBacktest`](src/handlers/backtests.ts) | `DB`, `R2` | Return backtest status + artifacts. |
| `GET /v1/research/lookup` | [`handleResearchLookup`](src/handlers/research.ts) | `GOOGLE_API_KEY`, `GOOGLE_CSE_ID` | Bridge to research search providers and capture citations. |
| `GET /v1/ads/summary` | [`handleAdsSummary`](src/handlers/ads.ts) | `DB` (future ad credentials) | Aggregate ad platform spend/performance. |
| `POST /v1/webhooks/:provider` | [`handleWebhookEvent`](src/handlers/webhooks.ts) | `DB`, `JOBS` | Validate signatures and dispatch provider-specific workflows. |

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

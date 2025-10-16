import { cacheGetSet } from "../lib/cache";
import { ok } from "../lib/util";
import type { Env } from "../types";
import { polygon } from "../lib/providers/polygon";

export async function getQuote(env: Env, url: URL) {
  const symbol = url.searchParams.get("symbol") || "AAPL";
  const ttl = Number(env.QUOTES_MAX_AGE || 30);
  const key = `q:${symbol}`;
  const data = await cacheGetSet(env, key, ttl, async () => {
    try {
      const response = await polygon(env, `/v2/last/nbbo/${symbol}`);
      return { provider: "polygon", data: response };
    } catch {
      return { provider: "fallback", data: null };
    }
  });
  return ok({ ok: true, symbol, ...data });
}

export async function getOHLC(env: Env, url: URL) {
  const symbol = url.searchParams.get("symbol") || "SPY";
  const tf = url.searchParams.get("tf") || "day";
  const limit = url.searchParams.get("limit") || "100";
  const ttl = 60;
  const key = `ohlc:${symbol}:${tf}:${limit}`;
  const data = await cacheGetSet(env, key, ttl, async () => {
    const response = await polygon(env, `/v2/aggs/ticker/${symbol}/range/1/${tf}/2024-01-01/2025-10-15`, { limit });
    return { provider: "polygon", tf, data: response };
  });
  return ok({ ok: true, symbol, ...data });
import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleMarketQuote(ctx: RequestContext): Promise<Response> {
  const symbol = ctx.url.searchParams.get("symbol") ?? "AAPL";

  return ok(
    {
      ok: true,
      route: "GET /v1/market/quote",
      symbol,
      bindings: ["POLYGON_KEY", "KV_CACHE"],
      todo: "Fetch NBBO quote from Polygon with KV caching and Yahoo fallback.",
    },
    ctx.cors,
  );
}

export async function handleMarketOHLC(ctx: RequestContext): Promise<Response> {
  const symbol = ctx.url.searchParams.get("symbol") ?? "SPY";
  const tf = ctx.url.searchParams.get("tf") ?? "day";
  const limit = ctx.url.searchParams.get("limit") ?? "100";

  return ok(
    {
      ok: true,
      route: "GET /v1/market/ohlc",
      symbol,
      tf,
      limit,
      bindings: ["POLYGON_KEY", "KV_CACHE"],
      todo: "Aggregate candles via Polygon, hydrate fallback provider, and persist TTL cache.",
    },
    ctx.cors,
  );
}

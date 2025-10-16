import { cacheGetSet } from "../lib/cache";
import { ok } from "../lib/util";
import type { Env } from "../types";
import { polygon } from "../lib/providers/polygon";

export async function getQuote(env: Env, url: URL, headers: HeadersInit) {
  const symbol = url.searchParams.get("symbol") || "AAPL";
  const ttl = Number(env.QUOTES_MAX_AGE || 30);
  const cacheKey = `q:${symbol}`;
  const payload = await cacheGetSet(env, cacheKey, ttl, async () => {
    try {
      const data = await polygon(env, `/v2/last/nbbo/${symbol}`);
      return { provider: "polygon", data };
    } catch {
      return { provider: "fallback", data: null };
    }
  });
  return ok({ ok: true, symbol, ...payload }, headers);
}

export async function getOHLC(env: Env, url: URL, headers: HeadersInit) {
  const symbol = url.searchParams.get("symbol") || "SPY";
  const tf = url.searchParams.get("tf") || "day";
  const limit = url.searchParams.get("limit") || "100";
  const ttl = 60;
  const cacheKey = `ohlc:${symbol}:${tf}:${limit}`;
  const payload = await cacheGetSet(env, cacheKey, ttl, async () => {
    const data = await polygon(env, `/v2/aggs/ticker/${symbol}/range/1/${tf}/2024-01-01/2025-10-15`, { limit });
    return { provider: "polygon", tf, data };
  });
  return ok({ ok: true, symbol, ...payload }, headers);
}

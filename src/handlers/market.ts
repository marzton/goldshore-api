import { cacheGetSet } from "../lib/cache";
import { ok } from "../lib/util";
import type { Env } from "../types";
import { polygon } from "../lib/providers/polygon";

export async function getQuote(env: Env, url: URL) {
  const symbol = url.searchParams.get("symbol") || "AAPL";
  const ttl = Number(env.QUOTES_MAX_AGE || 30);
  const key = `q:${symbol}`;
  const data = await cacheGetSet(env, key, ttl, async () => {
    try { return { provider: "polygon", data: await polygon(env, `/v2/last/nbbo/${symbol}`) }; }
    catch { return { provider: "fallback", data: null }; }
  });
  return ok({ ok: true, symbol, ...data });
}

export async function getOHLC(env: Env, url: URL) {
  const symbol = url.searchParams.get("symbol") || "SPY";
  const tf = url.searchParams.get("tf") || "day";
  const limit = url.searchParams.get("limit") || "100";
  const ttl = 60;
  const key = `ohlc:${symbol}:${tf}:${limit}`;
  const data = await cacheGetSet(env, key, ttl, async () => ({
    provider: "polygon",
    data: await polygon(env, `/v2/aggs/ticker/${symbol}/range/1/${tf}/2024-01-01/2025-10-15`, { limit }),
    tf
  }));
  return ok({ ok: true, symbol, ...data });
}

import { cacheGetSet } from "../lib/cache";
import { ok } from "../lib/util";
import type { Env } from "../types";
import { polygon } from "../lib/providers/polygon";

export async function getQuote(env: Env, url: URL, cors: HeadersInit) {
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
  return ok({ ok: true, symbol, ...data }, cors);
}

export async function getOHLC(env: Env, url: URL, cors: HeadersInit) {
  const symbol = url.searchParams.get("symbol") || "SPY";
  const tf = url.searchParams.get("tf") || "day";
  const limit = url.searchParams.get("limit") || "100";
  const from = url.searchParams.get("from") || "2024-01-01";
  const to =
    url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const ttl = 60;
  const key = `ohlc:${symbol}:${tf}:${limit}:${from}:${to}`;
  const data = await cacheGetSet(env, key, ttl, async () => {
    const response = await polygon(
      env,
      `/v2/aggs/ticker/${symbol}/range/1/${tf}/${from}/${to}`,
      { limit },
    );
    return { provider: "polygon", tf, data: response };
  });
  return ok({ ok: true, symbol, ...data }, cors);
}

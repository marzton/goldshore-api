import { cacheGetSet } from "../lib/cache";
import { ok } from "../lib/util";
import type { Env } from "../types";

export async function headlines(env: Env, url: URL, headers: HeadersInit) {
  const symbols = url.searchParams.get("symbols") || "AAPL,MSFT";
  const ttl = Number(env.NEWS_MAX_AGE || 300);
  const cacheKey = `news:${symbols}`;
  const data = await cacheGetSet(env, cacheKey, ttl, async () => ({
    items: [
      {
        title: "Placeholder headline",
        symbols: symbols.split(",").map(s => s.trim()),
        at: new Date().toISOString()
      }
    ]
  }));
  return ok({ ok: true, symbols: symbols.split(",").map(s => s.trim()), data }, headers);
}

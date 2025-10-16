import { cacheGetSet } from "../lib/cache";
import { ok } from "../lib/util";
import type { Env } from "../types";

export async function headlines(env: Env, url: URL) {
  const symbols = url.searchParams.get("symbols") || "AAPL,MSFT";
  const ttl = Number(env.NEWS_MAX_AGE || 300);
  const key = `news:${symbols}`;
  const data = await cacheGetSet(env, key, ttl, async () => ({
    items: [
      {
        title: "Placeholder headline",
        symbols: symbols.split(","),
        at: new Date().toISOString()
      }
    ]
  }));
  return ok({ ok: true, symbols: symbols.split(","), data });
}

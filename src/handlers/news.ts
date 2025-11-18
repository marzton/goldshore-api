import { cacheGetSet } from "../lib/cache";
import { ok } from "../lib/util";
import type { Env } from "../types";

const normalizeSymbols = (value: string) =>
  value
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

export async function headlines(env: Env, url: URL, headers: HeadersInit) {
  const symbolsParam = url.searchParams.get("symbols") || "AAPL,MSFT";
  const symbols = normalizeSymbols(symbolsParam);
  const ttl = Number(env.NEWS_MAX_AGE || 300);
  const cacheKey = `news:${symbols.join(",")}`;
  const data = await cacheGetSet(env, cacheKey, ttl, async () => ({
    items: [
      {
        title: "Placeholder headline",
        symbols,
        at: new Date().toISOString()
      }
    ]
  }));
  return ok({ ok: true, symbols, data }, headers);
}

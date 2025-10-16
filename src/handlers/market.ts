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

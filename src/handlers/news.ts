import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleNewsHeadlines(ctx: RequestContext): Promise<Response> {
  const symbols = ctx.url.searchParams.get("symbols") ?? "AAPL,MSFT";

  return ok(
    {
      ok: true,
      route: "GET /v1/news/headlines",
      symbols,
      bindings: ["POLYGON_KEY", "NEWS_MAX_AGE", "KV_CACHE"],
      todo: "Fan out to news providers and normalize payload with caching.",
    },
    ctx.cors,
  );
}

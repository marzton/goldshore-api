import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleEdgarFilings(ctx: RequestContext): Promise<Response> {
  const query = Object.fromEntries(ctx.url.searchParams.entries());

  return ok(
    {
      ok: true,
      route: "GET /v1/edgar/filings",
      query,
      bindings: ["KV_CACHE"],
      todo: "Query SEC EDGAR RSS and cache normalized filing metadata.",
    },
    ctx.cors,
  );
}

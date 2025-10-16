import { ok } from "../lib/util";
import type { Env } from "../types";

export async function listFilings(env: Env, url: URL) {
  const cik = url.searchParams.get("cik") || "";
  const type = url.searchParams.get("type") || "10-K";
  const limit = Number(url.searchParams.get("limit") || "10");
  const data = {
    provider: "sec-edgar",
    cik,
    type,
    limit,
    items: []
  };
  return ok({ ok: true, data });
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

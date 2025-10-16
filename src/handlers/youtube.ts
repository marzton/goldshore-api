import { ok, bad } from "../lib/util";
import type { Env } from "../types";

export async function ytSearch(env: Env, url: URL) {
  const q = url.searchParams.get("q") || "";
  if (!q) return bad("MISSING_QUERY", 400);
  return ok({ ok: true, items: [], q });
import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleYouTubeSearch(ctx: RequestContext): Promise<Response> {
  const q = ctx.url.searchParams.get("q") ?? "market outlook";

  return ok(
    {
      ok: true,
      route: "GET /v1/youtube/search",
      query: q,
      bindings: ["YOUTUBE_API_KEY"],
      todo: "Call YouTube search API and normalize results.",
    },
    ctx.cors,
  );
}

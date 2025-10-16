import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleResearchLookup(ctx: RequestContext): Promise<Response> {
  const query = Object.fromEntries(ctx.url.searchParams.entries());

  return ok(
    {
      ok: true,
      route: "GET /v1/research/lookup",
      query,
      bindings: ["GOOGLE_API_KEY", "GOOGLE_CSE_ID"],
      todo: "Bridge to research providers (Google CSE, OpenAI, etc.) and normalize citations.",
    },
    ctx.cors,
  );
}

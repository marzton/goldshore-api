import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleAdsSummary(ctx: RequestContext): Promise<Response> {
  return ok(
    {
      ok: true,
      route: "GET /v1/ads/summary",
      bindings: ["DB"],
      todo: "Connect to ad platform APIs and expose aggregated spend/performance metrics.",
    },
    ctx.cors,
  );
}

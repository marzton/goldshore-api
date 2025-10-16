import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleWebhookEvent(ctx: RequestContext): Promise<Response> {
  const provider = ctx.params.provider;
  const payload = await ctx.request.json().catch(() => null);

  return ok(
    {
      ok: true,
      route: "POST /v1/webhooks/:provider",
      provider,
      payload,
      bindings: ["DB", "JOBS"],
      todo: "Validate webhook signatures and dispatch provider-specific workflows.",
    },
    ctx.cors,
  );
}

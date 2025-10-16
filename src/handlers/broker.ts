import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleGetOrders(ctx: RequestContext): Promise<Response> {
  const query = Object.fromEntries(ctx.url.searchParams.entries());

  return ok(
    {
      ok: true,
      route: "GET /v1/broker/orders",
      query,
      bindings: ["ALPACA_KEY", "ALPACA_SECRET"],
      todo: "Use Alpaca orders API and respect status filters.",
    },
    ctx.cors,
  );
}

export async function handleCreateOrder(ctx: RequestContext): Promise<Response> {
  const payload = await ctx.request.json().catch(() => null);

  return ok(
    {
      ok: true,
      route: "POST /v1/broker/orders",
      payload,
      bindings: ["ALPACA_KEY", "ALPACA_SECRET"],
      todo: "Submit order to Alpaca and persist audit trail to DB.",
    },
    ctx.cors,
  );
}

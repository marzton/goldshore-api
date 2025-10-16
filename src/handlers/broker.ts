import { ok, bad } from "../lib/util";
import type { Env } from "../types";
import { alpaca } from "../lib/providers/alpaca";

export async function getOrders(env: Env, url: URL) {
  const status = url.searchParams.get("status") || "open";
  const data = await alpaca(env, `/orders?status=${encodeURIComponent(status)}`);
  return ok({ ok: true, data });
}

export async function createOrder(env: Env, req: Request) {
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") return bad("MISSING_FIELDS", 400);

  const payload = body as Record<string, unknown>;
  const symbol = payload.symbol;
  const qtyValue =
    typeof payload.qty === "number"
      ? payload.qty
      : typeof payload.qty === "string"
        ? Number(payload.qty)
        : NaN;
  const side = payload.side;

  if (typeof symbol !== "string" || Number.isNaN(qtyValue) || typeof side !== "string") {
    return bad("MISSING_FIELDS", 400);
  }

  const data = await alpaca(env, `/orders`, {
    method: "POST",
    body: JSON.stringify({ ...payload, qty: qtyValue })
  });
  return ok({ ok: true, data });
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

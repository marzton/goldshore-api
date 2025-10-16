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
}

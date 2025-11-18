import { ok, bad } from "../lib/util";
import type { Env } from "../types";
import { alpaca } from "../lib/providers/alpaca";

export async function getOrders(env: Env, url: URL, headers: HeadersInit) {
  try {
    const status = url.searchParams.get("status") || "open";
    const data = await alpaca(env, `/orders?status=${encodeURIComponent(status)}`);
    return ok({ ok: true, data }, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ALPACA_ERROR";
    return bad(message, 502, headers);
  }
}

export async function createOrder(env: Env, req: Request, headers: HeadersInit) {
  if (!env.ALPACA_KEY || !env.ALPACA_SECRET) {
    return bad("ALPACA credentials not configured", 503, headers);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("INVALID_BODY", 400, headers);
  }

  const payload = body as Record<string, unknown>;
  if (
    typeof payload.symbol !== "string" ||
    (typeof payload.qty !== "number" && typeof payload.qty !== "string") ||
    typeof payload.side !== "string"
  ) {
    return bad("MISSING_FIELDS", 400, headers);
  }

  try {
    const data = await alpaca(env, "/orders", { method: "POST", body: JSON.stringify(payload) });
    return ok({ ok: true, data }, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ALPACA_ERROR";
    return bad(message, 502, headers);
  }
}

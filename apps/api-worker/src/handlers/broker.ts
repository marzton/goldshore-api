import { ok, bad } from "../lib/util";
import type { Env } from "../types";
import { alpaca } from "../lib/providers/alpaca";

export async function getOrders(env: Env, url: URL, headers: HeadersInit) {
  try {
    const status = url.searchParams.get("status") || "open";
    const data = await alpaca(env, `/orders?status=${encodeURIComponent(status)}`);
    return ok({ ok: true, data }, headers);
  } catch (error) {
    return bad(error instanceof Error ? error.message : "ALPACA_ERROR", 502, headers);
  }
}

export async function createOrder(env: Env, req: Request, headers: HeadersInit) {
  if (!env.ALPACA_KEY || !env.ALPACA_SECRET) {
    return bad("ALPACA credentials not configured", 503, headers);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return bad("INVALID_BODY", 400, headers);
  }
  if (!("symbol" in body) || !("qty" in body) || !("side" in body)) {
    return bad("MISSING_FIELDS", 400, headers);
  }
  try {
    const data = await alpaca(env, "/orders", {
      method: "POST",
      body: JSON.stringify(body)
    });
    return ok({ ok: true, data }, headers);
  } catch (error) {
    return bad(error instanceof Error ? error.message : "ALPACA_ERROR", 502, headers);
  }
}

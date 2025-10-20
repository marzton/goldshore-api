import { ok, bad } from "../lib/util";
import type { Env } from "../types";
import { alpaca } from "../lib/providers/alpaca";

type OrderPayload = {
  symbol: string;
  qty: number | string;
  side: string;
  [key: string]: unknown;
};

function isOrderPayload(value: unknown): value is OrderPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.symbol === "string" && (typeof record.qty === "number" || typeof record.qty === "string") && typeof record.side === "string";
}

export async function getOrders(env: Env, url: URL) {
  const status = url.searchParams.get("status") || "open";
  return ok({ ok: true, data: await alpaca(env, `/orders?status=${encodeURIComponent(status)}`) });
}

export async function createOrder(env: Env, req: Request) {
  const body = await req.json().catch(() => null);
  if (!isOrderPayload(body)) return bad("MISSING_FIELDS", 400);
  return ok({ ok: true, data: await alpaca(env, `/orders`, { method: "POST", body: JSON.stringify(body) }) });
}

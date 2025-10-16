import { ok, bad } from "../lib/util";
import type { Env } from "../types";

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function postBacktest(env: Env, req: Request) {
  const payload = normalizePayload(await req.json().catch(() => null));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO backtests (id, owner, strategy, params, r2_key, status) VALUES (?1,?2,?3,?4,?5,?6)"
  ).bind(
    id,
    "unknown",
    typeof payload.strategy === "string" ? payload.strategy : "sma",
    JSON.stringify(payload),
    "",
    "queued"
  ).run();
  await env.JOBS.send({ kind: "backtest", id });
  return ok({ ok: true, id, status: "queued" });
}

export async function getBacktest(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT * FROM backtests WHERE id=?1").bind(id).first();
  if (!row) return bad("NOT_FOUND", 404);
  return ok({ ok: true, backtest: row });
}

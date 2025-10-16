import { ok, bad } from "../lib/util";
import type { Env } from "../types";

export async function postBacktest(env: Env, req: Request, headers: HeadersInit) {
  if (!env.DB || !env.JOBS) {
    return bad("BACKTESTS_NOT_CONFIGURED", 503, headers);
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const strategy = typeof body.strategy === "string" ? body.strategy : "sma";
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO backtests (id, owner, strategy, params, r2_key, status) VALUES (?1,?2,?3,?4,?5,?6)"
  )
    .bind(id, "unknown", strategy, JSON.stringify(body), "", "queued")
    .run();
  await env.JOBS.send({ kind: "backtest", id });
  return ok({ ok: true, id, status: "queued" }, headers);
}

export async function getBacktest(env: Env, id: string, headers: HeadersInit) {
  if (!env.DB) {
    return bad("BACKTESTS_NOT_CONFIGURED", 503, headers);
  }
  const row = await env.DB.prepare("SELECT * FROM backtests WHERE id=?1").bind(id).first();
  if (!row) {
    return bad("NOT_FOUND", 404, headers);
  }
  return ok({ ok: true, backtest: row }, headers);
}

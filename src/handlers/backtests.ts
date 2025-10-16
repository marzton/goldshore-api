import { ok, bad } from "../lib/util";
import type { Env } from "../types";

export async function postBacktest(env: Env, req: Request, cors: HeadersInit) {
  const body = (await req.json().catch(() => null)) as unknown;
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const id = crypto.randomUUID();
  const record = {
    id,
    owner: "unknown",
    strategy: typeof payload.strategy === "string" ? payload.strategy : "sma",
    params: JSON.stringify(payload),
    r2_key: "",
    status: "queued"
  };
  await env.DB.prepare(
    "INSERT INTO backtests (id, owner, strategy, params, r2_key, status) VALUES (?1,?2,?3,?4,?5,?6)"
  )
    .bind(record.id, record.owner, record.strategy, record.params, record.r2_key, record.status)
    .run();
  await env.JOBS.send({ kind: "backtest", id });
  return ok({ ok: true, id, status: "queued" }, cors);
}

export async function getBacktest(env: Env, id: string, cors: HeadersInit) {
  const row = await env.DB.prepare("SELECT * FROM backtests WHERE id=?1").bind(id).first();
  if (!row) return bad("NOT_FOUND", 404, cors);
  return ok({ ok: true, backtest: row }, cors);
}

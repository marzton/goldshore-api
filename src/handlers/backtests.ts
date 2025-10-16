import { ok, bad } from "../lib/util";
import type { Env } from "../types";

export async function postBacktest(env: Env, req: Request) {
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
  return ok({ ok: true, id, status: "queued" });
}

export async function getBacktest(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT * FROM backtests WHERE id=?1").bind(id).first();
  if (!row) return bad("NOT_FOUND", 404);
  return ok({ ok: true, backtest: row });
import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleRunBacktest(ctx: RequestContext): Promise<Response> {
  const payload = await ctx.request.json().catch(() => null);

  return ok(
    {
      ok: true,
      route: "POST /v1/backtests/run",
      payload,
      bindings: ["DB", "R2", "JOBS"],
      todo: "Persist backtest request, enqueue worker job, and stream status updates.",
    },
    ctx.cors,
  );
}

export async function handleGetBacktest(ctx: RequestContext): Promise<Response> {
  const { id } = ctx.params;

  return ok(
    {
      ok: true,
      route: "GET /v1/backtests/:id",
      id,
      bindings: ["DB", "R2"],
      todo: "Return backtest status summary and signed artifact URLs.",
    },
    ctx.cors,
  );
}

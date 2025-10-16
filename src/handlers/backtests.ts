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

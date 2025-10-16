import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleGenerateReport(ctx: RequestContext): Promise<Response> {
  const payload = await ctx.request.json().catch(() => null);

  return ok(
    {
      ok: true,
      route: "POST /v1/reports/generate",
      payload,
      bindings: ["DB", "R2", "JOBS"],
      todo: "Persist report job, enqueue worker task, and return tracking ID.",
    },
    ctx.cors,
  );
}

export async function handleGetReport(ctx: RequestContext): Promise<Response> {
  const { id } = ctx.params;

  return ok(
    {
      ok: true,
      route: "GET /v1/reports/:id",
      id,
      bindings: ["DB", "R2"],
      todo: "Lookup report status/artifacts from D1 + R2 and sign URLs.",
    },
    ctx.cors,
  );
}

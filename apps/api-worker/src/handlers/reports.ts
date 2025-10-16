import { ok, bad } from "../lib/util";
import type { Env } from "../types";

export async function generateReport(env: Env, req: Request, headers: HeadersInit) {
  if (!env.DB || !env.JOBS) {
    return bad("REPORTING_NOT_CONFIGURED", 503, headers);
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = crypto.randomUUID();
  const r2Key = `reports/${id}.json`;
  const kind = typeof body.kind === "string" ? body.kind : "custom";
  await env.DB.prepare(
    "INSERT INTO reports (id, owner, kind, params, r2_key, status) VALUES (?1,?2,?3,?4,?5,?6)"
  )
    .bind(id, "unknown", kind, JSON.stringify(body), r2Key, "generating")
    .run();
  await env.JOBS.send({ kind: "report", id });
  return ok({ ok: true, id, status: "queued" }, headers);
}

export async function getReport(env: Env, id: string, headers: HeadersInit) {
  if (!env.DB) {
    return bad("REPORTING_NOT_CONFIGURED", 503, headers);
  }
  const row = await env.DB.prepare("SELECT * FROM reports WHERE id=?1").bind(id).first();
  if (!row) {
    return bad("NOT_FOUND", 404, headers);
  }
  return ok({ ok: true, report: row }, headers);
}

import { ok, bad } from "../lib/util";
import type { Env } from "../types";

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function generateReport(env: Env, req: Request, headers: HeadersInit) {
  if (!env.DB || !env.JOBS) {
    return bad("REPORTING_NOT_CONFIGURED", 503, headers);
  }
  const payload = normalizePayload(await req.json().catch(() => null));
  const kind = typeof payload.kind === "string" ? payload.kind : "custom";
  const id = crypto.randomUUID();
  const r2Key = `reports/${id}.json`;
  await env.DB.prepare("INSERT INTO reports (id, owner, kind, params, r2_key, status) VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(id, "unknown", kind, JSON.stringify(payload), r2Key, "generating")
    .run();
  await env.JOBS.send({ kind: "report", id });
  return ok({ ok: true, id, status: "queued" }, headers);
}

export async function getReport(env: Env, id: string, headers: HeadersInit) {
  if (!env.DB) {
    return bad("REPORTING_NOT_CONFIGURED", 503, headers);
  }
  const row = await env.DB.prepare("SELECT * FROM reports WHERE id=?1").bind(id).first();
  if (!row) return bad("NOT_FOUND", 404, headers);
  return ok({ ok: true, report: row }, headers);
}

import { ok, bad } from "../lib/util";
import type { Env } from "../types";

export async function generateReport(env: Env, req: Request, cors: HeadersInit) {
  const body = (await req.json().catch(() => null)) as unknown;
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const id = crypto.randomUUID();
  const record = {
    id,
    owner: "unknown",
    kind: typeof payload.kind === "string" ? payload.kind : "custom",
    params: JSON.stringify(payload),
    r2_key: `reports/${id}.json`,
    status: "queued"
  };
  await env.DB.prepare(
    "INSERT INTO reports (id, owner, kind, params, r2_key, status) VALUES (?1,?2,?3,?4,?5,?6)"
  )
    .bind(record.id, record.owner, record.kind, record.params, record.r2_key, record.status)
    .run();
  await env.JOBS.send({ kind: "report", id });
  return ok({ ok: true, id, status: "queued" }, cors);
}

export async function getReport(env: Env, id: string, cors: HeadersInit) {
  const row = await env.DB.prepare("SELECT * FROM reports WHERE id=?1").bind(id).first();
  if (!row) return bad("NOT_FOUND", 404, cors);
  return ok({ ok: true, report: row }, cors);
}

import { ok, bad } from "../lib/util";
import type { Env } from "../types";

type ReportPayload = Record<string, unknown> | null;

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function generateReport(env: Env, req: Request) {
  const payload = normalizePayload(await req.json().catch(() => null));
  const id = crypto.randomUUID();
  const r2_key = `reports/${id}.json`;
  const db = requireDb(env);
  const jobs = requireJobs(env);
  await db.prepare(
    "INSERT INTO reports (id, owner, kind, params, r2_key, status) VALUES (?1,?2,?3,?4,?5,?6)"
  ).bind(
    id,
    "unknown",
    typeof payload.kind === "string" ? payload.kind : "custom",
    JSON.stringify(payload),
    r2_key,
    "generating"
  ).run();
  await jobs.send({ kind: "report", id });
  return ok({ ok: true, id, status: "queued" });
}

export async function getReport(env: Env, id: string) {
  const db = requireDb(env);
  const row = await db.prepare("SELECT * FROM reports WHERE id=?1").bind(id).first();
  if (!row) return bad("NOT_FOUND", 404);
  return ok({ ok: true, report: row });
}

function requireDb(env: Env): D1Database {
  if (!env.DB) throw new Error("DB binding is not configured");
  return env.DB;
}

function requireJobs(env: Env): Queue {
  if (!env.JOBS) throw new Error("JOBS queue binding is not configured");
  return env.JOBS;
}

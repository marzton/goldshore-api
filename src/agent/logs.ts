import { bad, ok } from "../lib/util";
import type { Env } from "../types";

interface IdentitySummary {
  sub?: string;
  email?: string;
}

export async function handleLogs(
  request: Request,
  env: Env,
  cors: Headers,
  identity: IdentitySummary | null
): Promise<Response> {
  if (!env.SYSTEM_LOGS) {
    return bad("LOGS_UNAVAILABLE", 503, cors, "SYSTEM_LOGS binding not configured");
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(50, Number.parseInt(limitParam, 10))) : 20;

  try {
    const result = await env.SYSTEM_LOGS.list({ limit });
    const ordered = [...result.keys].sort((a, b) => b.name.localeCompare(a.name));
    const entries = await Promise.all(
      ordered.map(async key => {
        const value = await env.SYSTEM_LOGS!.get(key.name);
        let parsed: unknown;
        try {
          parsed = value ? JSON.parse(value) : null;
        } catch (_err) {
          parsed = value ?? null;
        }
        return {
          key: key.name,
          metadata: key.metadata ?? null,
          value: parsed
        };
      })
    );

    return ok(
      {
        ok: true,
        entries,
        identity: identity ?? null
      },
      cors
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read logs";
    return bad("LOGS_ERROR", 502, cors, message);
  }
}

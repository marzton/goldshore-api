import { ok } from "../lib/util";
import type { Env } from "../types";

const ROUTES = ["/codex-agent", "/autoapply", "/status", "/logs", "/v1/whoami", "/health"];

export function handleStatus(env: Env, cors: Headers): Response {
  return ok(
    {
      ok: true,
      service: env.SERVICE_NAME ?? "GoldShore Agent",
      version: env.SERVICE_VERSION ?? "1.0.0",
      time: new Date().toISOString(),
      routes: ROUTES,
      model: env.AI_MODEL ?? "gpt-4o-mini",
      public_admin: env.PUBLIC_ADMIN ?? null
    },
    cors
  );
}

import { corsHeaders } from "./lib/cors";
import { requireAccess } from "./lib/access";
import { bad, ok, unauthorized } from "./lib/util";
import { handleCodexAgent } from "./agent/codex-agent";
import { handleAutoApply } from "./agent/autoapply";
import { handleStatus } from "./agent/status";
import { handleLogs } from "./agent/logs";
import { handle as handleAdmin } from "./admin";
import { handle as handleRisk } from "./risk";
import type { Env } from "./types";

const notFound = (headers: Headers): Response =>
  new Response("Not Found", {
    status: 404,
    headers: withContentType(headers, "text/plain; charset=utf-8")
  });

const withContentType = (headers: Headers, value: string): Headers => {
  const copy = new Headers(headers);
  copy.set("Content-Type", value);
  return copy;
};

const methodNotAllowed = (headers: Headers): Response =>
  bad("METHOD_NOT_ALLOWED", 405, headers);

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(env, request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return ok(
        {
          ok: true,
          service: env.SERVICE_NAME ?? "goldshore-agent",
          time: new Date().toISOString()
        },
        cors
      );
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return handleStatus(env, cors);
    }

    if (url.pathname.startsWith("/v1/")) {
      if (!(await requireAccess(req, env))) return unauthorized(CH);
    if (url.pathname === "/logs" && request.method === "GET") {
      const access = await requireAccess(request, env);
      if (!access.authorized) {
        const headers = new Headers(cors);
        headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
        return unauthorized(headers);
      }
      return handleLogs(request, env, cors, access.identity ?? null);
    }

    if (url.pathname.startsWith("/codex-agent")) {
      if (request.method !== "POST") {
        return methodNotAllowed(cors);
      }

      return handleCodexAgent(request, env, cors);
    }

    if (url.pathname.startsWith("/autoapply")) {
      if (request.method !== "GET" && request.method !== "POST") {
        return methodNotAllowed(cors);
      }

      return handleAutoApply(request, env, cors);
    }

    if (url.pathname === "/v1/whoami") {
      const access = await requireAccess(request, env);
      if (!access.authorized || !access.identity) {
        const headers = new Headers(cors);
        headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
        return unauthorized(headers);
      }

      return ok(
        {
          ok: true,
          sub: access.identity.sub,
          email: access.identity.email ?? null,
          issuer: access.identity.issuer ?? null,
          audience: access.identity.audience ?? null,
          expires_at: access.identity.expiresAt ?? null
        },
        cors
      );
    }

    if (url.pathname.startsWith("/v1/admin")) {
      return handleAdmin(request, env, cors);
    }

    if (url.pathname.startsWith("/v1/risk")) {
      return handleRisk(request, env, cors);
    }

    return notFound(cors);
  }
};

import { corsHeaders } from "./lib/cors";
import { requireAccess } from "./lib/access";
import { bad, ok, unauthorized } from "./lib/util";
import { loadSystemPrompt } from "./agent/prompt";
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
          service: "goldshore-api",
          time: new Date().toISOString()
        },
        cors
      );
    }

    if (url.pathname === "/v1/agent/plan" && request.method === "POST") {
      const access = await requireAccess(request, env);
      if (!access.authorized) {
        const headers = new Headers(cors);
        headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
        return unauthorized(headers);
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch (_err) {
        return bad("INVALID_INPUT", 400, cors, "Body must be valid JSON");
      }

      const body = (payload ?? {}) as Record<string, unknown>;
      const goalRaw = body.goal;
      const goal = typeof goalRaw === "string" ? goalRaw.trim() : "";

      if (!goal) {
        return bad("INVALID_INPUT", 400, cors, "Provide goal field");
      }

      const prompt = await loadSystemPrompt(_ctx, env);
      const plan = [
        "GET /v1/whoami",
        "GET /v1/health",
        "GET /v1/cors",
        "Report status"
      ];

      return ok(
        {
          ok: true,
          data: { plan, goal },
          hint: "Static plan; integrate LLM for dynamic planning.",
          meta: { prompt }
        },
        cors
      );
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

    return notFound(cors);
  }
};

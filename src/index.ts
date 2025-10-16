import { corsHeaders } from "./lib/cors";
import { ok, serverError } from "./lib/util";
import type { Env } from "./types";
import { routeV1 } from "./router";

function requireAccess(req: Request): boolean {
  const jwt = req.headers.get("CF-Access-Jwt-Assertion");
  const email = req.headers.get("CF-Access-Authenticated-User-Email");

  return Boolean(jwt || email);
}

const corsHeaders = (env: Env, req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const allowed = getAllowedOrigins(env.CORS_ALLOWED_ORIGINS || "");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  const allowedOrigin = resolveAllowedOrigin(origin, allowed);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    if (allowedOrigin === "*") {
      delete headers["Vary"];
    }
  }
  return headers;
};
function unauthorized(cors: HeadersInit): Response {
  const headers = new Headers(cors);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
    status: 401,
    headers,
  });
}

function notFound(cors: HeadersInit): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify({ ok: false, error: "Not Found" }), {
    status: 404,
    headers,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(env, req);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health") {
      return ok({ ok: true, service: "goldshore-api", time: new Date().toISOString() }, cors);
    }

    if (url.pathname.startsWith("/v1/")) {
      if (!requireAccess(req)) {
        return unauthorized(cors);
      }

      try {
        const response = await routeV1(req, env, cors);
        if (response) {
          return response;
        }
      } catch (error) {
        return serverError(error, cors);
      }

      return notFound(cors);
    }

    return notFound(cors);
  }
};

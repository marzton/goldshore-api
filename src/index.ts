import { ok, unauthorized, serverError } from "./lib/util";
import { requireAccess } from "./lib/access";
import type { Env } from "./types";

import { getQuote, getOHLC } from "./handlers/market";
import { getOrders, createOrder } from "./handlers/broker";
import { headlines } from "./handlers/news";
import { listFilings } from "./handlers/edgar";
import { ytSearch } from "./handlers/youtube";
import { generateReport, getReport } from "./handlers/reports";
import { postBacktest, getBacktest } from "./handlers/backtests";

const ALLOWED = ["https://goldshore.org", "https://www.goldshore.org"];
const PAGES_PREVIEW = /\.pages\.dev$/;
const LOCAL = /^https?:\/\/localhost(:\d+)?$/;

function getOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (ALLOWED.includes(origin) || PAGES_PREVIEW.test(origin) || LOCAL.test(origin)) return origin;
  return "";
}

function corsHeaders(req: Request) {
  const origin = getOrigin(req);
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
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,cf-access-jwt-assertion",
    "access-control-max-age": "86400"
  };
  if (origin) headers["access-control-allow-origin"] = origin;
  return headers;
}

function withCORS(req: Request, res: Response) {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(corsHeaders(req))) headers.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function respond(req: Request, result: Response | Promise<Response>) {
  return Promise.resolve(result).then((res) => withCORS(req, res));
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
    if (req.method === "OPTIONS") {
      if (req.headers.get("origin") && req.headers.get("access-control-request-method")) {
        return respond(req, new Response(null, { status: 204 }));
      }
      return respond(req, new Response("", { status: 204 }));
    }

    if (url.pathname === "/health") {
      return respond(req, ok({ ok: true, service: "goldshore-api", time: new Date().toISOString() }));
    }

    if (url.pathname.startsWith("/v1/")) {
      if (!(await requireAccess(req))) {
        return respond(req, unauthorized());
      }

      try {
        if (url.pathname === "/v1/whoami") {
          const email = req.headers.get("CF-Access-Authenticated-User-Email") || null;
          return respond(req, ok({ ok: true, email }));
        }

        if (url.pathname === "/v1/market/quote") return respond(req, getQuote(env, url));
        if (url.pathname === "/v1/market/ohlc") return respond(req, getOHLC(env, url));

        if (url.pathname === "/v1/broker/orders" && req.method === "GET") return respond(req, getOrders(env, url));
        if (url.pathname === "/v1/broker/orders" && req.method === "POST") return respond(req, createOrder(env, req));

        if (url.pathname === "/v1/news/headlines") return respond(req, headlines(env, url));
        if (url.pathname === "/v1/edgar/filings") return respond(req, listFilings(env, url));

        if (url.pathname === "/v1/youtube/search") return respond(req, ytSearch(env, url));

        if (url.pathname === "/v1/reports/generate" && req.method === "POST") return respond(req, generateReport(env, req));
        if (url.pathname.startsWith("/v1/reports/") && req.method === "GET") {
          const id = url.pathname.split("/").pop();
          if (id) return respond(req, getReport(env, id));
        }

        if (url.pathname === "/v1/backtests/run" && req.method === "POST") return respond(req, postBacktest(env, req));
        if (url.pathname.startsWith("/v1/backtests/") && req.method === "GET") {
          const id = url.pathname.split("/").pop();
          if (id) return respond(req, getBacktest(env, id));
        }
      } catch (error) {
        return respond(req, serverError(error));
      }

      return respond(req, new Response("Not Found", { status: 404 }));
    }

    return respond(req, new Response("Not Found", { status: 404 }));
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

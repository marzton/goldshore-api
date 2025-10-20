import { corsHeaders } from "./lib/cors";
import { unauthorized, ok } from "./lib/util";
import { requireAccess } from "./lib/access";
import type { Env } from "./types";

import { getQuote, getOHLC } from "./handlers/market";
import { getOrders, createOrder } from "./handlers/broker";
import { headlines } from "./handlers/news";
import { listFilings } from "./handlers/edgar";
import { ytSearch } from "./handlers/youtube";
import { generateReport, getReport } from "./handlers/reports";
import { postBacktest, getBacktest } from "./handlers/backtests";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const CH = corsHeaders(env, req);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CH });

    if (url.pathname === "/health")
      return ok({ ok: true, service: "goldshore-api", time: new Date().toISOString() }, CH);

    if (url.pathname.startsWith("/v1/")) {
      if (!(await requireAccess(req, env))) return unauthorized(CH);

      if (url.pathname === "/v1/whoami") {
        const email = req.headers.get("CF-Access-Authenticated-User-Email") || null;
        return ok({ ok: true, email }, CH);
      }

      if (url.pathname === "/v1/market/quote") return getQuote(env, url);
      if (url.pathname === "/v1/market/ohlc") return getOHLC(env, url);

      if (url.pathname === "/v1/broker/orders" && req.method === "GET") return getOrders(env, url);
      if (url.pathname === "/v1/broker/orders" && req.method === "POST") return createOrder(env, req);

      if (url.pathname === "/v1/news/headlines") return headlines(env, url);
      if (url.pathname === "/v1/edgar/filings") return listFilings(env, url);

      if (url.pathname === "/v1/youtube/search") return ytSearch(env, url);

      if (url.pathname === "/v1/reports/generate" && req.method === "POST") return generateReport(env, req);
      if (url.pathname.startsWith("/v1/reports/") && req.method === "GET")
        return getReport(env, url.pathname.split("/").pop()!);

      if (url.pathname === "/v1/backtests/run" && req.method === "POST") return postBacktest(env, req);
      if (url.pathname.startsWith("/v1/backtests/") && req.method === "GET")
        return getBacktest(env, url.pathname.split("/").pop()!);

      return new Response("Not Found", { status: 404, headers: CH });
    }

    return new Response("Not Found", { status: 404, headers: CH });
  },
};

type WorkerEnv = {
  ENV?: string;
  OPENAI_API_KEY?: string;
  ALPACA_PAPER_API_KEY_ID?: string;
  ALPACA_PAPER_API_SECRET_KEY?: string;
  ALPACA_PAPER_BASE_URL?: string;
  ALPACA_LIVE_API_KEY_ID?: string;
  ALPACA_LIVE_API_SECRET_KEY?: string;
  ALPACA_LIVE_BASE_URL?: string;
  TRADING_ENABLED?: string;
  ORDER_MAX_NOTIONAL?: string;
  ORDER_ALLOWED_SYMBOLS?: string;
  ALPACA_PROXY_TOKEN?: string;
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?: () => void;
};

type ExportedHandler = {
  fetch(req: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> | Response;
};

function pickAlpaca(env: WorkerEnv) {
  const live = env.ENV === "production" && !!env.ALPACA_LIVE_API_KEY_ID;
  return live
    ? { base: env.ALPACA_LIVE_BASE_URL, key: env.ALPACA_LIVE_API_KEY_ID, secret: env.ALPACA_LIVE_API_SECRET_KEY, env: "live" }
    : { base: env.ALPACA_PAPER_BASE_URL, key: env.ALPACA_PAPER_API_KEY_ID, secret: env.ALPACA_PAPER_API_SECRET_KEY, env: "paper" };
}

const CORS = {
  "access-control-allow-origin": "https://goldshore.org",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};
const txt = (s: string, init: ResponseInit = {}) =>
  new Response(s, { ...init, headers: { "content-type": "text/plain; charset=utf-8", ...CORS, ...(init.headers || {}) } });

const json = (obj: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(obj), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...(init.headers || {}) } });

const rl = new Map<string, { n: number; t: number }>();
function hit(ip: string, limit = 30, windowMs = 15000) {
  const now = Date.now();
  const v = rl.get(ip) || { n: 0, t: now };
  if (now - v.t > windowMs) { rl.set(ip, { n: 1, t: now }); return true; }
  if (v.n + 1 > limit) return false;
  rl.set(ip, { n: v.n + 1, t: v.t });
  return true;
}

function requireAlpacaAuth(req: Request, env: WorkerEnv) {
  const expected = env.ALPACA_PROXY_TOKEN;
  if (!expected) return txt("alpaca-auth-not-configured", { status: 500 });
  const header = req.headers.get("authorization");
  if (!header) return txt("unauthorized", { status: 401 });
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return txt("unauthorized", { status: 401 });
  const provided = match[1].trim();
  if (provided.length !== expected.length) return txt("unauthorized", { status: 401 });
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) return txt("unauthorized", { status: 401 });
  return null;
}

async function alpacaFetch(env: WorkerEnv, path: string, init: RequestInit = {}) {
  const { base, key, secret } = pickAlpaca(env);
  const headers = new Headers(init.headers);
  headers.set("APCA-API-KEY-ID", key ?? "");
  headers.set("APCA-API-SECRET-KEY", secret ?? "");
  return fetch(`${base}${path}`, { ...init, headers });
}

export default {
  async fetch(...[req, env, _ctx]: Parameters<ExportedHandler["fetch"]>) {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") || "0.0.0.0";
    if (req.method === "OPTIONS") return txt("");

    if (!hit(ip)) return txt("rate-limited", { status: 429 });

    if (url.pathname === "/" || url.pathname === "/health") return txt("ok");
    if (url.pathname === "/env") {
      const a = pickAlpaca(env);
      return json({ env: env.ENV, alpaca: a.env, trading_enabled: env.TRADING_ENABLED === "true" });
    }
    if (url.pathname === "/ai-ping") {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
      return txt(r.ok ? "openai-ok" : "openai-fail", { status: r.status });
    }
    if (url.pathname === "/alpaca/ping") {
      const auth = requireAlpacaAuth(req, env);
      if (auth) return auth;
      const r = await alpacaFetch(env, "/v2/clock");
      return json(await r.json(), { status: r.status });
    }
    if (url.pathname === "/alpaca/account") {
      const auth = requireAlpacaAuth(req, env);
      if (auth) return auth;
      const r = await alpacaFetch(env, "/v2/account");
      return json(await r.json(), { status: r.status });
    }
    if (url.pathname === "/alpaca/positions") {
      const auth = requireAlpacaAuth(req, env);
      if (auth) return auth;
      const r = await alpacaFetch(env, "/v2/positions");
      return json(await r.json(), { status: r.status });
    }
    if (url.pathname === "/alpaca/orders" && req.method === "GET") {
      const auth = requireAlpacaAuth(req, env);
      if (auth) return auth;
      const r = await alpacaFetch(env, "/v2/orders?status=all&limit=50");
      return json(await r.json(), { status: r.status });
    }
    if (url.pathname === "/alpaca/orders" && req.method === "POST") {
      const auth = requireAlpacaAuth(req, env);
      if (auth) return auth;
      if (env.TRADING_ENABLED !== "true") return txt("trading-disabled", { status: 403 });

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const max = Number(env.ORDER_MAX_NOTIONAL || 0);
      if (max && Number(body.notional || 0) > max) return txt("exceeds-notional-limit", { status: 400 });
      if (env.ORDER_ALLOWED_SYMBOLS) {
        const allow = new Set(String(env.ORDER_ALLOWED_SYMBOLS).split(",").map(s => s.trim().toUpperCase()));
        if (!allow.has(String(body.symbol || "").toUpperCase())) return txt("symbol-not-allowed", { status: 400 });
      }
      const r = await alpacaFetch(env, "/v2/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return json(await r.json(), { status: r.status });
    }

    return txt("not found", { status: 404 });
  },
} satisfies ExportedHandler;

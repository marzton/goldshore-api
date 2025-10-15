import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Env = {
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
  TRADING_BEARER_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  TRADE_WEBHOOK_TOKEN?: string;
type Bindings = {
  ALPACA_KEY: string;
  ALPACA_SECRET: string;
  TRADE_API_TOKEN?: string;
};

type TradeRequest = {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
};

const app = new Hono<{ Bindings: Bindings }>();

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

function isAuthorized(req: Request, env: WorkerEnv) {
  if (req.headers.get("cf-access-jwt-assertion")) return true;

  const expected = env.TRADING_BEARER_TOKEN;
  if (!expected) return false;

  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return match[1] === expected;
}

function requireAuthorization(req: Request, env: WorkerEnv) {
  if (isAuthorized(req, env)) return null;
  return txt("unauthorized", { status: 401 });
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
      const r = await alpacaFetch(env, "/v2/clock");
      return json(await r.json(), { status: r.status });
    }
    if (url.pathname === "/alpaca/account") {
      const unauthorized = requireAuthorization(req, env);
      if (unauthorized) return unauthorized;
      const r = await alpacaFetch(env, "/v2/account");
      return json(await r.json(), { status: r.status });
    }
    if (url.pathname === "/alpaca/positions") {
      const unauthorized = requireAuthorization(req, env);
      if (unauthorized) return unauthorized;
      const r = await alpacaFetch(env, "/v2/positions");
      return json(await r.json(), { status: r.status });
    }
    if (url.pathname === "/alpaca/orders" && req.method === "GET") {
      const unauthorized = requireAuthorization(req, env);
      if (unauthorized) return unauthorized;
      const r = await alpacaFetch(env, "/v2/orders?status=all&limit=50");
      return json(await r.json(), { status: r.status });
    }
    if (url.pathname === "/alpaca/orders" && req.method === "POST") {
      const unauthorized = requireAuthorization(req, env);
      if (unauthorized) return unauthorized;

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
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 24 * 60 * 60,
  })
);

app.options('*', (c) => c.text('', 204));

app.get('/health', (c) => c.text('ok'));

app.post('/trade', async (c) => {
  const sharedSecret = c.env.TRADE_API_TOKEN;
  const authHeader = c.req.header('authorization');

  if (!sharedSecret) {
    return c.json({ error: 'Trading is not configured on this deployment.' }, 503);
  }

  if (!authHeader || authHeader !== `Bearer ${sharedSecret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let body: Partial<TradeRequest>;
  try {
    body = await c.req.json<Partial<TradeRequest>>();
  } catch (error) {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
  const side = body.side;
  const qty = typeof body.qty === 'number' ? body.qty : Number.NaN;

  if (!symbol || symbol.length > 10) {
    return c.json({ error: 'Symbol is required and must be <= 10 characters' }, 422);
  }

  try {
    const res = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
      headers: { 'cache-control': 'no-store' }
    });
    if (!res.ok) {
      return [];
    }
    const { keys } = (await res.json()) as { keys?: AccessJwk[] };
    const entry = {
      keys: keys ?? [],
      expiry: now + ACCESS_CERTS_TTL_MS
    };
    accessCertsCache.set(domain, entry);
    return entry.keys;
  } catch {
    return [];
  }
};

const requireAccess = async (req: Request, env: Env) => {
  const sharedSecret = env.TRADE_WEBHOOK_TOKEN;
  if (sharedSecret) {
    const auth = req.headers.get('authorization');
    if (auth === `Bearer ${sharedSecret}`) {
      return true;
    }
  }

  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token || !env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) {
    return false;
  if (side !== 'buy' && side !== 'sell') {
    return c.json({ error: "Side must be either 'buy' or 'sell'" }, 422);
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    return c.json({ error: 'Quantity must be a positive number' }, 422);
  }

  if (!c.env.ALPACA_KEY || !c.env.ALPACA_SECRET) {
    return c.json({ error: 'Trading credentials are not configured.' }, 503);
  }

  const alpacaResponse = await fetch('https://paper-api.alpaca.markets/v2/orders', {
    method: 'POST',
    headers: {
      'APCA-API-KEY-ID': c.env.ALPACA_KEY,
      'APCA-API-SECRET-KEY': c.env.ALPACA_SECRET,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      symbol,
      side,
      type: 'market',
      qty,
      time_in_force: 'day'
    })
  });

  if (!alpacaResponse.ok) {
    return c.json(
      {
        error: 'Alpaca rejected the order',
        status: alpacaResponse.status,
        details: await alpacaResponse.text()
      },
      502
    );
  }

  return c.json(await alpacaResponse.json());
});

export default app;

const CORS_HEADERS = {
  'access-control-allow-origin': 'https://goldshore.org',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization'
} as const;

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
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?: () => void;
};

type RateLimitBucket = {
  n: number;
  t: number;
};

const rl = new Map<string, RateLimitBucket>();

const mergeHeaders = (base: HeadersInit, extra?: HeadersInit): Headers => {
  const merged = new Headers(base);

  if (!extra) {
    return merged;
  }

  if (extra instanceof Headers) {
    extra.forEach((value, key) => merged.set(key, value));
    return merged;
  }

  if (Array.isArray(extra)) {
    extra.forEach(([key, value]) => merged.set(key, value));
    return merged;
  }

  Object.entries(extra).forEach(([key, value]) => {
    if (typeof value !== 'undefined') {
      merged.set(key, String(value));
    }
  });

  return merged;
};

const ok = (body: BodyInit | null, init: ResponseInit = {}) =>
  new Response(body, {
    ...init,
    headers: mergeHeaders({ 'content-type': 'text/plain; charset=utf-8', ...CORS_HEADERS }, init.headers)
  });

type AccessJwk = JsonWebKey & { kid?: string };

type AccessCertsCacheEntry = {
  expiry: number;
  keys: AccessJwk[];
};

const accessCertsCache = new Map<string, AccessCertsCacheEntry>();
const ACCESS_CERTS_TTL_MS = 5 * 60 * 1000;

const base64UrlToUint8Array = (input: string) => {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  const binary = atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const decodeTokenSegment = <T>(segment: string): T | null => {
  try {
    const decoded = base64UrlToUint8Array(segment);
    return JSON.parse(new TextDecoder().decode(decoded)) as T;
  } catch {
    return null;
  }
};

const getAccessKeys = async (env: Env) => {
  const domain = env.CF_ACCESS_TEAM_DOMAIN;
  if (!domain) {
    return [];
  }

  const cached = accessCertsCache.get(domain);
  const now = Date.now();
  if (cached && cached.expiry > now) {
    return cached.keys;
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
  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token || !env.CF_ACCESS_AUD) {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const header = decodeTokenSegment<{ kid?: string }>(parts[0]);
  const payload = decodeTokenSegment<{ aud?: string | string[]; exp?: number; nbf?: number }>(parts[1]);
  if (!header || !payload || !header.kid) {
    return false;
  }

  const keys = await getAccessKeys(env);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    return false;
  }

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      false,
      ['verify']
    );
  } catch {
    return false;
  }

  const message = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = (() => {
    try {
      return base64UrlToUint8Array(parts[2]);
    } catch {
      return null;
    }
  })();
  if (!signature) {
    return false;
  }

  let verified: boolean;
  try {
    verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, message);
  } catch {
    return false;
  }
  if (!verified) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if ((typeof payload.exp === 'number' && payload.exp < now) || (typeof payload.nbf === 'number' && payload.nbf > now)) {
    return false;
  }

  const audience = payload.aud;
  if (Array.isArray(audience)) {
    return audience.includes(env.CF_ACCESS_AUD);
  }
  return audience === env.CF_ACCESS_AUD;
};

const hit = (ip: string, limit = 30, windowMs = 15_000) => {
  const now = Date.now();
  const bucket = rl.get(ip) ?? { n: 0, t: now };
  if (now - bucket.t > windowMs) {
    rl.set(ip, { n: 1, t: now });
    return true;
  }
  if (bucket.n + 1 > limit) {
    return false;
  }
  rl.set(ip, { n: bucket.n + 1, t: bucket.t });
  return true;
};

const redact = (headers: Headers): Headers => {
  const copy = new Headers(headers);
  copy.delete('APCA-API-KEY-ID');
  copy.delete('APCA-API-SECRET-KEY');
  return copy;
};

const pickAlpaca = (env: Env) => {
  const isLive = env.ENV === 'production' && Boolean(env.ALPACA_LIVE_API_KEY_ID);
  if (isLive) {
    return {
      base: env.ALPACA_LIVE_BASE_URL ?? 'https://api.alpaca.markets',
      key: env.ALPACA_LIVE_API_KEY_ID ?? '',
      secret: env.ALPACA_LIVE_API_SECRET_KEY ?? ''
    };
  }
  return {
    base: env.ALPACA_PAPER_BASE_URL ?? 'https://paper-api.alpaca.markets',
    key: env.ALPACA_PAPER_API_KEY_ID ?? '',
    secret: env.ALPACA_PAPER_API_SECRET_KEY ?? ''
  };
};

const alpacaFetch = (env: Env, path: string, init: RequestInit = {}) => {
  const { base, key, secret } = pickAlpaca(env);
  const headers = new Headers(init.headers);
  headers.set('APCA-API-KEY-ID', key);
  headers.set('APCA-API-SECRET-KEY', secret);
  return fetch(`${base}${path}`, { ...init, headers });
};

const jsonResponse = async (response: Response) => {
  const payload = await response.text();
  const headers = mergeHeaders(
    {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8'
    },
    redact(response.headers)
  );

  return new Response(payload, {
    status: response.status,
    headers
  });
};

const handler = {
  async fetch(req: Request, env: Env, _ctx: WorkerExecutionContext) {
    const url = new URL(req.url);
    const ip = req.headers.get('cf-connecting-ip') ?? '0.0.0.0';

    if (req.method === 'OPTIONS') {
      return ok('');
    }

    if (!hit(ip)) {
      return ok('rate-limited', { status: 429 });
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return ok('ok');
    }

    if (url.pathname === '/ai-ping') {
      try {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}`
          }
        });
        return ok(r.ok ? 'openai-ok' : 'openai-fail', { status: r.status });
      } catch (error) {
        return ok('openai-fail', { status: 502 });
      }
    }

    if (url.pathname === '/alpaca/clock') {
      const r = await alpacaFetch(env, '/v2/clock');
      return jsonResponse(r);
    }

    if (url.pathname === '/alpaca/account') {
      const r = await alpacaFetch(env, '/v2/account');
      return jsonResponse(r);
    }

    if (url.pathname === '/alpaca/positions') {
      const r = await alpacaFetch(env, '/v2/positions');
      return jsonResponse(r);
    }

    if (url.pathname === '/alpaca/orders' && req.method === 'GET') {
      const r = await alpacaFetch(env, '/v2/orders?status=all&limit=50');
      return jsonResponse(r);
    }

    if (url.pathname === '/alpaca/orders' && req.method === 'POST') {
      if (env.TRADING_ENABLED !== 'true') {
        return ok('trading-disabled', { status: 403 });
      }

      if (!(await requireAccess(req, env))) {
        return ok('unauthorized', { status: 401 });
      }

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const notional = Number(body.notional ?? 0);
      const max = Number(env.ORDER_MAX_NOTIONAL ?? 0);
      if (max > 0 && notional > max) {
        return ok('exceeds-notional-limit', { status: 400 });
      }

      if (env.ORDER_ALLOWED_SYMBOLS) {
        const allow = new Set(
          String(env.ORDER_ALLOWED_SYMBOLS)
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        );
        const symbol = String(body.symbol ?? '').toUpperCase();
        if (!allow.has(symbol)) {
          return ok('symbol-not-allowed', { status: 400 });
        }
      }

      const r = await alpacaFetch(env, '/v2/orders', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      return jsonResponse(r);
    }

    return ok('not found', { status: 404 });
  }
};

export default handler;

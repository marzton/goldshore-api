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

import { Hono } from 'hono';

type Bindings = {
  ALPACA_KEY: string;
  ALPACA_SECRET: string;
  TRADE_WEBHOOK_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.text('ok'));

app.post('/trade', async (c) => {
  const webhookSecret = c.env.TRADE_WEBHOOK_TOKEN;
  if (!webhookSecret) {
    return c.json({ error: 'Trading is currently disabled' }, 503);
  }

  const authHeader = c.req.header('Authorization') ?? '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const providedToken = bearerMatch?.[1]?.trim() ?? '';

  if (!providedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(webhookSecret);
  const providedBytes = encoder.encode(providedToken);

  if (expectedBytes.length !== providedBytes.length) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let mismatch = 0;
  for (let i = 0; i < expectedBytes.length; i += 1) {
    mismatch |= expectedBytes[i] ^ providedBytes[i];
  }

  if (mismatch !== 0) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!c.req.header('content-type')?.includes('application/json')) {
    return c.json({ error: 'Unsupported content type' }, 415);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const payload = body as Record<string, unknown> | null;
  const symbol = typeof payload?.symbol === 'string' ? payload.symbol.trim().toUpperCase() : '';
  const side = typeof payload?.side === 'string' ? payload.side.toLowerCase() : '';
  const qty = Number(payload?.qty);

  if (!symbol || !/^[A-Z.]{1,5}$/.test(symbol)) {
    return c.json({ error: 'Invalid symbol' }, 400);
  }

  if (side !== 'buy' && side !== 'sell') {
    return c.json({ error: 'Invalid trade side' }, 400);
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    return c.json({ error: 'Invalid quantity' }, 400);
  }

  const r = await fetch('https://paper-api.alpaca.markets/v2/orders', {
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

  if (!r.ok) {
    const errorBody = await r.text();
    return c.json({ error: 'Alpaca order failed', details: errorBody }, 502);
  }

  return c.json(await r.json(), 200);
});

export default app;

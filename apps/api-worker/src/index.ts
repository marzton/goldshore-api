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

  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { symbol, side, qty } = body ?? {};

  if (typeof symbol !== 'string' || typeof side !== 'string' || typeof qty !== 'number') {
    return c.json({ error: 'Invalid trade payload' }, 400);
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
  return c.json(await r.json(), r.ok ? 200 : 400);
});

export default app;

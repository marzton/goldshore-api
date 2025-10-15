import { Hono } from 'hono';
import { cors } from 'hono/cors';

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

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
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400
  })
);

app.get('/health', (c) => c.text('ok'));

app.options('/trade', (c) => new Response(null, { status: 204 }));

app.post('/trade', async (c) => {
  const sharedSecret = c.env.TRADE_API_TOKEN;
  const authHeader = c.req.header('authorization');

  if (!sharedSecret) {
    return c.json({ error: 'Trading is not configured on this deployment.' }, 503);
  }

  if (!authHeader || authHeader !== `Bearer ${sharedSecret}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { symbol, side, qty } = (await c.req.json()) as TradeRequest;

  return c.json({
    ok: true,
    data: {
      symbol,
      side,
      qty
    }
  });
});

export default app;

import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.text('ok'));

app.post('/trade', async (c) => {
  const body = await c.req.json();
  const r = await fetch('https://paper-api.alpaca.markets/v2/orders', {
    method: 'POST',
    headers: {
      'APCA-API-KEY-ID': c.env.ALPACA_KEY,
      'APCA-API-SECRET-KEY': c.env.ALPACA_SECRET,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      symbol: body.symbol,
      side: body.side,
      type: 'market',
      qty: body.qty,
      time_in_force: 'day'
    })
  });
  return c.json(await r.json(), r.ok ? 200 : 400);
});

export default app;

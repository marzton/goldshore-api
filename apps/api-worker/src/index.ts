import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { corsHeaders } from "./lib/cors";
import { requireAccess, type AccessResult } from "./lib/access";
import { bad, ok, unauthorized } from "./lib/util";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env; Variables: { cors: Headers; access?: AccessResult } }>();

app.use("*", async (c, next) => {
  const cors = corsHeaders(c.env, c.req.raw);
  c.set("cors", cors);

  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  await next();
});

app.get("/health", c => {
  const headers = c.get("cors");
  return ok(
    {
      ok: true,
      service: "api-worker",
      time: new Date().toISOString()
    },
    headers
  );
});

const ensureAccess: MiddlewareHandler<{ Bindings: Env; Variables: { cors: Headers; access?: AccessResult } }> = async (
  c,
  next
) => {
  const result = await requireAccess(c.req.raw, c.env);
  if (!result.authorized) {
    const headers = new Headers(c.get("cors"));
    headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
    return unauthorized(headers);
  }

  c.set("access", result);
  await next();
};

app.use("/trade", ensureAccess);

app.post("/trade", async c => {
  const headers = c.get("cors");
  const sharedSecret = c.env.TRADE_API_TOKEN;
  const authHeader = c.req.header("authorization");

  if (!sharedSecret) {
    return bad("Trading is not configured on this deployment.", 503, headers);
  }

  if (!authHeader || authHeader !== `Bearer ${sharedSecret}`) {
    const responseHeaders = new Headers(headers);
    responseHeaders.set("WWW-Authenticate", 'Bearer realm="Goldshore API"');
    return unauthorized(responseHeaders);
  }

  return ok({ status: "ok" }, headers);
});

export default app;

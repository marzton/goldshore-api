import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from 'hono/cors'
import { requireAccess, type AccessResult } from "./lib/access";
import { bad, ok, unauthorized } from "./lib/util";
import type { Env } from "./types";
import { CanonicalEnvSchema } from "@goldshore/env";

// Import v1 API routes
import { createApp } from "./app";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({
  origin: "*",
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

app.options("*", (c) => {
  return c.text("ok");
});

// 3. Health Check Endpoint
app.get("/health", c => {
  return ok(
    {
      ok: true,
      service: "api-worker",
      time: new Date().toISOString()
    }
  );
});

const ensureAccess: MiddlewareHandler<{ Bindings: Env; Variables: { cors: Headers; access?: AccessResult } }> = async (
  c,
  next
) => {
  const result = await requireAccess(c.req.raw, c.env);
  if (!result.authorized) {
    const headers = new Headers();
    headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
    return unauthorized(headers);
  }

  c.set("access", result);
  await next();
};

app.use("/trade", ensureAccess);

// 5. Existing /trade endpoint (re-integrated)
// This was in the original file and seems important. We'll keep it.
// It uses a separate Bearer token authentication, which is a common pattern for specific webhooks or service-to-service calls.
app.post("/trade", async c => {
  const sharedSecret = c.env.TRADE_API_TOKEN;
  const authHeader = c.req.header("authorization");

  if (!sharedSecret) {
    return bad("Trading is not configured on this deployment.", 503);
  }

  if (!authHeader || authHeader !== `Bearer ${sharedSecret}`) {
    const responseHeaders = new Headers();
    responseHeaders.set("WWW-Authenticate", 'Bearer realm="Goldshore API"');
    return unauthorized(responseHeaders);
  }

  return ok({ status: "ok" });
});



export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      CanonicalEnvSchema.parse(env);
    } catch (e) {
      console.error("Failed to parse environment variables:", e);
      return new Response("Internal Server Error: Invalid environment configuration.", { status: 500 });
    }

    const v1_app = createApp(env);
    app.route("/v1", v1_app);

    return app.fetch(request, env, ctx);
  },
};

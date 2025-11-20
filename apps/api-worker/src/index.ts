import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from 'hono/cors'
import { requireAccess, type AccessResult } from "./lib/access";
import { bad, ok, unauthorized } from "./lib/util";
import type { Env } from "./types";
import { CanonicalEnvSchema } from "@goldshore/env";

const app = new Hono<{ Bindings: Env; Variables: { cors: Headers; access?: AccessResult } }>();

app.use("*", cors({
  origin: "*",
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

app.options("*", (c) => {
  return c.text("ok");
});

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

// --- OpenAPI Routes ---
import api_v1 from "./app";
app.route("/v1", api_v1);


export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      CanonicalEnvSchema.parse(env);
    } catch (e) {
      console.error("Failed to parse environment variables:", e);
      return new Response("Internal Server Error: Invalid environment configuration.", { status: 500 });
    }
    return app.fetch(request, env, ctx);
  },
};

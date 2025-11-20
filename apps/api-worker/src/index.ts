import { Hono } from "hono";
import { cors } from "hono/cors";
import { validateJWT } from "./middleware/auth";
import { ok } from "./lib/util";
import type { Env } from "./types";

// Import v1 API routes
import api_v1 from "./app";

const app = new Hono<{ Bindings: Env }>();

// 1. CORS Middleware (as specified in the manual)
// Note: This replaces the previous manual CORS header implementation.
// The `CORS_ALLOWED` variable must be a JSON string array in wrangler.toml.
app.use(
  "/*",
  cors({
    origin: (origin, c) => {
      try {
        const allowedOrigins = JSON.parse(c.env.CORS_ALLOWED);
        if (allowedOrigins.includes(origin)) {
          return origin;
        }
        // Return first origin as a default? Or handle differently.
        return allowedOrigins[0] || origin;
      } catch (e) {
        // Fallback if parsing fails or CORS_ALLOWED is not set
        return c.env.PUBLIC_HOME || origin;
      }
    },
    credentials: true,
    allowHeaders: ["Authorization", "Content-Type"],
    exposeHeaders: ["CF-Ray"]
  })
);

// 2. JWT Validation Middleware (as specified in the manual)
// Note: This replaces the previous `requireAccess` middleware.
app.use("*", async (c, next) => {
  // Bypass authentication for the health check endpoint
  if (c.req.path === "/health") {
    await next();
    return;
  }

  const auth = await validateJWT(c.req.raw, c.env);
  if (!auth.ok) {
    return c.json({ error: auth.error }, 401);
  }
  await next();
});

// 3. Health Check Endpoint
app.get("/health", c => {
  return ok({
    ok: true,
    service: "api-worker",
    time: new Date().toISOString()
  });
});

// 4. OpenAPI Routes
// Mount the existing v1 API routes.
app.route("/v1", api_v1);

// 5. Existing /trade endpoint (re-integrated)
// This was in the original file and seems important. We'll keep it.
// It uses a separate Bearer token authentication, which is a common pattern for specific webhooks or service-to-service calls.
app.post("/trade", async c => {
  const sharedSecret = c.env.TRADE_API_TOKEN;
  const authHeader = c.req.header("authorization");

  if (!sharedSecret) {
    return c.json({ error: "Trading is not configured on this deployment." }, 503);
  }

  if (!authHeader || authHeader !== `Bearer ${sharedSecret}`) {
    const headers = new Headers();
    headers.set("WWW-Authenticate", 'Bearer realm="Goldshore API"');
    return c.json({ error: "Unauthorized" }, 401, headers);
  }

  return ok({ status: "ok" });
});


export default app;

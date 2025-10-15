export interface Env {
  KV_BINDING: KVNamespace;
  AI: any;
  CORS_ALLOWED_ORIGINS?: string;
  API_VERSION?: string;
}

const ALLOWED_METHODS = "GET,POST,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Authorization,Content-Type";

const escapeRegex = (value: string) => value.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");

const originMatches = (origin: string, pattern: string) => {
  if (!pattern) return false;
  if (pattern === "*") {
    return origin.length > 0;
  }

  if (!pattern.includes("*")) {
    return origin === pattern;
  }

  const regex = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, ".*")}$`);
  return regex.test(origin);
};

const corsHeaders = (env: Env, req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const allow = (env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin && allow.some((pattern) => originMatches(origin, pattern))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
};

const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });

const unauthorized = (headers: Record<string, string>) =>
  json({ error: "Unauthorized" }, 401, {
    ...headers,
    "Cache-Control": "no-store"
  });

const requireAccess = (req: Request) => {
  const jwt = req.headers.get("CF-Access-Jwt-Assertion");
  const email = req.headers.get("CF-Access-Authenticated-User-Email");
  return Boolean((jwt && jwt.trim()) || (email && email.trim()));
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const CH = corsHeaders(env, req);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CH });
    }

    if (url.pathname === "/health") {
      return json(
        {
          ok: true,
          service: "goldshore-api",
          version: env.API_VERSION || "v1",
          time: new Date().toISOString()
        },
        200,
        CH
      );
    }

    const requiresAccess =
      url.pathname.startsWith("/v1/") ||
      url.pathname === "/kv" ||
      url.pathname === "/ai";

    if (requiresAccess && !requireAccess(req)) {
      return unauthorized(CH);
    }

    if (url.pathname === "/kv") {
      await env.KV_BINDING.put("demo", "Hello from Goldshore!");
      const val = await env.KV_BINDING.get("demo");
      return json({ ok: true, value: val }, 200, CH);
    }

    if (url.pathname === "/ai") {
      const input = { prompt: "Tell me a short joke about Cloudflare." };
      const res = await env.AI.run("@cf/meta/llama-3-8b-instruct", input);
      return json(
        {
          ok: true,
          model: "llama-3-8b-instruct",
          response: res.response
        },
        200,
        CH
      );
    }

    if (url.pathname.startsWith("/v1/")) {
      // Protected routes should execute below.
    }

    return new Response("Not Found", { status: 404, headers: CH });
  }
};

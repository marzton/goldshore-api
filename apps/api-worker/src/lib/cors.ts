import type { Env } from "../types";

export function corsHeaders(env: Env, req: Request): HeadersInit {
  const origin = req.headers.get("Origin") || "";
  const allow = (env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,CF-Access-Jwt-Assertion",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (!allow.length) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (allow.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

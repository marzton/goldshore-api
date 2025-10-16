import type { Env } from "../types";

const ALLOWED_METHODS = "GET,POST,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Authorization,Content-Type,CF-Access-Jwt-Assertion";

const escapeRegex = (value: string) => value.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");

const originMatches = (origin: string, pattern: string) => {
  if (!pattern) return false;
  if (pattern === "*") return origin.length > 0;
  if (!pattern.includes("*")) return origin === pattern;
  const regex = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, ".*")}$`);
  return regex.test(origin);
};

const buildAllowedOrigins = (allow: string) =>
  allow
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const resolveAllowedOrigin = (origin: string, allow: string[]) => {
  for (const pattern of allow) {
    if (!pattern) continue;
    if (pattern === "*") return "*";
    if (origin && originMatches(origin, pattern)) return origin;
  }
  return null;
};

export const corsHeaders = (env: Env, req: Request): HeadersInit => {
  const origin = req.headers.get("Origin") || "";
  const allowed = buildAllowedOrigins(env.CORS_ALLOWED_ORIGINS || "");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  const allowedOrigin = resolveAllowedOrigin(origin, allowed);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    if (allowedOrigin === "*") delete headers["Vary"];
  }
  return headers;
};

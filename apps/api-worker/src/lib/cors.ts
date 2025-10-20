import type { Env } from "../types";

const ALLOWED_METHODS = "GET,POST,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Authorization,Content-Type,CF-Access-Jwt-Assertion";

const escapeRegex = (value: string) => value.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");

type OriginRule =
  | { type: "wildcard" }
  | { type: "exact"; value: string }
  | { type: "pattern"; regex: RegExp };

const createOriginRule = (pattern: string): OriginRule | null => {
  const value = pattern.trim();
  if (!value) return null;
  if (value === "*") return { type: "wildcard" };
  if (!value.includes("*")) return { type: "exact", value };
  const regex = new RegExp(`^${escapeRegex(value).replace(/\\\*/g, ".*")}$`);
  return { type: "pattern", regex };
};

const buildAllowedOrigins = (allow: string): OriginRule[] =>
  allow
    .split(",")
    .map(createOriginRule)
    .filter((rule): rule is OriginRule => Boolean(rule));

const resolveAllowedOrigin = (origin: string, allow: OriginRule[]) => {
  for (const rule of allow) {
    if (rule.type === "wildcard") return "*";
    if (!origin) continue;
    if (rule.type === "exact" && origin === rule.value) return origin;
    if (rule.type === "pattern" && rule.regex.test(origin)) return origin;
  }
  return null;
};

export function corsHeaders(env: Env, req: Request): HeadersInit {
  const origin = req.headers.get("Origin") || "";
  const allowed = buildAllowedOrigins(env.CORS_ALLOWED_ORIGINS || "");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (allowed.length === 0) {
    headers["Access-Control-Allow-Origin"] = "*";
    delete headers.Vary;
    return headers;
  }

  const allowedOrigin = resolveAllowedOrigin(origin, allowed);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    if (allowedOrigin === "*") delete headers.Vary;
  }

  return headers;
}

import type { Env } from "../types";

const DEFAULT_ALLOW_HEADERS = [
  "Authorization",
  "Content-Type",
  "Cf-Access-Jwt-Assertion",
  "Cf-Access-Authenticated-User-Email"
].join(",");

export function corsHeaders(env: Env, req: Request): Headers {
  const origin = req.headers.get("Origin") ?? "";
  const allowList = parseOrigins(env.CORS_ORIGINS);
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": env.CORS_ALLOW_HEADERS ?? DEFAULT_ALLOW_HEADERS,
    "Access-Control-Max-Age": env.CORS_MAX_AGE ?? "86400",
    "Vary": "Origin",
    "Access-Control-Expose-Headers": "Cf-Access-Authenticated-User-Email"
  });

  if (origin && isOriginAllowed(origin, allowList)) {
    headers.set("Access-Control-Allow-Origin", origin);
    if (env.CORS_ALLOW_CREDENTIALS !== "false") {
      headers.set("Access-Control-Allow-Credentials", "true");
    }
  }

  return headers;
}

function parseOrigins(origins?: string): string[] {
  if (!origins) return [];
  return origins
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin: string, allowList: string[]): boolean {
  if (!allowList.length) return false;

  try {
    const url = new URL(origin);
    return allowList.some(pattern => matchesPattern(url, pattern));
  } catch (_err) {
    return false;
  }
}

export function corsHeaders(env: Env, req: Request): HeadersInit {
  const origin = req.headers.get("Origin") || "";
  const allowList = env.CORS_ALLOWED_ORIGINS || env.CORS_ORIGINS || "";
  const allowed = buildAllowedOrigins(allowList);
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
function matchesPattern(url: URL, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return `${url.protocol}//${url.host}`.toLowerCase() === pattern.toLowerCase();
  }

  const hasProtocol = pattern.includes("://");
  let protocol = "";
  let hostPattern = pattern;

  if (hasProtocol) {
    const [protoPart, hostPart] = pattern.split("://", 2);
    protocol = protoPart.toLowerCase();
    hostPattern = hostPart;
  }

  if (protocol && url.protocol.replace(":", "").toLowerCase() !== protocol) {
    return false;
  }

  const regex = new RegExp(`^${hostPattern.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`, "i");
  return regex.test(url.host);
}

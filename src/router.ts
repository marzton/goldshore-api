import type { Env } from "./types";
import { handleWhoami } from "./handlers/auth";
import { handleGetOrders, handleCreateOrder } from "./handlers/broker";
import { handleMarketQuote, handleMarketOHLC } from "./handlers/market";
import { handleNewsHeadlines } from "./handlers/news";
import { handleEdgarFilings } from "./handlers/edgar";
import { handleYouTubeSearch } from "./handlers/youtube";
import { handleGenerateReport, handleGetReport } from "./handlers/reports";
import { handleRunBacktest, handleGetBacktest } from "./handlers/backtests";
import { handleResearchLookup } from "./handlers/research";
import { handleAdsSummary } from "./handlers/ads";
import { handleWebhookEvent } from "./handlers/webhooks";

export interface RequestContext {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  cors: HeadersInit;
}

export type RouteHandler = (ctx: RequestContext) => Response | Promise<Response>;

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

interface RouteDefinition {
  method: HttpMethod;
  path: string;
  keys: string[];
  pattern: RegExp;
  handler: RouteHandler;
}

function defineRoute(method: HttpMethod, path: string, handler: RouteHandler): RouteDefinition {
  const keys: string[] = [];
  const segments = path.split("/").map((segment) => {
    if (!segment) return "";
    if (segment === "*") {
      return ".*";
    }
    if (segment.startsWith(":")) {
      keys.push(segment.slice(1));
      return "([^/]+)";
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  const pattern = new RegExp(`^${segments.join("/")}$`);

  return { method, path, keys, pattern, handler };
}

const routes: RouteDefinition[] = [
  defineRoute("GET", "/v1/whoami", handleWhoami),
  defineRoute("GET", "/v1/broker/orders", handleGetOrders),
  defineRoute("POST", "/v1/broker/orders", handleCreateOrder),
  defineRoute("GET", "/v1/market/quote", handleMarketQuote),
  defineRoute("GET", "/v1/market/ohlc", handleMarketOHLC),
  defineRoute("GET", "/v1/news/headlines", handleNewsHeadlines),
  defineRoute("GET", "/v1/edgar/filings", handleEdgarFilings),
  defineRoute("GET", "/v1/youtube/search", handleYouTubeSearch),
  defineRoute("POST", "/v1/reports/generate", handleGenerateReport),
  defineRoute("GET", "/v1/reports/:id", handleGetReport),
  defineRoute("POST", "/v1/backtests/run", handleRunBacktest),
  defineRoute("GET", "/v1/backtests/:id", handleGetBacktest),
  defineRoute("GET", "/v1/research/lookup", handleResearchLookup),
  defineRoute("GET", "/v1/ads/summary", handleAdsSummary),
  defineRoute("POST", "/v1/webhooks/:provider", handleWebhookEvent)
];

interface MatchResult {
  handler: RouteHandler;
  params: Record<string, string>;
}

function matchRoute(method: string, pathname: string): MatchResult | null {
  for (const route of routes) {
    if (route.method !== method.toUpperCase()) continue;
    const match = pathname.match(route.pattern);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] ?? "");
    });
    return { handler: route.handler, params };
  }
  return null;
}

function applyCors(response: Response, cors: HeadersInit): Response {
  const headers = new Headers(response.headers);
  const corsHeaders = new Headers(cors);
  corsHeaders.forEach((value, key) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function routeV1(request: Request, env: Env, cors: HeadersInit): Promise<Response | null> {
  const url = new URL(request.url);
  const match = matchRoute(request.method, url.pathname);
  if (!match) {
    return null;
  }

  const ctx: RequestContext = {
    request,
    env,
    url,
    params: match.params,
    cors,
  };

  const response = await match.handler(ctx);
  return applyCors(response, cors);
}

import { bad, ok } from "./lib/util";
import { requireAccess } from "./lib/access";
import type { Env } from "./types";

const CONFIG_KEY = "risk:config";
const KILLSWITCH_KEY = "risk:killswitch";

export interface RiskConfig {
  rules: Array<{
    id: string;
    description: string;
    threshold: number;
  }>;
  updated_at: string;
}

export const defaultRiskConfig = (): RiskConfig => ({
  rules: [],
  updated_at: new Date(0).toISOString()
});

const ensureKv = (env: Env): KVNamespace => {
  if (!env.AGENT_STATE) {
    throw new Error("AGENT_STATE KV binding is required for risk endpoints");
  }
  return env.AGENT_STATE;
};

const withAccess = async (request: Request, env: Env, cors: HeadersInit) => {
  const access = await requireAccess(request, env);
  if (!access.authorized) {
    const headers = new Headers(cors);
    headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
    return { response: bad("AUTH_REQUIRED", 401, headers), ok: false } as const;
  }
  return { access, ok: true as const };
};

const readConfig = async (env: Env): Promise<RiskConfig> => {
  const kv = ensureKv(env);
  const stored = await kv.get(CONFIG_KEY);
  if (!stored) return defaultRiskConfig();
  try {
    const parsed = JSON.parse(stored) as RiskConfig;
    return parsed;
  } catch {
    return defaultRiskConfig();
  }
};

const writeConfig = async (env: Env, config: RiskConfig) => {
  const kv = ensureKv(env);
  await kv.put(CONFIG_KEY, JSON.stringify(config));
};

const readKillswitch = async (env: Env) => {
  const kv = ensureKv(env);
  const value = await kv.get(KILLSWITCH_KEY);
  return value === "on";
};

const setKillswitch = async (env: Env, value: boolean) => {
  const kv = ensureKv(env);
  if (value) {
    await kv.put(KILLSWITCH_KEY, "on");
  } else {
    await kv.delete(KILLSWITCH_KEY);
  }
};

const parseRiskConfig = (body: unknown): RiskConfig | null => {
  if (!body || typeof body !== "object") return null;
  const { rules } = body as Record<string, unknown>;
  if (!Array.isArray(rules)) return null;
  const normalizedRules: RiskConfig["rules"] = [];
  for (const entry of rules) {
    if (!entry || typeof entry !== "object") return null;
    const { id, description, threshold } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) return null;
    if (typeof description !== "string" || !description.trim()) return null;
    const numericThreshold = typeof threshold === "number" ? threshold : Number(threshold);
    if (!Number.isFinite(numericThreshold)) return null;
    normalizedRules.push({
      id: id.trim(),
      description: description.trim(),
      threshold: numericThreshold
    });
  }
  return {
    rules: normalizedRules,
    updated_at: new Date().toISOString()
  };
};

const parseRiskCheckPayload = (body: unknown) => {
  if (!body || typeof body !== "object") return null;
  const { metric, value } = body as Record<string, unknown>;
  if (typeof metric !== "string" || !metric.trim()) return null;
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return null;
  return { metric: metric.trim(), value: numericValue };
};

const parseKillswitchPayload = (body: unknown) => {
  if (!body || typeof body !== "object") return null;
  const { enabled } = body as Record<string, unknown>;
  if (typeof enabled !== "boolean") return null;
  return enabled;
};

export const handle = async (request: Request, env: Env, cors: HeadersInit): Promise<Response> => {
  const access = await withAccess(request, env, cors);
  if (!access.ok) {
    return access.response;
  }

  const url = new URL(request.url);

  if (url.pathname === "/v1/risk/config") {
    if (request.method === "GET") {
      const config = await readConfig(env);
      return ok({ config }, cors);
    }
    if (request.method === "PUT") {
      const body = await safeJson(request);
      const config = parseRiskConfig(body);
      if (!config) {
        return bad("INVALID_CONFIG", 400, cors, "rules must be an array of {id, description, threshold}");
      }
      await writeConfig(env, config);
      return ok({ config }, cors);
    }
    return bad("METHOD_NOT_ALLOWED", 405, cors);
  }

  if (url.pathname === "/v1/risk/check" && request.method === "POST") {
    const body = await safeJson(request);
    const payload = parseRiskCheckPayload(body);
    if (!payload) {
      return bad("INVALID_CHECK", 400, cors, "metric and numeric value required");
    }
    const config = await readConfig(env);
    const rule = config.rules.find((entry) => entry.id === payload.metric);
    if (!rule) {
      return ok({ allowed: true, reason: "NO_RULE" }, cors);
    }
    const allowed = payload.value <= rule.threshold;
    return ok(
      {
        allowed,
        metric: payload.metric,
        value: payload.value,
        threshold: rule.threshold,
        updated_at: config.updated_at
      },
      cors
    );
  }

  if (url.pathname === "/v1/risk/killswitch") {
    if (request.method === "GET") {
      const enabled = await readKillswitch(env);
      return ok({ enabled }, cors);
    }
    if (request.method === "POST") {
      const body = await safeJson(request);
      const enabled = parseKillswitchPayload(body);
      if (enabled == null) {
        return bad("INVALID_KILLSWITCH", 400, cors, "enabled boolean required");
      }
      await setKillswitch(env, enabled);
      return ok({ enabled }, cors);
    }
    return bad("METHOD_NOT_ALLOWED", 405, cors);
  }

  return bad("NOT_FOUND", 404, cors);
};

const safeJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export { parseRiskConfig, parseRiskCheckPayload, parseKillswitchPayload };

import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultRiskConfig,
  handle,
  parseKillswitchPayload,
  parseRiskCheckPayload,
  parseRiskConfig
} from "./risk";

const cors = new Headers({ "Access-Control-Allow-Origin": "*" });

const createMemoryKV = (): KVNamespace => {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return {
        keys: [] as KVNamespaceListKey<unknown, string>[],
        list_complete: true,
        cacheStatus: null
      } as KVNamespaceListResult<unknown, string>;
    }
  } as KVNamespace;
};

describe("risk parsers", () => {
  it("parses config payload", () => {
    const payload = parseRiskConfig({
      rules: [
        { id: "max_drawdown", description: "Max drawdown", threshold: 5 }
      ]
    });
    expect(payload?.rules).toHaveLength(1);
  });

  it("rejects invalid config", () => {
    expect(parseRiskConfig({ rules: "nope" })).toBeNull();
  });

  it("parses check payload", () => {
    expect(parseRiskCheckPayload({ metric: "max", value: 1 })).toEqual({ metric: "max", value: 1 });
  });

  it("rejects invalid killswitch", () => {
    expect(parseKillswitchPayload({ enabled: "yes" })).toBeNull();
  });
});

describe("risk handler", () => {
  let kv: KVNamespace;
  beforeEach(() => {
    kv = createMemoryKV();
  });

  const env = () => ({
    AGENT_STATE: kv
  });

  const requestWithAuth = (url: string, init?: RequestInit) =>
    new Request(url, {
      ...init,
      headers: (() => {
        const headers = new Headers(init?.headers as HeadersInit | undefined);
        headers.set("Cf-Access-Authenticated-User-Email", "tester@goldshore.org");
        return headers;
      })()
    });

  it("returns default config", async () => {
    const response = await handle(
      requestWithAuth("https://api.test/v1/risk/config"),
      env() as any,
      cors
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.config).toEqual(defaultRiskConfig());
  });
});

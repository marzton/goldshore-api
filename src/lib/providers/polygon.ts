import type { Env } from "../../types";

export async function polygon(env: Env, path: string, qs: Record<string, string> = {}) {
  if (!env.POLYGON_KEY) {
    throw new Error("POLYGON_KEY missing");
  }
  const url = new URL(`https://api.polygon.io${path}`);
  Object.entries({ apiKey: env.POLYGON_KEY, ...qs }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  const response = await fetch(url.toString(), { cf: { cacheEverything: false } });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Polygon ${response.status}: ${text}`);
  }
  return response.json();
}

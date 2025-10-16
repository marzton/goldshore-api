import type { Env } from "../../types";

export async function polygon(env: Env, path: string, qs: Record<string, string> = {}) {
import type { PolygonConfig } from "../../types";

export async function polygon(env: PolygonConfig, path: string, qs: Record<string, string> = {}) {
  if (!env.POLYGON_KEY) throw new Error("POLYGON_KEY missing");
  const u = new URL(`https://api.polygon.io${path}`);
  Object.entries({ apiKey: env.POLYGON_KEY, ...qs }).forEach(([key, value]) => u.searchParams.set(key, value));
  const res = await fetch(u.toString(), { cf: { cacheEverything: false } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polygon ${res.status}: ${text}`);
  }
  return res.json();
}

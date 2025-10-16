import type { Env } from "../../types";

export async function polygon(env: Env, path: string, qs: Record<string,string> = {}) {
  if (!env.POLYGON_KEY) throw new Error("POLYGON_KEY missing");
  const u = new URL(`https://api.polygon.io${path}`);
  Object.entries({ apiKey: env.POLYGON_KEY, ...qs }).forEach(([k,v])=>u.searchParams.set(k,String(v)));
  const res = await fetch(u, { cf: { cacheEverything: false } });
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${await res.text()}`);
  return res.json();
}

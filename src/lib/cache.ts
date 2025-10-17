import type { Env } from "../types";

export async function cacheGetSet<T = unknown>(env: Env, key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = await env.KV_CACHE.get(key);
  if (hit) return JSON.parse(hit) as T;
  const data = await fetcher();
  await env.KV_CACHE.put(key, JSON.stringify(data), { expirationTtl: ttl });
  return data;
}

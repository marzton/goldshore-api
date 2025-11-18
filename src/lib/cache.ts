import type { Env } from "../types";

export async function cacheGetSet<T>(env: Env, key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  if (!env.KV_CACHE) {
    return fetcher();
  }

  const hit = await env.KV_CACHE.get(key);
  if (hit) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      // continue to refresh below
    }
  }

  const data = await fetcher();
  try {
    await env.KV_CACHE.put(key, JSON.stringify(data), { expirationTtl: ttl });
  } catch {
    // ignore cache write errors
  }
  return data;
}

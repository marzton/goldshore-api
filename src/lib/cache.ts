import type { Env } from "../types";

export async function cacheGetSet<T = unknown>(env: Env, key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const kv = env.KV_CACHE;
  if (!kv) {
    return fetcher();
  }

  const hit = await kv.get(key);
  if (hit) return JSON.parse(hit) as T;
  const data = await fetcher();
  await kv.put(key, JSON.stringify(data), { expirationTtl: ttl });
  return data;
}

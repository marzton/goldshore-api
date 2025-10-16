import { ok, bad } from "../lib/util";
import type { Env } from "../types";

export async function ytSearch(env: Env, url: URL, cors: HeadersInit) {
  const q = url.searchParams.get("q") || "";
  if (!q) return bad("MISSING_QUERY", 400, cors);
  return ok({ ok: true, items: [], q }, cors);
}

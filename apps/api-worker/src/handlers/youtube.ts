import { ok, bad } from "../lib/util";
import type { Env } from "../types";

export async function ytSearch(_env: Env, url: URL, headers: HeadersInit) {
  const query = url.searchParams.get("q") || "";
  if (!query) {
    return bad("MISSING_QUERY", 400, headers);
  }
  return ok({ ok: true, items: [], q: query }, headers);
}

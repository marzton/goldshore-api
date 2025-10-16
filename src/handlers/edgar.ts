import { ok } from "../lib/util";
import type { Env } from "../types";

export async function listFilings(env: Env, url: URL, cors: HeadersInit) {
  const cik = url.searchParams.get("cik") || "";
  const type = url.searchParams.get("type") || "10-K";
  const limit = Number(url.searchParams.get("limit") || "10");
  const data = {
    provider: "sec-edgar",
    cik,
    type,
    limit,
    items: []
  };
  return ok({ ok: true, data }, cors);
}

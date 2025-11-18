import { ok } from "../lib/util";
import type { Env } from "../types";

export async function listFilings(_env: Env, url: URL, headers: HeadersInit) {
  const cik = url.searchParams.get("cik") || "";
  const type = url.searchParams.get("type") || "10-K";
  const limit = Number(url.searchParams.get("limit") || "10");
  return ok(
    {
      ok: true,
      data: {
        provider: "sec-edgar",
        cik,
        type,
        limit,
        items: []
      }
    },
    headers
  );
}

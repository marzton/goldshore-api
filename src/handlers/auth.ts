import { ok } from "../lib/util";
import type { RequestContext } from "../router";

export async function handleWhoami(ctx: RequestContext): Promise<Response> {
  const email = ctx.request.headers.get("CF-Access-Authenticated-User-Email") ?? null;

  return ok(
    {
      ok: true,
      route: "GET /v1/whoami",
      email,
      todo: "Tie Access identity into user profile lookup and session metadata.",
    },
    ctx.cors,
  );
}

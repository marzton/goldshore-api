export const ok = (data: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });

export const bad = (msg: string, status = 400) =>
  new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });

export const unauthorized = (headers: HeadersInit = {}) =>
  new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
    status: 401,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });

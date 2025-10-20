const jsonHeaders = (headers: HeadersInit = {}) => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return responseHeaders;
};

export const ok = (data: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: jsonHeaders(headers)
  });

export const bad = (msg: string, status = 400, headers: HeadersInit = {}, hint?: string) =>
  new Response(JSON.stringify({ ok: false, error: msg, ...(hint ? { hint } : {}) }), {
    status,
    headers: jsonHeaders(headers)
  });

export const unauthorized = (headers: HeadersInit = {}) =>
  bad("AUTH_REQUIRED", 401, headers);

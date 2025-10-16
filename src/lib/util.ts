export const ok = (data: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });

export const bad = (msg: string, status = 400, headers: HeadersInit = {}) =>
  new Response(
    JSON.stringify({ ok: false, error: msg }),
    {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
    }
  );

export const unauthorized = (headers: HeadersInit = {}) =>
  bad("UNAUTHORIZED", 401, headers);

export const serverError = (error: unknown, headers: HeadersInit = {}) => {
  const message = error instanceof Error ? error.message : "Internal Error";
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
    }
  );
};

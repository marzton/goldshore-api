export async function requireAccess(req: Request) {
  const jwt = req.headers.get("CF-Access-Jwt-Assertion");
  const email = req.headers.get("CF-Access-Authenticated-User-Email");
  return Boolean(jwt || email);
}

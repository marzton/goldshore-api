import { createRemoteJWKSet, jwtVerify } from "jose";

// Define the Env interface to include the necessary Cloudflare environment variables.
interface Env {
  CF_ACCESS_JWKS_URL: string;
  CF_ACCESS_ISS: string;
  CF_ACCESS_AUD: string;
}

export async function validateJWT(req: Request, env: Env) {
  const token = req.headers.get("CF-Access-Jwt-Assertion");
  if (!token) {
    return { ok: false, error: "Missing Access Token" };
  }

  const JWKS = createRemoteJWKSet(new URL(env.CF_ACCESS_JWKS_URL));

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.CF_ACCESS_ISS,
      audience: env.CF_ACCESS_AUD
    });

    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: "Invalid Access Token" };
  }
}

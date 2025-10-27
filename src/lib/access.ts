import type { Env } from "../types";

interface AccessIdentity {
  sub: string;
  email?: string;
  issuer?: string;
  audience?: string | string[];
  expiresAt?: number;
  claims: Record<string, unknown>;
}

interface AccessResult {
  authorized: boolean;
  identity?: AccessIdentity;
  reason?: string;
}

type JwkKey = {
  kid: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
};

const jwksCache = new Map<string, { keys: JwkKey[]; fetchedAt: number }>();
const JWKS_TTL = 5 * 60 * 1000; // 5 minutes

const RSA_ALGORITHM_HASH: Record<string, string> = {
  RS256: "SHA-256",
  RS384: "SHA-384",
  RS512: "SHA-512",
};

export async function requireAccess(request: Request, env: Env): Promise<AccessResult> {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion") ?? undefined;
  const emailHeader = request.headers.get("Cf-Access-Authenticated-User-Email") ?? undefined;

  if (!assertion && !emailHeader) {
    return { authorized: false, reason: "missing-assertion" };
  }

  if (assertion) {
    const identity = await verifyAssertion(assertion, env);
    if (identity) {
      return { authorized: true, identity };
    }
  }

  if (emailHeader) {
    return {
      authorized: true,
      identity: {
        sub: emailHeader,
        email: emailHeader,
        claims: { source: "cf-access-email-header" }
      }
    };
  }

  return { authorized: false, reason: "verification-failed" };
}

async function verifyAssertion(token: string, env: Env): Promise<AccessIdentity | undefined> {
  if (!env.ACCESS_JWKS_URL) {
    return undefined;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;

  try {
    header = decodeSection(parts[0]);
    payload = decodeSection(parts[1]);
  } catch (_err) {
    return undefined;
  }

  if (!("kid" in header) || typeof header.kid !== "string") {
    return undefined;
  }

  const jwk = await getKey(header.kid, env.ACCESS_JWKS_URL);
  if (!jwk) {
    return undefined;
  }

  const algorithmCandidate = (header.alg as string | undefined) ?? jwk.alg ?? "RS256";
  if (!isAlgorithmAllowed(algorithmCandidate)) {
    return undefined;
  }
  const algorithm: keyof typeof RSA_ALGORITHM_HASH = algorithmCandidate;

  try {
    const verifier = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, alg: algorithm, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: { name: RSA_ALGORITHM_HASH[algorithm] } },
      false,
      ["verify"]
    );

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToBytes(parts[2]);
    const signatureArray = new Uint8Array(signature);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      verifier,
      signatureArray.buffer.slice(0),
      data
    );
    if (!valid) {
      return undefined;
    }
  } catch (_err) {
    return undefined;
  }

  if (env.ACCESS_ISSUER) {
    const issuer = payload.iss as string | undefined;
    if (!issuer || issuer !== env.ACCESS_ISSUER) {
      return undefined;
    }
  }

  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    return undefined;
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;
  const sub = typeof payload.sub === "string" ? payload.sub : email ?? "unknown";

  return {
    sub,
    email,
    issuer: payload.iss as string | undefined,
    audience: payload.aud as string | string[] | undefined,
    expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
    claims: payload
  };
}

async function getKey(kid: string, jwksUrl: string): Promise<JwkKey | undefined> {
  const cached = jwksCache.get(jwksUrl);
  if (!cached || cached.fetchedAt + JWKS_TTL < Date.now()) {
    const fresh = await fetchJwks(jwksUrl);
    if (!fresh) {
      return undefined;
    }
    jwksCache.set(jwksUrl, { keys: fresh, fetchedAt: Date.now() });
    return fresh.find(key => key.kid === kid);
  }

  return cached.keys.find(key => key.kid === kid);
}

async function fetchJwks(jwksUrl: string): Promise<JwkKey[] | undefined> {
  try {
    const resp = await fetch(jwksUrl, { cf: { cacheTtl: 300, cacheEverything: false } });
    if (!resp.ok) {
      return undefined;
    }
    const body = await resp.json<{ keys?: JwkKey[] }>();
    if (!body.keys) {
      return undefined;
    }
    return body.keys;
  } catch (_err) {
    return undefined;
  }
}

function decodeSection(section: string): Record<string, unknown> {
  const bytes = base64UrlToBytes(section);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as Record<string, unknown>;
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}

function isAlgorithmAllowed(alg: string): alg is keyof typeof RSA_ALGORITHM_HASH {
  return alg in RSA_ALGORITHM_HASH;
}

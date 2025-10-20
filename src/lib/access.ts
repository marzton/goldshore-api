const ACCESS_AUDIENCE = "d79c2b6106887967cfda1cbcea881399352402f5833084b7f3844cd29c205afa";
const ACCESS_ISSUER = "https://goldshore.cloudflareaccess.com";
const ACCESS_JWKS_URL = `${ACCESS_ISSUER}/cdn-cgi/access/certs`;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

type AccessHeader = {
  kid?: string;
  alg?: string;
};

type AccessPayload = {
  aud?: string | string[];
  iss?: string;
  exp?: number;
};

type HashName = "SHA-256" | "SHA-384" | "SHA-512";
type EcNamedCurve = "P-256" | "P-384" | "P-521";

type AccessJwk = JsonWebKey & { kid?: string; kty?: string; crv?: string };

type SupportedImportParams =
  | { name: "RSASSA-PKCS1-v1_5"; hash: { name: "SHA-256" } }
  | { name: "ECDSA"; namedCurve: EcNamedCurve };

type VerifyParams =
  | { name: "RSASSA-PKCS1-v1_5" }
  | { name: "ECDSA"; hash: { name: HashName } };

const ALLOWED_ALGORITHMS = new Set(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]);

let cachedKeys: Map<string, CryptoKey> = new Map();
let cacheExpiresAt = 0;
let inflightFetch: Promise<void> | null = null;

export async function requireAccess(req: Request): Promise<boolean> {
  const jwt = req.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) return false;

  const parts = jwt.split(".");
  if (parts.length !== 3) return false;

  let header: AccessHeader;
  let payload: AccessPayload;

  try {
    header = decodeSection<AccessHeader>(parts[0]);
    payload = decodeSection<AccessPayload>(parts[1]);
  } catch (error) {
    console.error("invalid access token payload", error);
    return false;
  }

  if (!header?.kid || (header.alg && !ALLOWED_ALGORITHMS.has(header.alg))) {
    return false;
  }

  if (!payload || !isAudienceValid(payload.aud)) return false;
  if (!payload.exp || payload.exp * 1000 <= Date.now()) return false;
  if (payload.iss !== ACCESS_ISSUER) return false;

  let key: CryptoKey | undefined;
  try {
    key = await getKey(header.kid);
  } catch (error) {
    console.error("failed to load access signing keys", error);
    return false;
  }

  if (!key) return false;

  const encoder = new TextEncoder();
  const data = encoder.encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToUint8Array(parts[2]);

  const verifyParams = getVerifyParams(key);
  if (!verifyParams) {
    console.error("unsupported key algorithm", key.algorithm);
    return false;
  }

  try {
    const formattedSignature =
      verifyParams.name === "ECDSA" ? joseToDer(signature) : signature;
    return await crypto.subtle.verify(verifyParams, key, formattedSignature, data);
  } catch (error) {
    console.error("access token verification failed", error);
    return false;
  }
}

async function getKey(kid: string): Promise<CryptoKey | undefined> {
  if (cacheExpiresAt > Date.now() && cachedKeys.has(kid)) {
    return cachedKeys.get(kid);
  }

  await loadJwks();
  return cachedKeys.get(kid);
}

async function loadJwks(): Promise<void> {
  if (cacheExpiresAt > Date.now() && cachedKeys.size > 0) {
    return;
  }

  if (!inflightFetch) {
    inflightFetch = (async () => {
      const res = await fetch(ACCESS_JWKS_URL, {
        cf: { cacheEverything: true, cacheTtl: JWKS_CACHE_TTL_MS / 1000 },
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`failed to fetch jwks (${res.status})`);
      }

      const body = await res.json<{ keys?: JsonWebKey[] }>();
      const keys = (body.keys ?? []) as AccessJwk[];

      const map = new Map<string, CryptoKey>();
      await Promise.all(
        keys.map(async (jwk) => {
          if (!jwk.kid) return;

          const algorithm = getImportAlgorithm(jwk);
          if (!algorithm) return;

          try {
            const cryptoKey = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
            map.set(jwk.kid, cryptoKey);
          } catch (error) {
            console.error("failed to import jwk", jwk.kid, error);
          }
        }),
      );

      if (map.size > 0) {
        cachedKeys = map;
        cacheExpiresAt = Date.now() + JWKS_CACHE_TTL_MS;
      } else {
        cacheExpiresAt = 0;
      }
    })().catch((error) => {
      inflightFetch = null;
      throw error;
    });
  }

  try {
    await inflightFetch;
  } finally {
    inflightFetch = null;
  }
}

function getImportAlgorithm(jwk: AccessJwk): SupportedImportParams | null {
  if (jwk.kty === "RSA") {
    return { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } };
  }

  if (jwk.kty === "EC" && typeof jwk.crv === "string") {
    const curve = jwk.crv as EcNamedCurve;
    if (curve === "P-256" || curve === "P-384" || curve === "P-521") {
      return { name: "ECDSA", namedCurve: curve };
    }
  }

  return null;
}

function getVerifyParams(key: CryptoKey): VerifyParams | null {
  const algorithm = key.algorithm as { name: string; namedCurve?: EcNamedCurve };

  if (algorithm.name === "RSASSA-PKCS1-v1_5") {
    return { name: "RSASSA-PKCS1-v1_5" };
  }

  if (algorithm.name === "ECDSA") {
    const hashName = curveHash(algorithm.namedCurve);
    return { name: "ECDSA", hash: { name: hashName } };
  }

  return null;
}

function decodeSection<T>(section: string): T {
  const bytes = base64UrlToUint8Array(section);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

function joseToDer(signature: Uint8Array): Uint8Array {
  const length = signature.length / 2;
  const r = signature.slice(0, length);
  const s = signature.slice(length);

  const rDer = encodeDerInteger(r);
  const sDer = encodeDerInteger(s);
  const sequenceLength = rDer.length + sDer.length;
  const lengthBytes = encodeDerLength(sequenceLength);

  const der = new Uint8Array(1 + lengthBytes.length + sequenceLength);
  der[0] = 0x30;
  der.set(lengthBytes, 1);

  let offset = 1 + lengthBytes.length;
  der.set(rDer, offset);
  offset += rDer.length;
  der.set(sDer, offset);

  return der;
}

function encodeDerInteger(integer: Uint8Array): Uint8Array {
  let offset = 0;
  while (offset < integer.length && integer[offset] === 0) {
    offset += 1;
  }

  let value = integer.slice(offset);
  if (value.length === 0) {
    value = new Uint8Array([0]);
  }

  if (value[0] & 0x80) {
    const extended = new Uint8Array(value.length + 1);
    extended[0] = 0;
    extended.set(value, 1);
    value = extended;
  }

  const lengthBytes = encodeDerLength(value.length);
  const der = new Uint8Array(1 + lengthBytes.length + value.length);
  der[0] = 0x02;
  der.set(lengthBytes, 1);
  der.set(value, 1 + lengthBytes.length);

  return der;
}

function encodeDerLength(length: number): Uint8Array {
  if (length <= 0x7f) {
    return new Uint8Array([length]);
  }

  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }

  const result = new Uint8Array(1 + bytes.length);
  result[0] = 0x80 | bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    result[i + 1] = bytes[i];
  }

  return result;
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const length = binary.length;
  const bytes = new Uint8Array(length);

  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function isAudienceValid(aud: AccessPayload["aud"]): boolean {
  if (!aud) return false;
  if (typeof aud === "string") return aud === ACCESS_AUDIENCE;
  return aud.includes(ACCESS_AUDIENCE);
}

function curveHash(curve: EcNamedCurve | undefined): HashName {
  switch (curve) {
    case "P-384":
      return "SHA-384";
    case "P-521":
      return "SHA-512";
    default:
      return "SHA-256";
  }
}

export default requireAccess;

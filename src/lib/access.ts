const DEFAULT_ACCESS_AUDIENCE = "d79c2b6106887967cfda1cbcea881399352402f5833084b7f3844cd29c205afa";
const DEFAULT_ACCESS_ISSUER = "https://goldshore.cloudflareaccess.com";
const JWKS_PATH = "/cdn-cgi/access/certs";
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface AccessEnvironment {
  ACCESS_AUDIENCE?: string;
  ACCESS_ISSUER?: string;
  ACCESS_JWKS_URL?: string;
}

interface AccessConfig {
  audience: string;
  issuer: string;
  jwksUrl: string;
}

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
  | { name: "RSASSA-PKCS1-v1_5"; hash: { name: HashName } }
  | { name: "ECDSA"; namedCurve: EcNamedCurve };

type VerifyParams =
  | { name: "RSASSA-PKCS1-v1_5" }
  | { name: "ECDSA"; hash: { name: HashName } };

type KeyCache = {
  keys: Map<string, CryptoKey>;
  jwks: Map<string, AccessJwk>;
  expiresAt: number;
  inflight: Promise<void> | null;
};

const ALLOWED_ALGORITHMS = new Set(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]);
const RSA_HASH_BY_ALG = new Map<string, HashName>([
  ["RS256", "SHA-256"],
  ["RS384", "SHA-384"],
  ["RS512", "SHA-512"],
]);
const keyCaches = new Map<string, KeyCache>();

export async function requireAccess(req: Request, env?: AccessEnvironment): Promise<boolean> {
  const jwt = req.headers.get("CF-Access-Jwt-Assertion");
  if (!jwt) return false;

  const config = resolveConfig(env);
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

  if (!header?.kid || !header.alg || !ALLOWED_ALGORITHMS.has(header.alg)) {
    return false;
  }

  if (!payload || !isAudienceValid(payload.aud, config.audience)) return false;
  if (!payload.exp || payload.exp * 1000 <= Date.now()) return false;
  if (!payload.iss || normalizeIssuer(payload.iss) !== config.issuer) return false;

  let key: CryptoKey | undefined;
  try {
    key = await getKey(header.kid, header.alg, config);
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

  const normalizedSignature =
    verifyParams.name === "ECDSA" ? convertJoseSignatureToDer(signature) : signature;

  try {
    return await crypto.subtle.verify(verifyParams, key, normalizedSignature, data);
  } catch (error) {
    console.error("access token verification failed", error);
    return false;
  }
}

async function getKey(kid: string, alg: string, config: AccessConfig): Promise<CryptoKey | undefined> {
  const cache = getCache(config.jwksUrl);
  const cacheKey = getCacheKey(kid, alg);
  const isRsa = RSA_HASH_BY_ALG.has(alg);

  if (cache.expiresAt > Date.now() && cache.keys.has(cacheKey)) {
    return cache.keys.get(cacheKey);
  }

  await loadJwks(cache, config);
  if (cache.keys.has(cacheKey)) {
    return cache.keys.get(cacheKey);
  }

  if (!isRsa) {
    return undefined;
  }

  const hashName = RSA_HASH_BY_ALG.get(alg);
  const jwk = hashName ? cache.jwks.get(kid) : undefined;
  if (!hashName || !jwk) {
    return undefined;
  }

  const algorithm = getImportAlgorithm(jwk, hashName);
  if (!algorithm) {
    return undefined;
  }

  try {
    const cryptoKey = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
    cache.keys.set(cacheKey, cryptoKey);
    return cryptoKey;
  } catch (error) {
    console.error("failed to import jwk", `${kid}:${alg}`, error);
    return undefined;
  }
}

function getCache(url: string): KeyCache {
  let cache = keyCaches.get(url);
  if (!cache) {
    cache = { keys: new Map(), jwks: new Map(), expiresAt: 0, inflight: null };
    keyCaches.set(url, cache);
  }
  return cache;
}

async function loadJwks(cache: KeyCache, config: AccessConfig): Promise<void> {
  if (cache.expiresAt > Date.now() && (cache.keys.size > 0 || cache.jwks.size > 0)) {
    return;
  }

  if (!cache.inflight) {
    cache.inflight = (async () => {
      const res = await fetch(config.jwksUrl, {
        cf: { cacheEverything: true, cacheTtl: JWKS_CACHE_TTL_MS / 1000 },
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`failed to fetch jwks (${res.status})`);
      }

      const body = await res.json<{ keys?: JsonWebKey[] }>();
      const keys = (body.keys ?? []) as AccessJwk[];
      const imported = new Map<string, CryptoKey>();
      const jwksByKid = new Map<string, AccessJwk>();

      await Promise.all(
        keys.map(async (jwk) => {
          if (!jwk.kid) return;

          jwksByKid.set(jwk.kid, jwk);

          if (jwk.kty === "RSA") {
            const rsaAlgorithms = getRsaAlgorithmsToImport(jwk);
            await Promise.all(
              rsaAlgorithms.map(async ([alg, hashName]) => {
                if (!ALLOWED_ALGORITHMS.has(alg)) return;

                const algorithm = getImportAlgorithm(jwk, hashName);
                if (!algorithm) return;

                try {
                  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
                  imported.set(getCacheKey(jwk.kid!, alg), cryptoKey);
                } catch (error) {
                  console.error("failed to import jwk", `${jwk.kid}:${alg}`, error);
                }
              }),
            );
            return;
          }

          const algorithm = getImportAlgorithm(jwk);
          if (!algorithm) return;

          try {
            const cryptoKey = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
            imported.set(getCacheKey(jwk.kid), cryptoKey);
          } catch (error) {
            console.error("failed to import jwk", jwk.kid, error);
          }
        }),
      );

      cache.keys = imported;
      cache.jwks = jwksByKid;

      if (jwksByKid.size > 0) {
        cache.expiresAt = Date.now() + JWKS_CACHE_TTL_MS;
      } else if (cache.keys.size === 0) {
        cache.expiresAt = 0;
      }
    })().catch((error) => {
      cache.inflight = null;
      throw error;
    });
  }

  try {
    await cache.inflight;
  } finally {
    cache.inflight = null;
  }
}

function resolveConfig(env?: AccessEnvironment): AccessConfig {
  const audience = env?.ACCESS_AUDIENCE?.trim() || DEFAULT_ACCESS_AUDIENCE;
  const issuer = normalizeIssuer(env?.ACCESS_ISSUER || DEFAULT_ACCESS_ISSUER);
  const jwksUrl = (env?.ACCESS_JWKS_URL && env.ACCESS_JWKS_URL.trim()) || `${issuer}${JWKS_PATH}`;

  return { audience, issuer, jwksUrl };
}

function getCacheKey(kid: string, alg?: string): string {
  if (alg && RSA_HASH_BY_ALG.has(alg)) {
    return `${kid}:${alg}`;
  }
  return kid;
}

function getRsaAlgorithmsToImport(jwk: AccessJwk): Array<[string, HashName]> {
  if (typeof jwk.alg === "string") {
    const hashName = RSA_HASH_BY_ALG.get(jwk.alg);
    if (!hashName) {
      return [];
    }
    return [[jwk.alg, hashName]];
  }

  return Array.from(RSA_HASH_BY_ALG.entries());
}

function getImportAlgorithm(jwk: AccessJwk, hashName?: HashName): SupportedImportParams | null {
  if (jwk.kty === "RSA") {
    const hash = hashName ?? "SHA-256";
    return { name: "RSASSA-PKCS1-v1_5", hash: { name: hash } };
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

function convertJoseSignatureToDer(signature: Uint8Array): Uint8Array {
  const midpoint = signature.length / 2;
  let r = trimLeadingZeros(signature.slice(0, midpoint));
  let s = trimLeadingZeros(signature.slice(midpoint));

  if (r[0] & 0x80) {
    r = prependZero(r);
  }

  if (s[0] & 0x80) {
    s = prependZero(s);
  }

  const rLengthBytes = encodeDerLength(r.length);
  const sLengthBytes = encodeDerLength(s.length);
  const sequenceLength =
    1 + rLengthBytes.length + r.length + 1 + sLengthBytes.length + s.length;
  const sequenceLengthBytes = encodeDerLength(sequenceLength);
  const der = new Uint8Array(1 + sequenceLengthBytes.length + sequenceLength);
  let offset = 0;

  der[offset++] = 0x30;
  der.set(sequenceLengthBytes, offset);
  offset += sequenceLengthBytes.length;
  der[offset++] = 0x02;
  der.set(rLengthBytes, offset);
  offset += rLengthBytes.length;
  der.set(r, offset);
  offset += r.length;
  der[offset++] = 0x02;
  der.set(sLengthBytes, offset);
  offset += sLengthBytes.length;
  der.set(s, offset);

  return der;
}

function encodeDerLength(length: number): Uint8Array {
  if (length <= 0x7f) {
    return Uint8Array.of(length);
  }

  const bytes: number[] = [];
  let remaining = length;

  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }

  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function trimLeadingZeros(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start += 1;
  }
  return bytes.slice(start);
}

function prependZero(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length + 1);
  result[0] = 0;
  result.set(bytes, 1);
  return result;
}

function isAudienceValid(aud: AccessPayload["aud"], expected: string): boolean {
  if (!aud) return false;
  if (typeof aud === "string") return aud === expected;
  return aud.includes(expected);
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

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

export default requireAccess;

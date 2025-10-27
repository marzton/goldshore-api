const DEFAULT_ACCESS_AUDIENCE = "d79c2b6106887967cfda1cbcea881399352402f5833084b7f3844cd29c205afa";
const DEFAULT_ACCESS_ISSUER = "https://goldshore.cloudflareaccess.com";
const JWKS_PATH = "/cdn-cgi/access/certs";
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;

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

type AccessJwk = JsonWebKey & { kid?: string; kty?: string; crv?: string; alg?: string };

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
  missing: Map<string, number>;
};

const ALLOWED_ALGORITHMS = new Set(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]);
const RSA_HASH_BY_ALG = new Map<string, HashName>([
  ["RS256", "SHA-256"],
  ["RS384", "SHA-384"],
  ["RS512", "SHA-512"],
]);
const EC_HASH_BY_ALG = new Map<string, HashName>([
  ["ES256", "SHA-256"],
  ["ES384", "SHA-384"],
  ["ES512", "SHA-512"],
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
    console.error("invalid access token data", error);
    return false;
  }

  if (!header?.kid || !header.alg) {
    return false;
  }

  const algorithm = header.alg.toUpperCase();
  if (!ALLOWED_ALGORITHMS.has(algorithm)) {
    return false;
  }

  if (!payload || !isAudienceValid(payload.aud, config.audience)) return false;
  if (!payload.exp || payload.exp * 1000 <= Date.now()) return false;
  if (!payload.iss || normalizeIssuer(payload.iss) !== config.issuer) return false;

  const signature = (() => {
    try {
      return base64UrlToUint8Array(parts[2]);
    } catch (error) {
      console.error("invalid access token signature", error);
      return null;
    }
  })();

  if (!signature) {
    return false;
  }

  let key: CryptoKey | undefined;
  try {
    key = await getKey(header.kid, algorithm, config);
  } catch (error) {
    console.error("failed to load access signing keys", error);
    return false;
  }

  if (!key) {
    return false;
  }

  if (algorithm.startsWith("RS")) {
    const expectedHash = hashFromAlg(algorithm);
    const keyAlgorithm = key.algorithm as { hash?: { name?: string } };
    const actualHash = keyAlgorithm.hash?.name?.toUpperCase();
    if (expectedHash && actualHash && expectedHash !== actualHash) {
      console.error("rsa signing algorithm mismatch", {
        kid: header.kid,
        expectedHash,
        actualHash,
      });
      return false;
    }
  }

  const verifyParams = getVerifyParams(key, algorithm);
  if (!verifyParams) {
    console.error("unsupported key algorithm", key.algorithm);
    return false;
  }

  const normalizedSignature = normalizeSignature(signature, key, verifyParams);
  if (!normalizedSignature) {
    return false;
  }

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

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
  const now = Date.now();

  if (cache.expiresAt > now) {
    const cached = cache.keys.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const missingUntil = cache.missing.get(cacheKey);
  const missingValid = typeof missingUntil === "number" && missingUntil > now;
  const shouldForceReload = cache.expiresAt <= now || (!cache.keys.has(cacheKey) && !missingValid);

  await loadJwks(cache, config, shouldForceReload);

  let key = cache.keys.get(cacheKey);
  if (key) {
    cache.missing.delete(cacheKey);
    return key;
  }

  const jwk = cache.jwks.get(kid);
  if (!jwk) {
    if (!missingValid) {
      cache.missing.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    }
    return undefined;
  }

  const importAlgorithm = getImportAlgorithmForAlg(jwk, alg);
  if (!importAlgorithm) {
    cache.missing.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    return undefined;
  }

  try {
    key = await crypto.subtle.importKey("jwk", jwk, importAlgorithm, false, ["verify"]);
  } catch (error) {
    console.error("failed to import jwk", `${kid}:${alg}`, error);
    cache.missing.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    return undefined;
  }

  cache.keys.set(cacheKey, key);
  cache.missing.delete(cacheKey);
  return key;
}

function getCache(url: string): KeyCache {
  let cache = keyCaches.get(url);
  if (!cache) {
    cache = {
      keys: new Map(),
      jwks: new Map(),
      expiresAt: 0,
      inflight: null,
      missing: new Map(),
    };
    keyCaches.set(url, cache);
  }
  return cache;
}

async function loadJwks(cache: KeyCache, config: AccessConfig, forceReload: boolean): Promise<void> {
  const now = Date.now();
  if (!forceReload && cache.expiresAt > now && cache.jwks.size > 0) {
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

      const jwksByKid = new Map<string, AccessJwk>();
      const allowedCacheKeys = new Set<string>();

      for (const jwk of keys) {
        if (!jwk.kid) continue;
        jwksByKid.set(jwk.kid, jwk);

        if (jwk.kty === "RSA") {
          for (const [alg] of getRsaAlgorithmsToImport(jwk)) {
            allowedCacheKeys.add(getCacheKey(jwk.kid, alg));
          }
        } else {
          allowedCacheKeys.add(getCacheKey(jwk.kid));
        }
      }

      cache.jwks = jwksByKid;
      cache.expiresAt = Date.now() + JWKS_CACHE_TTL_MS;
      cache.missing.clear();

      for (const existingKey of Array.from(cache.keys.keys())) {
        if (!allowedCacheKeys.has(existingKey)) {
          cache.keys.delete(existingKey);
        }
      }
    })().catch((error) => {
      cache.expiresAt = 0;
      throw error;
    });
  }

  try {
    await cache.inflight;
  } finally {
    cache.inflight = null;
  }
}

async function importRsaKeyForAllHashes(
  jwk: AccessJwk,
  rsaKeys: Map<string, Map<HashName, CryptoKey>>,
): Promise<void> {
  if (!jwk.kid) {
    return;
  }

  let byHash = rsaKeys.get(jwk.kid);
  if (!byHash) {
    byHash = new Map<HashName, CryptoKey>();
    rsaKeys.set(jwk.kid, byHash);
  }

  let imported = false;
  let lastError: unknown;

  for (const hashName of RSA_HASHES) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: { name: hashName } },
        false,
        ["verify"],
      );
      byHash.set(hashName, cryptoKey);
      imported = true;
    } catch (error) {
      lastError = error;
    }
  }

  if (!imported) {
    rsaKeys.delete(jwk.kid);
    console.error("failed to import rsa jwk", jwk.kid, lastError);
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
    const hashName = RSA_HASH_BY_ALG.get(jwk.alg.toUpperCase());
    if (!hashName) {
      return [];
    }
    return [[jwk.alg.toUpperCase(), hashName]];
  }

  return Array.from(RSA_HASH_BY_ALG.entries());
}

function getImportAlgorithm(jwk: AccessJwk, hashName?: HashName): SupportedImportParams | null {
  if (jwk.kty === "RSA") {
    if (!hashName) {
      return null;
    }
    return { name: "RSASSA-PKCS1-v1_5", hash: { name: hashName } };
  }

  if (jwk.kty === "EC" && typeof jwk.crv === "string") {
    const curve = jwk.crv as EcNamedCurve;
    if (curve === "P-256" || curve === "P-384" || curve === "P-521") {
      return { name: "ECDSA", namedCurve: curve };
    }
  }

  return null;
}

function getImportAlgorithmForAlg(jwk: AccessJwk, alg: string): SupportedImportParams | null {
  if (jwk.kty === "RSA") {
    const hashName = RSA_HASH_BY_ALG.get(alg);
    return hashName ? getImportAlgorithm(jwk, hashName) : null;
  }

  if (jwk.kty === "EC") {
    return getImportAlgorithm(jwk);
  }

  return null;
}

function getVerifyParams(key: CryptoKey, alg: string): VerifyParams | null {
  const algorithm = key.algorithm as { name: string; namedCurve?: EcNamedCurve };

  if (algorithm.name === "RSASSA-PKCS1-v1_5") {
    return { name: "RSASSA-PKCS1-v1_5" };
  }

  if (algorithm.name === "ECDSA") {
    const hashName = EC_HASH_BY_ALG.get(alg);
    if (!hashName) {
      return null;
    }
    return { name: "ECDSA", hash: { name: hashName } };
  }

  return null;
}

function hashFromAlg(alg?: string): HashName | null {
  if (!alg) return null;

  const upper = alg.toUpperCase();
  if (RSA_HASH_BY_ALG.has(upper)) {
    return RSA_HASH_BY_ALG.get(upper) ?? null;
  }
  if (EC_HASH_BY_ALG.has(upper)) {
    return EC_HASH_BY_ALG.get(upper) ?? null;
  }
  return null;
}

function decodeSection<T>(section: string): T {
  const json = new TextDecoder().decode(base64UrlToUint8Array(section));
  return JSON.parse(json) as T;
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const encoded = normalized + padding;

  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
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

  const derLength = 2 + r.length + 2 + s.length;
  const der = new Uint8Array(2 + derLength);
  let offset = 0;

  der[offset++] = 0x30;
  der[offset++] = derLength;
  der[offset++] = 0x02;
  der[offset++] = r.length;
  der.set(r, offset);
  offset += r.length;
  der[offset++] = 0x02;
  der[offset++] = s.length;
  der.set(s, offset);

  return der;
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
  if (typeof aud === "string") {
    return aud === expected;
  }
  if (Array.isArray(aud)) {
    return aud.includes(expected);
  }
  return false;
}

function normalizeSignature(signature: Uint8Array, key: CryptoKey, verifyParams: VerifyParams): Uint8Array | null {
  if (verifyParams.name !== "ECDSA") {
    return signature;
  }

  const algorithm = key.algorithm as { name: string; namedCurve?: EcNamedCurve };
  const curveSize = ecdsaCurveSize(algorithm.namedCurve);
  if (!curveSize) {
    console.error("unsupported ecdsa curve", algorithm.namedCurve);
    return null;
  }

  if (signature.length !== curveSize * 2) {
    console.error("unexpected ecdsa signature length", signature.length);
    return null;
  }

  return joseToDerSignature(signature, curveSize);
}

function ecdsaCurveSize(curve: EcNamedCurve | undefined): number | null {
  switch (curve) {
    case "P-256":
      return 32;
    case "P-384":
      return 48;
    case "P-521":
      return 66;
    default:
      return null;
  }
}

function joseToDerSignature(signature: Uint8Array, size: number): Uint8Array {
  const r = normalizeDerInteger(signature.slice(0, size));
  const s = normalizeDerInteger(signature.slice(size));

  const sequenceLength =
    2 +
    encodeDerLength(r.length).length +
    r.length +
    2 +
    encodeDerLength(s.length).length +
    s.length;
  const sequenceLengthBytes = encodeDerLength(sequenceLength);
  const der = new Uint8Array(1 + sequenceLengthBytes.length + sequenceLength);

  let offset = 0;
  der[offset++] = 0x30; // SEQUENCE
  der.set(sequenceLengthBytes, offset);
  offset += sequenceLengthBytes.length;

  der[offset++] = 0x02; // INTEGER
  const rLengthBytes = encodeDerLength(r.length);
  der.set(rLengthBytes, offset);
  offset += rLengthBytes.length;
  der.set(r, offset);
  offset += r.length;

  der[offset++] = 0x02; // INTEGER
  const sLengthBytes = encodeDerLength(s.length);
  der.set(sLengthBytes, offset);
  offset += sLengthBytes.length;
  der.set(s, offset);

  return der;
}

function normalizeDerInteger(bytes: Uint8Array): Uint8Array {
  let firstNonZero = 0;
  while (firstNonZero < bytes.length && bytes[firstNonZero] === 0) {
    firstNonZero += 1;
  }

  let normalized = bytes.slice(firstNonZero);
  if (normalized.length === 0) {
    normalized = new Uint8Array(1);
  }

  if (normalized[0] & 0x80) {
    const padded = new Uint8Array(normalized.length + 1);
    padded.set(normalized, 1);
    return padded;
  }

  return normalized;
}

function encodeDerLength(length: number): Uint8Array {
  if (length < 0x80) {
    return Uint8Array.of(length);
  }

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }

  const result = new Uint8Array(1 + bytes.length);
  result[0] = 0x80 | bytes.length;
  bytes.forEach((value, index) => {
    result[index + 1] = value;
  });
  return result;
}

function normalizeIssuer(value: string): string {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }

  return end === value.length ? value : value.slice(0, end);
}

export default requireAccess;

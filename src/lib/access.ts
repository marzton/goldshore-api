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

  if (!header?.kid || (header.alg && !ALLOWED_ALGORITHMS.has(header.alg))) {
    return false;
  }

  if (!payload || !isAudienceValid(payload.aud, config.audience)) return false;
  if (!payload.exp || payload.exp * 1000 <= Date.now()) return false;
  if (!payload.iss || normalizeIssuer(payload.iss) !== config.issuer) return false;

  let key: CryptoKey | undefined;
  try {
    key = await getKey(header.kid, config, header.alg);
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

  const normalizedSignature = normalizeSignature(signature, key, verifyParams);
  if (!normalizedSignature) {
    return false;
  }

  try {
    return await crypto.subtle.verify(verifyParams, key, normalizedSignature, data);
  } catch (error) {
    console.error("access token verification failed", error);
    return false;
  }
}

async function getKey(kid: string, config: AccessConfig, alg?: string): Promise<CryptoKey | undefined> {
  const cache = getCache(config.jwksUrl);

  if (cache.expiresAt > Date.now() && cache.keys.has(kid)) {
    const key = cache.keys.get(kid);
    if (!key) return undefined;
    return ensureKeyForAlgorithm(kid, key, cache, alg);
  }

  if (cache.expiresAt > Date.now()) {
    const imported = await importKeyFromCache(kid, cache, alg);
    if (imported) {
      return imported;
    }
    return cache.keys.get(kid);
  }

  await loadJwks(cache, config);
  const key = cache.keys.get(kid);
  if (key) {
    return ensureKeyForAlgorithm(kid, key, cache, alg);
  }

  return importKeyFromCache(kid, cache, alg);
}

function getCache(url: string): KeyCache {
  let cache = keyCaches.get(url);
  if (!cache) {
    cache = { keys: new Map(), jwks: new Map(), expiresAt: 0, inflight: null };
    keyCaches.set(url, cache);
  }
  return cache;
}

async function loadJwks(cache: KeyCache, config: AccessConfig, force = false): Promise<void> {
  if (!force && cache.expiresAt > Date.now() && cache.keys.size > 0) {
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

          const algorithm = getImportAlgorithm(jwk);
          if (!algorithm) return;

          try {
            const cryptoKey = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
            imported.set(jwk.kid, cryptoKey);
          } catch (error) {
            console.error("failed to import jwk", jwk.kid, error);
          }
        }),
      );

      if (imported.size > 0) {
        cache.keys = imported;
        cache.jwks = jwksByKid;
        cache.expiresAt = Date.now() + JWKS_CACHE_TTL_MS;
        for (const kid of imported.keys()) {
          cache.missing.delete(kid);
        }
      } else if (cache.keys.size === 0) {
        cache.expiresAt = 0;
        cache.jwks = jwksByKid;
      } else if (jwksByKid.size > 0) {
        cache.jwks = jwksByKid;
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

function getImportAlgorithm(jwk: AccessJwk, algOverride?: string): SupportedImportParams | null {
  if (jwk.kty === "RSA") {
    const hashName = rsaHashFromAlg(algOverride ?? jwk.alg);
    if (!hashName) return null;
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

async function ensureKeyForAlgorithm(
  kid: string,
  key: CryptoKey,
  cache: KeyCache,
  alg?: string,
): Promise<CryptoKey> {
  if (!alg || key.algorithm.name !== "RSASSA-PKCS1-v1_5") {
    return key;
  }

  const expectedHash = rsaHashFromAlg(alg);
  if (!expectedHash) {
    return key;
  }

  const rsaAlgorithm = key.algorithm as { hash?: { name?: string } };
  const currentHash = rsaAlgorithm.hash?.name as HashName | undefined;
  if (currentHash === expectedHash) {
    return key;
  }

  const jwk = cache.jwks.get(kid);
  if (!jwk) {
    return key;
  }

  const importAlgorithm = getImportAlgorithm(jwk, alg);
  if (!importAlgorithm) {
    return key;
  }

  try {
    const reimported = await crypto.subtle.importKey("jwk", jwk, importAlgorithm, false, ["verify"]);
    cache.keys.set(kid, reimported);
    return reimported;
  } catch (error) {
    console.error("failed to re-import jwk", kid, alg, error);
    return key;
  }
}

async function importKeyFromCache(kid: string, cache: KeyCache, alg?: string): Promise<CryptoKey | undefined> {
  const jwk = cache.jwks.get(kid);
  if (!jwk) {
    return undefined;
  }

  const algorithm = getImportAlgorithm(jwk, alg);
  if (!algorithm) {
    return undefined;
  }

  try {
    const imported = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
    cache.keys.set(kid, imported);
    return imported;
  } catch (error) {
    console.error("failed to import jwk for algorithm", kid, alg, error);
    return undefined;
  }
}

function rsaHashFromAlg(alg?: string): HashName | null {
  if (typeof alg !== "string") return null;

  switch (alg.toUpperCase()) {
    case "RS256":
      return "SHA-256";
    case "RS384":
      return "SHA-384";
    case "RS512":
      return "SHA-512";
    default:
      return null;
  }
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

function isAudienceValid(aud: AccessPayload["aud"], expected: string): boolean {
  if (!aud) return false;
  if (typeof aud === "string") return aud === expected;
  return aud.includes(expected);
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

  const sequenceLength = 2 + encodeDerLength(r.length).length + r.length + 2 + encodeDerLength(s.length).length + s.length;
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

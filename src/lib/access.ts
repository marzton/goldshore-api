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
  keys: Map<string, Map<string, CryptoKey>>;
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

async function getKey(kid: string, alg: string | undefined, config: AccessConfig): Promise<CryptoKey | undefined> {
  const cache = getCache(config.jwksUrl);

  const now = Date.now();
  const cacheValid = cache.expiresAt > now;
  const desiredKeyType = cacheKeyTypeFromAlg(alg);
  if (cacheValid) {
    const cached = getCachedKey(cache, kid, desiredKeyType);
    if (cached) {
      return cached;
    }
  }

  const missingKeyId = getMissingKeyId(kid, alg);
  const missingUntil = cache.missing.get(missingKeyId);
  const missingValid = typeof missingUntil === "number" && missingUntil > now;
  const hasJwk = cacheValid ? cache.jwks.has(kid) : false;
  const forceRefresh = cacheValid && !hasJwk && !missingValid;

  await loadJwks(cache, config, forceRefresh);

  const refreshedKey = getCachedKey(cache, kid, desiredKeyType);
  if (refreshedKey) {
    cache.missing.delete(missingKeyId);
    return refreshedKey;
  }

  const jwk = cache.jwks.get(kid);
  if (!jwk) {
    setMissing(cache, missingKeyId);
    return undefined;
  }

  const importAlgorithm = resolveImportAlgorithm(jwk, alg);
  if (!importAlgorithm) {
    setMissing(cache, missingKeyId);
    return undefined;
  }

  try {
    const cryptoKey = await crypto.subtle.importKey("jwk", jwk, importAlgorithm, false, ["verify"]);
    let keyMap = cache.keys.get(kid);
    if (!keyMap) {
      keyMap = new Map();
      cache.keys.set(kid, keyMap);
    }
    keyMap.set(cacheKeyType(importAlgorithm), cryptoKey);
    cache.missing.delete(missingKeyId);
    return cryptoKey;
  } catch (error) {
    console.error("failed to import jwk", kid, error);
    setMissing(cache, missingKeyId);
    return undefined;
  }
}

function getCache(url: string): KeyCache {
  let cache = keyCaches.get(url);
  if (!cache) {
    cache = { keys: new Map(), jwks: new Map(), expiresAt: 0, inflight: null, missing: new Map() };
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
      const jwkMap = new Map<string, AccessJwk>();
      const imported = new Map<string, Map<string, CryptoKey>>();

      await Promise.all(
        keys.map(async (jwk) => {
          if (!jwk.kid) return;

          jwkMap.set(jwk.kid, jwk);

          const algorithm = resolveImportAlgorithm(jwk, jwk.alg);
          if (!algorithm) return;

          try {
            const cryptoKey = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
            const keyType = cacheKeyType(algorithm);
            const existing = imported.get(jwk.kid) ?? new Map<string, CryptoKey>();
            existing.set(keyType, cryptoKey);
            imported.set(jwk.kid, existing);
          } catch (error) {
            console.error("failed to import jwk", jwk.kid, error);
          }
        }),
      );

      if (jwkMap.size > 0) {
        const nextKeys = new Map<string, Map<string, CryptoKey>>();
        for (const [kid, keyMap] of cache.keys) {
          if (jwkMap.has(kid)) {
            nextKeys.set(kid, new Map(keyMap));
          }
        }
        for (const [kid, keyMap] of imported) {
          const existing = nextKeys.get(kid) ?? new Map<string, CryptoKey>();
          for (const [keyType, key] of keyMap) {
            existing.set(keyType, key);
          }
          nextKeys.set(kid, existing);
        }

        cache.keys = nextKeys;
        cache.jwks = jwkMap;
        cache.expiresAt = Date.now() + JWKS_CACHE_TTL_MS;
        clearMissingForKids(cache, jwkMap.keys());
      } else if (cache.keys.size === 0) {
        cache.expiresAt = 0;
        cache.jwks = jwkMap;
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

function resolveImportAlgorithm(jwk: AccessJwk, tokenAlg?: string): SupportedImportParams | null {
  if (jwk.kty === "RSA") {
    const hash = rsaHash(tokenAlg ?? jwk.alg);
    if (!hash) {
      return null;
    }

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

function cacheKeyType(params: SupportedImportParams): string {
  if (params.name === "RSASSA-PKCS1-v1_5") {
    return `RSA:${params.hash.name}`;
  }

  return `EC:${params.namedCurve}`;
}

function cacheKeyTypeFromAlg(alg: string | undefined): string | null {
  if (!alg) {
    return null;
  }

  if (alg.startsWith("RS")) {
    const hash = rsaHash(alg);
    return hash ? `RSA:${hash}` : null;
  }

  if (alg.startsWith("ES")) {
    const curve = curveForAlg(alg);
    return curve ? `EC:${curve}` : null;
  }

  return null;
}

function getCachedKey(cache: KeyCache, kid: string, keyType: string | null): CryptoKey | undefined {
  const keyMap = cache.keys.get(kid);
  if (!keyMap) {
    return undefined;
  }

  if (keyType && keyMap.has(keyType)) {
    return keyMap.get(keyType);
  }

  const iterator = keyMap.values().next();
  return iterator.done ? undefined : iterator.value;
}

function getMissingKeyId(kid: string, alg: string | undefined): string {
  return `${kid}:${alg ?? ""}`;
}

function setMissing(cache: KeyCache, missingKeyId: string): void {
  cache.missing.set(missingKeyId, Date.now() + JWKS_CACHE_TTL_MS);
}

function clearMissingForKids(cache: KeyCache, kids: Iterable<string>): void {
  const kidSet = new Set<string>(Array.from(kids));
  if (kidSet.size === 0) {
    return;
  }

  for (const missingKey of Array.from(cache.missing.keys())) {
    const separatorIndex = missingKey.indexOf(":");
    const keyKid = separatorIndex === -1 ? missingKey : missingKey.slice(0, separatorIndex);
    if (kidSet.has(keyKid)) {
      cache.missing.delete(missingKey);
    }
  }
}

function rsaHash(algorithm?: string): HashName | null {
  switch (algorithm) {
    case "RS256":
      return "SHA-256";
    case "RS384":
      return "SHA-384";
    case "RS512":
      return "SHA-512";
    case undefined:
      return "SHA-256";
    default:
      return null;
  }
}

function curveForAlg(alg?: string): EcNamedCurve | null {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
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
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }

  return end === value.length ? value : value.slice(0, end);
}

export default requireAccess;

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

const ACCESS_AUDIENCE =
  "d79c2b6106887967cfda1cbcea881399352402f5833084b7f3844cd29c205afa";
const ACCESS_ISSUER = "https://goldshore.cloudflareaccess.com";
const ACCESS_JWKS_URL = `${ACCESS_ISSUER}/cdn-cgi/access/certs`;
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
type AlgorithmDetails =
  | { type: "RSA"; hash: HashName }
  | { type: "EC"; hash: HashName };

const ALLOWED_ALGORITHMS = new Set([
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
]);

type CachedKeyEntry = {
  jwk: AccessJwk;
  rsaKeys?: Map<HashName, CryptoKey>;
  ecKey?: CryptoKey;
};

let cachedKeys: Map<string, CachedKeyEntry> = new Map();
let cacheExpiresAt = 0;
let inflightFetch: Promise<void> | null = null;

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

  if (!header?.kid || !header.alg || !ALLOWED_ALGORITHMS.has(header.alg)) {
    return false;
  }

  if (!header.alg) return false;

  if (!payload || !isAudienceValid(payload.aud)) return false;
  if (!payload || !isAudienceValid(payload.aud, config.audience)) return false;
  if (!payload.exp || payload.exp * 1000 <= Date.now()) return false;
  if (!payload.iss || normalizeIssuer(payload.iss) !== config.issuer) return false;

  const algorithmDetails = getAlgorithmDetails(header.alg);
  if (!algorithmDetails) return false;

  let key: CryptoKey | undefined;
  try {
    key = await getKey(header.kid, algorithmDetails);
    key = await getKey(header.kid, config);
  } catch (error) {
    console.error("failed to load access signing keys", error);
    return false;
  }

  if (!key) return false;

  if (header.alg.startsWith("RS")) {
    const expectedHash = rsaHashForAlgorithm(header.alg);
    const keyAlgorithm = key.algorithm as { hash?: { name?: string } };
    const actualHash = keyAlgorithm.hash?.name;
    if (expectedHash && actualHash && expectedHash !== actualHash) {
      console.error("rsa signing algorithm mismatch", {
        kid: header.kid,
        expectedHash,
        actualHash,
      });
      return false;
    }
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(`${parts[0]}.${parts[1]}`);
  const verifyParams = getVerifyParams(algorithmDetails);
  const signature = base64UrlToUint8Array(parts[2]);

  try {
    let signature = base64UrlToUint8Array(parts[2]);

    if (verifyParams.name === "ECDSA") {
      signature = joseToDerSignature(signature);
    }

  const normalizedSignature = normalizeSignature(signature, key, verifyParams);
  if (!normalizedSignature) {
    return false;
  }

  const normalizedSignature = normalizeSignature(signature, key, verifyParams);
  if (!normalizedSignature) {
    return false;
  }

  const normalizedSignature = normalizeSignature(signature, key, verifyParams);
  if (!normalizedSignature) {
    return false;
  }

  const normalizedSignature = normalizeSignature(signature, key, verifyParams);
  if (!normalizedSignature) {
    return false;
  }

  const normalizedSignature = normalizeSignature(signature, key, verifyParams);
  if (!normalizedSignature) {
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

async function getKey(
  kid: string,
  alg: string | undefined,
  config: AccessConfig,
): Promise<CryptoKey | undefined> {
  const cache = getCache(config.jwksUrl);

  const now = Date.now();
  const cacheValid = cache.expiresAt > now;
  if (cacheValid && cache.keys.has(kid)) {
    return cache.keys.get(kid);
  }

  const missingUntil = cache.missing.get(kid);
  const missingValid = typeof missingUntil === "number" && missingUntil > now;
  const forceRefresh = cacheValid && !cache.keys.has(kid) && !missingValid;

  await loadJwks(cache, config, forceRefresh);

  const key = cache.keys.get(kid);
  if (key) {
    cache.missing.delete(kid);
    return key;
  }

  const afterLoadNow = Date.now();
  const refreshedValid = cache.expiresAt > afterLoadNow;
  if (refreshedValid) {
    cache.missing.set(kid, afterLoadNow + JWKS_CACHE_TTL_MS);
  const cachedKey = cache.keys.get(kid);
  if (cacheValid && cachedKey) {
    return cachedKey;
  }

  let forceRefresh = !cacheValid;
  if (!forceRefresh) {
    const nextAllowedRefresh = cache.missing.get(kid) ?? 0;
    forceRefresh = now >= nextAllowedRefresh;
  }

  await loadJwks(cache, config, forceRefresh);

  const refreshedKey = cache.keys.get(kid);
  if (refreshedKey) {
    cache.missing.delete(kid);
    return refreshedKey;
  }

  if (cache.expiresAt > now) {
    const nextAttempt = cache.expiresAt || now + JWKS_CACHE_TTL_MS;
    cache.missing.set(kid, nextAttempt);
  } else {
    cache.missing.delete(kid);
  }

  return undefined;
}

function getCache(url: string): KeyCache {
  let cache = keyCaches.get(url);
  if (!cache) {
    cache = { keys: new Map(), expiresAt: 0, inflight: null, missing: new Map() };
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

      if (jwksByKid.size > 0) {
        cache.jwks = jwksByKid;
      }

      if (imported.size > 0) {
        cache.keys = imported;
        cache.expiresAt = Date.now() + JWKS_CACHE_TTL_MS;
        for (const kid of imported.keys()) {
          cache.missing.delete(kid);
        }
        cache.missing.clear();
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

function getImportAlgorithm(jwk: AccessJwk): SupportedImportParams | null {
  if (jwk.kty === "RSA") {
    return { name: "RSASSA-PKCS1-v1_5", hash: { name: rsaHash(jwk.alg) } };
  }

  if (jwk.kty === "EC" && typeof jwk.crv === "string") {
    const curve = jwk.crv as EcNamedCurve;
    if (curve === "P-256" || curve === "P-384" || curve === "P-521") {
      return { name: "ECDSA", namedCurve: curve };
    }
  }

  return null;
}

function rsaHash(alg: string | undefined): HashName {
  switch (alg) {
    case "RS384":
      return "SHA-384";
    case "RS512":
      return "SHA-512";
    default:
      return "SHA-256";
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
  if (Array.isArray(aud)) return aud.includes(expected);
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

function rsaHashForAlgorithm(alg: string | undefined): HashName | null {
  switch (alg) {
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

function shouldReloadRsaKey(key: CryptoKey, expectedHash: HashName | null): boolean {
  if (!expectedHash) {
    return false;
  }

  const algorithm = key.algorithm as { name?: string; hash?: { name?: string } };
  if (algorithm.name !== "RSASSA-PKCS1-v1_5") {
    return false;
  }

  const actualHash = algorithm.hash?.name;
  return Boolean(actualHash && actualHash !== expectedHash);
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

}

async function getKey(
  kid: string,
  algorithm: AlgorithmDetails,
): Promise<CryptoKey | undefined> {
  if (cacheExpiresAt > Date.now() && cachedKeys.has(kid)) {
    return importCachedKey(kid, algorithm);
  }

  await loadJwks();
  return importCachedKey(kid, algorithm);
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

      const map = new Map<string, CachedKeyEntry>();
      await Promise.all(
        keys.map(async (jwk) => {
          if (!jwk.kid) return;

          if (!isSupportedJwk(jwk)) return;

          map.set(jwk.kid, { jwk });
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

async function importCachedKey(
  kid: string,
  algorithm: AlgorithmDetails,
): Promise<CryptoKey | undefined> {
  const entry = cachedKeys.get(kid);
  if (!entry) return undefined;

  if (algorithm.type === "RSA") {
    if (!entry.rsaKeys) {
      entry.rsaKeys = new Map();
    }

    const existing = entry.rsaKeys.get(algorithm.hash);
    if (existing) {
      return existing;
    }

    const importParams: SupportedImportParams = {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: algorithm.hash },
    };

    try {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        entry.jwk,
        importParams,
        false,
        ["verify"],
      );
      entry.rsaKeys.set(algorithm.hash, cryptoKey);
      return cryptoKey;
    } catch (error) {
      console.error("failed to import rsa jwk", kid, error);
      return undefined;
    }
  }

  if (algorithm.type === "EC") {
    if (entry.ecKey) {
      return entry.ecKey;
    }

    const importParams = getEcImportAlgorithm(entry.jwk);
    if (!importParams) return undefined;

    try {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        entry.jwk,
        importParams,
        false,
        ["verify"],
      );
      entry.ecKey = cryptoKey;
      return cryptoKey;
    } catch (error) {
      console.error("failed to import ec jwk", kid, error);
      return undefined;
    }
  }

  return undefined;
}

function isSupportedJwk(jwk: AccessJwk): boolean {
  if (jwk.kty === "RSA") {
    return true;
  }

  return getEcImportAlgorithm(jwk) !== null;
}

function getEcImportAlgorithm(jwk: AccessJwk): SupportedImportParams | null {
  if (jwk.kty !== "EC" || typeof jwk.crv !== "string") {
    return null;
  }

  const curve = jwk.crv as EcNamedCurve;
  if (curve === "P-256" || curve === "P-384" || curve === "P-521") {
    return { name: "ECDSA", namedCurve: curve };
  }

  return null;
}

function getVerifyParams(algorithm: AlgorithmDetails): VerifyParams {
  if (algorithm.type === "RSA") {
    return { name: "RSASSA-PKCS1-v1_5" };
  }

  return { name: "ECDSA", hash: { name: algorithm.hash } };
}

function getAlgorithmDetails(alg: string | undefined): AlgorithmDetails | null {
  switch (alg) {
    case "RS256":
      return { type: "RSA", hash: "SHA-256" };
    case "RS384":
      return { type: "RSA", hash: "SHA-384" };
    case "RS512":
      return { type: "RSA", hash: "SHA-512" };
    case "ES256":
      return { type: "EC", hash: "SHA-256" };
    case "ES384":
      return { type: "EC", hash: "SHA-384" };
    case "ES512":
      return { type: "EC", hash: "SHA-512" };
    default:
      return null;
  }
}

function decodeSection<T>(section: string): T {
  const bytes = base64UrlToUint8Array(section);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
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

function joseToDerSignature(signature: Uint8Array): Uint8Array {
  if (signature.length % 2 !== 0) {
    throw new Error("invalid ECDSA signature length");
  }

  const half = signature.length / 2;
  const r = trimInteger(signature.subarray(0, half));
  const s = trimInteger(signature.subarray(half));

  const encodedR = ensurePositiveInteger(r);
  const encodedS = ensurePositiveInteger(s);

  const sequenceLength = 2 + encodedR.length + 2 + encodedS.length;
  const lengthBytes = encodeLength(sequenceLength);
  const totalLength = 1 + lengthBytes.length + sequenceLength;

  const der = new Uint8Array(totalLength);
  let offset = 0;
  der[offset++] = 0x30;
  der.set(lengthBytes, offset);
  offset += lengthBytes.length;
  der[offset++] = 0x02;
  der[offset++] = encodedR.length;
  der.set(encodedR, offset);
  offset += encodedR.length;
  der[offset++] = 0x02;
  der[offset++] = encodedS.length;
  der.set(encodedS, offset);

  return der;
}

function trimInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start += 1;
  }

  return bytes.subarray(start);
}

function ensurePositiveInteger(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) {
    return new Uint8Array([0]);
  }

  if (bytes[0] & 0x80) {
    const prefixed = new Uint8Array(bytes.length + 1);
    prefixed[0] = 0x00;
    prefixed.set(bytes, 1);
    return prefixed;
  }

  return bytes;
}

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) {
    return Uint8Array.of(length);
  }

  if (length < 0x100) {
    return Uint8Array.of(0x81, length);
  }

  return Uint8Array.of(0x82, (length >> 8) & 0xff, length & 0xff);
}

function decodeSignature(
  segment: string,
  verifyParams: VerifyParams,
): Uint8Array | null {
  try {
    const rawSignature = base64UrlToUint8Array(segment);
    if (verifyParams.name === "ECDSA") {
      return joseToDerSignature(rawSignature);
    }

    return rawSignature;
  } catch (error) {
    console.error("invalid access token signature", error);
    return null;
  }
}

function rsaHash(alg: string | undefined): HashName {
  switch (alg) {
    case "RS384":
      return "SHA-384";
    case "RS512":
      return "SHA-512";
    default:
      return "SHA-256";
  }
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }

  return end === value.length ? value : value.slice(0, end);
}

export default requireAccess;

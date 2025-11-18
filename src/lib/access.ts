import { normalizeEcdsaSignature, type EcNamedCurve } from "./ecdsa";

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
type AccessAlgorithm = "RS256" | "RS384" | "RS512" | "ES256" | "ES384" | "ES512";
type RsaAlgorithm = "RS256" | "RS384" | "RS512";
type EcAlgorithm = "ES256" | "ES384" | "ES512";

type SupportedImportParams =
  | { name: "RSASSA-PKCS1-v1_5"; hash: { name: HashName } }
  | { name: "ECDSA"; namedCurve: EcNamedCurve };

type VerifyParams =
  | { name: "RSASSA-PKCS1-v1_5" }
  | { name: "ECDSA"; hash: { name: HashName } };

type AccessJwk = JsonWebKey & { kid?: string; kty?: string; crv?: string };

type KeyCache = {
  keys: Map<string, CryptoKey>;
  jwks: Map<string, AccessJwk>;
  expiresAt: number;
  inflight: Promise<void> | null;
  missing: Map<string, number>;
};

const ALLOWED_ALGORITHMS = new Set<AccessAlgorithm>(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]);
const RSA_HASH_ALGORITHMS: Record<RsaAlgorithm, HashName> = {
  RS256: "SHA-256",
  RS384: "SHA-384",
  RS512: "SHA-512",
};
const EC_HASH_ALGORITHMS: Record<EcAlgorithm, HashName> = {
  ES256: "SHA-256",
  ES384: "SHA-384",
  ES512: "SHA-512",
};
const CURVE_TO_ALGORITHM: Record<EcNamedCurve, EcAlgorithm> = {
  "P-256": "ES256",
  "P-384": "ES384",
  "P-521": "ES512",
};

const keyCaches = new Map<string, KeyCache>();

export async function requireAccess(req: Request, env?: AccessEnvironment): Promise<boolean> {
  const token = getAccessAssertion(req);
  if (!token) {
    return false;
  }

  const config = resolveConfig(env);
  return verifyToken(token, config);
}

async function verifyToken(token: string, config: AccessConfig): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  let header: AccessHeader;
  let payload: AccessPayload;
  try {
    header = decodeSection<AccessHeader>(parts[0]);
    payload = decodeSection<AccessPayload>(parts[1]);
  } catch (error) {
    console.error("invalid access token data", error);
    return false;
  }

  if (!header?.kid) {
    return false;
  }

  const algorithm = normalizeAlgorithm(header.alg);
  if (!algorithm) {
    return false;
  }

  if (!payload || !isAudienceValid(payload.aud, config.audience)) {
    return false;
  }
  if (!payload.exp || payload.exp * 1000 <= Date.now()) {
    return false;
  }
  if (!payload.iss || normalizeIssuer(payload.iss) !== config.issuer) {
    return false;
  }

  const signature = safeBase64UrlDecode(parts[2]);
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

  const verifyParams = getVerifyParams(algorithm);
  if (!verifyParams) {
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

async function getKey(kid: string, algorithm: AccessAlgorithm, config: AccessConfig): Promise<CryptoKey | undefined> {
  const cache = getCache(config.jwksUrl);
  const cacheKey = getCacheKey(kid, algorithm);
  const fallbackKey = getCacheKey(kid);
  const now = Date.now();

  if (cache.expiresAt > now) {
    const cached = cache.keys.get(cacheKey) ?? cache.keys.get(fallbackKey);
    if (cached) {
      return cached;
    }
  }

  const missingUntil = cache.missing.get(cacheKey);
  const missingValid = typeof missingUntil === "number" && missingUntil > now;
  const shouldForceReload = cache.expiresAt <= now || (!cache.keys.has(cacheKey) && !missingValid);

  await loadJwks(cache, config, shouldForceReload);

  let key = cache.keys.get(cacheKey) ?? cache.keys.get(fallbackKey);
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

  const importParams = getImportAlgorithmForAlg(jwk, algorithm);
  if (!importParams) {
    cache.missing.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    return undefined;
  }

  try {
    key = await crypto.subtle.importKey("jwk", jwk, importParams, false, ["verify"]);
  } catch (error) {
    console.error("failed to import jwk", `${kid}:${algorithm}`, error);
    cache.missing.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    return undefined;
  }

  cache.keys.set(cacheKey, key);
  if (algorithm.startsWith("ES")) {
    cache.keys.set(fallbackKey, key);
  }
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
      for (const jwk of keys) {
        if (jwk.kid) {
          jwksByKid.set(jwk.kid, jwk);
        }
      }

      cache.jwks = jwksByKid;
      cache.expiresAt = Date.now() + JWKS_CACHE_TTL_MS;
      cache.missing.clear();

      const validKids = new Set(jwksByKid.keys());
      for (const keyId of Array.from(cache.keys.keys())) {
        const kid = keyId.split(":")[0];
        if (!validKids.has(kid)) {
          cache.keys.delete(keyId);
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

function resolveConfig(env?: AccessEnvironment): AccessConfig {
  const audience = env?.ACCESS_AUDIENCE?.trim() || DEFAULT_ACCESS_AUDIENCE;
  const issuer = normalizeIssuer(env?.ACCESS_ISSUER || DEFAULT_ACCESS_ISSUER);
  const jwksUrl = (env?.ACCESS_JWKS_URL && env.ACCESS_JWKS_URL.trim()) || `${issuer}${JWKS_PATH}`;

  return { audience, issuer, jwksUrl };
}

function getAccessAssertion(req: Request): string | null {
  const token = req.headers.get("CF-Access-Jwt-Assertion");
  if (!token) {
    return null;
  }
  const trimmed = token.trim();
  return trimmed ? trimmed : null;
}

function normalizeAlgorithm(alg?: string | null): AccessAlgorithm | null {
  if (!alg) {
    return null;
  }

  const upper = alg.toUpperCase();
  return ALLOWED_ALGORITHMS.has(upper as AccessAlgorithm) ? (upper as AccessAlgorithm) : null;
}

function getVerifyParams(algorithm: AccessAlgorithm): VerifyParams | null {
  if (algorithm.startsWith("RS")) {
    return { name: "RSASSA-PKCS1-v1_5" };
  }

  const hash = EC_HASH_ALGORITHMS[algorithm as EcAlgorithm];
  return hash ? { name: "ECDSA", hash: { name: hash } } : null;
}

function normalizeSignature(signature: Uint8Array, key: CryptoKey, verifyParams: VerifyParams): Uint8Array | null {
  if (verifyParams.name !== "ECDSA") {
    return signature;
  }

  return normalizeEcdsaSignature(signature, key);
}

function getImportAlgorithmForAlg(jwk: AccessJwk, algorithm: AccessAlgorithm): SupportedImportParams | null {
  if (jwk.kty === "RSA" && algorithm.startsWith("RS")) {
    const hash = RSA_HASH_ALGORITHMS[algorithm as RsaAlgorithm];
    return hash ? { name: "RSASSA-PKCS1-v1_5", hash: { name: hash } } : null;
  }

  if (jwk.kty === "EC" && algorithm.startsWith("ES") && typeof jwk.crv === "string") {
    const curve = jwk.crv as EcNamedCurve;
    const expectedAlgorithm = CURVE_TO_ALGORITHM[curve];
    if (!expectedAlgorithm || expectedAlgorithm !== algorithm) {
      return null;
    }
    return { name: "ECDSA", namedCurve: curve };
  }

  return null;
}

function getCacheKey(kid: string, algorithm?: AccessAlgorithm): string {
  return algorithm ? `${kid}:${algorithm}` : kid;
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

function decodeSection<T>(section: string): T {
  const json = new TextDecoder().decode(base64UrlToUint8Array(section));
  return JSON.parse(json) as T;
}

function safeBase64UrlDecode(value: string): Uint8Array | null {
  try {
    return base64UrlToUint8Array(value);
  } catch (error) {
    console.error("invalid access token signature", error);
    return null;
  }
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

function normalizeIssuer(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

export default requireAccess;

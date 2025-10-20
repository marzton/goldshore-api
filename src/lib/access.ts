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
  expiresAt: number;
  inflight: Promise<void> | null;
  missingKids: Map<string, number>;
};

const ALLOWED_ALGORITHMS = new Set(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]);
const keyCaches = new Map<string, KeyCache>();
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;

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
    key = await getKey(header.kid, config);
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
    return await crypto.subtle.verify(verifyParams, key, signature, data);
  } catch (error) {
    console.error("access token verification failed", error);
    return false;
  }
}

async function getKey(kid: string, config: AccessConfig): Promise<CryptoKey | undefined> {
  const cache = getCache(config.jwksUrl);
  const now = Date.now();

  if (cache.expiresAt > now && cache.keys.has(kid)) {
    return cache.keys.get(kid);
  }

  const hasKey = cache.keys.has(kid);
  const lastMiss = cache.missingKids.get(kid) ?? 0;
  const isNegativeStale = now - lastMiss >= NEGATIVE_CACHE_TTL_MS;
  const shouldForceReload = !hasKey && (cache.expiresAt <= now || isNegativeStale);

  if (shouldForceReload) {
    await loadJwks(cache, config, true);
  } else {
    await loadJwks(cache, config);
  }

  const key = cache.keys.get(kid);

  if (key) {
    cache.missingKids.delete(kid);
  } else if (!hasKey) {
    if (lastMiss === 0) {
      cache.missingKids.set(kid, now);
    } else if (isNegativeStale) {
      cache.missingKids.set(kid, Date.now());
    }
  }

  return key;
}

function getCache(url: string): KeyCache {
  let cache = keyCaches.get(url);
  if (!cache) {
    cache = { keys: new Map(), expiresAt: 0, inflight: null, missingKids: new Map() };
    keyCaches.set(url, cache);
  }
  return cache;
}

async function loadJwks(cache: KeyCache, config: AccessConfig, forceReload = false): Promise<void> {
  if (!forceReload && cache.expiresAt > Date.now() && cache.keys.size > 0) {
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

      await Promise.all(
        keys.map(async (jwk) => {
          if (!jwk.kid) return;

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
        cache.expiresAt = Date.now() + JWKS_CACHE_TTL_MS;
        cache.missingKids.clear();
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
    const hashName = rsaHashFromAlg(jwk.alg);
    return { name: "RSASSA-PKCS1-v1_5", hash: { name: hashName ?? "SHA-256" } };
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

function rsaHashFromAlg(alg?: string): HashName | null {
  if (!alg) return null;

  switch (alg.toUpperCase()) {
    case "RS384":
      return "SHA-384";
    case "RS512":
      return "SHA-512";
    case "RS256":
      return "SHA-256";
    default:
      return null;
  }
}

function normalizeIssuer(value: string): string {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }

  return end === value.length ? value : value.slice(0, end);
}

export default requireAccess;

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

type AccessJwk = JsonWebKey & { kid?: string; kty?: string; crv?: string; alg?: string };

type SupportedImportParams =
  | { name: "RSASSA-PKCS1-v1_5"; hash: { name: HashName } }
  | { name: "ECDSA"; namedCurve: EcNamedCurve };

type VerifyParams =
  | { name: "RSASSA-PKCS1-v1_5" }
  | { name: "ECDSA"; hash: { name: HashName } };

type AlgorithmDetails =
  | { type: "RSA"; hash: HashName }
  | { type: "EC"; hash: HashName };

const ALLOWED_ALGORITHMS = new Set(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]);

type CachedKeyEntry = {
  jwk: AccessJwk;
  rsaKeys?: Map<HashName, CryptoKey>;
  ecKey?: CryptoKey;
};

let cachedKeys: Map<string, CachedKeyEntry> = new Map();
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

  if (!header.alg) return false;

  if (!payload || !isAudienceValid(payload.aud)) return false;
  if (!payload.exp || payload.exp * 1000 <= Date.now()) return false;
  if (payload.iss !== ACCESS_ISSUER) return false;

  const algorithmDetails = getAlgorithmDetails(header.alg);
  if (!algorithmDetails) return false;

  let key: CryptoKey | undefined;
  try {
    key = await getKey(header.kid, algorithmDetails);
  } catch (error) {
    console.error("failed to load access signing keys", error);
    return false;
  }

  if (!key) return false;

  const encoder = new TextEncoder();
  const data = encoder.encode(`${parts[0]}.${parts[1]}`);
  const verifyParams = getVerifyParams(algorithmDetails);

  let signature: Uint8Array;
  try {
    const rawSignature = base64UrlToUint8Array(parts[2]);
    signature =
      verifyParams.name === "ECDSA"
        ? joseToDerSignature(rawSignature)
        : rawSignature;
  } catch (error) {
    console.error("failed to normalize ecdsa signature", error);
    return false;
  }

  try {
    const rawSignature = base64UrlToUint8Array(parts[2]);
    const signature =
      verifyParams.name === "ECDSA" ? joseToDerSignature(rawSignature) : rawSignature;

    return await crypto.subtle.verify(verifyParams, key, signature, data);
  } catch (error) {
    console.error("access token verification failed", error);
    return false;
  }
}

async function getKey(kid: string, algorithm: AlgorithmDetails): Promise<CryptoKey | undefined> {
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

async function importCachedKey(kid: string, algorithm: AlgorithmDetails): Promise<CryptoKey | undefined> {
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
      const cryptoKey = await crypto.subtle.importKey("jwk", entry.jwk, importParams, false, ["verify"]);
      entry.rsaKeys.set(algorithm.hash, cryptoKey);
      return cryptoKey;
    } catch (error) {
      console.error("failed to import rsa jwk", kid, error);
      return undefined;
    }
function getImportAlgorithm(jwk: AccessJwk): SupportedImportParams | null {
  if (jwk.kty === "RSA") {
    return { name: "RSASSA-PKCS1-v1_5", hash: { name: rsaHash(jwk.alg) } };
  }

  if (algorithm.type === "EC") {
    if (entry.ecKey) {
      return entry.ecKey;
    }

    const importParams = getEcImportAlgorithm(entry.jwk);
    if (!importParams) return undefined;

    try {
      const cryptoKey = await crypto.subtle.importKey("jwk", entry.jwk, importParams, false, ["verify"]);
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

export default requireAccess;

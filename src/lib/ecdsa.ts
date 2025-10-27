export type EcNamedCurve = "P-256" | "P-384" | "P-521";

export function normalizeEcdsaSignature(signature: Uint8Array, key: CryptoKey): Uint8Array | null {
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


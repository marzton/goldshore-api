export const DEFAULT_SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const coerceToDate = (
  value: string | number | Date | null | undefined,
): Date | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }

    return new Date(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const parsed = Date.parse(trimmed);

    if (Number.isNaN(parsed)) {
      return null;
    }

    return new Date(parsed);
  }

  return null;
};

export const ensureSubscriptionEndsAt = (
  value: string | number | Date | null | undefined,
  now = Date.now(),
) => {
  if (value === null || value === undefined || value === "") {
    return new Date(now + DEFAULT_SUBSCRIPTION_DURATION_MS).toISOString();
  }

  const date = coerceToDate(value);

  if (!date) {
    throw new Error("Invalid subscription end date");
  }

  return date.toISOString();
};

export const hasSubscriptionExpired = (
  value: string | number | Date | null | undefined,
  now = Date.now(),
) => {
  const date = coerceToDate(value);

  if (!date) {
    return false;
  }

  return date.getTime() <= now;
};

export const normalizeSubscriptionEndsAt = (
  value: string | number | Date | null | undefined,
) => {
  const date = coerceToDate(value);

  return date ? date.toISOString() : null;
};

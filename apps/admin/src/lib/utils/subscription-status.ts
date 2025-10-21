const normalizeNumeric = (value: unknown): number | null => {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }

  return null;
};

export const parseSubscriptionEndsAt = (
  rawEndsAt: unknown,
): number | null => {
  const numeric = normalizeNumeric(rawEndsAt);
  if (numeric !== null) {
    return numeric;
  }

  if (rawEndsAt instanceof Date) {
    const timestamp = rawEndsAt.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  if (rawEndsAt == null) {
    return null;
  }

  const parsedDate = new Date(rawEndsAt as string);
  const timestamp = parsedDate.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const deriveSubscriptionStatus = (
  currentStatus: string,
  rawEndsAt: unknown,
): string => {
  const endsAt = parseSubscriptionEndsAt(rawEndsAt);
  if (endsAt !== null && endsAt <= Date.now()) {
    return "expired";
  }

  return currentStatus;
};

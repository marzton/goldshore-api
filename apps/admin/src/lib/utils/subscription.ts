const DIGIT_ONLY_REGEX = /^\d+$/;

const normalizeDateInput = (
  input?: string | number | Date | null,
): number | null => {
  if (!input && input !== 0) {
    return null;
  }

  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }

  if (input instanceof Date) {
    return Number.isFinite(input.getTime()) ? input.getTime() : null;
  }

  if (typeof input === "string") {
    if (DIGIT_ONLY_REGEX.test(input)) {
      const numericValue = Number(input);
      return Number.isFinite(numericValue) ? numericValue : null;
    }

    const parsed = Date.parse(input);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

export const deriveSubscriptionStatus = (
  status: string | null | undefined,
  subscriptionEndsAt?: string | number | Date | null,
) => {
  const endsAt = normalizeDateInput(subscriptionEndsAt);

  if (endsAt !== null && endsAt <= Date.now()) {
    return "expired";
  }

  return status ?? "unknown";
};

export const resolveSubscriptionEndsAt = (
  subscriptionEndsAt?: string | number | Date | null,
): number | null => normalizeDateInput(subscriptionEndsAt);

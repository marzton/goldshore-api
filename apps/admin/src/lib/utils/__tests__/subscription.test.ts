import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBSCRIPTION_DURATION_MS,
  ensureSubscriptionEndsAt,
  hasSubscriptionExpired,
  normalizeSubscriptionEndsAt,
} from "../subscription";

describe("subscription utilities", () => {
  describe("ensureSubscriptionEndsAt", () => {
    it("returns a default expiration 30 days in the future when not provided", () => {
      const now = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
      const result = ensureSubscriptionEndsAt(undefined, now);
      const expected = new Date(now + DEFAULT_SUBSCRIPTION_DURATION_MS).toISOString();

      expect(result).toEqual(expected);
    });

    it("normalizes numeric timestamps", () => {
      const timestamp = Date.UTC(2024, 0, 10, 10, 0, 0, 0);

      expect(ensureSubscriptionEndsAt(timestamp)).toEqual(
        new Date(timestamp).toISOString(),
      );
    });

    it("throws for invalid timestamps", () => {
      expect(() => ensureSubscriptionEndsAt("not-a-date")).toThrow(
        /invalid subscription end date/i,
      );
    });
  });

  describe("hasSubscriptionExpired", () => {
    it("returns true when the subscription ended before the reference time", () => {
      const now = Date.UTC(2024, 0, 5);
      const endsAt = new Date(Date.UTC(2024, 0, 1)).toISOString();

      expect(hasSubscriptionExpired(endsAt, now)).toBe(true);
    });

    it("returns false when the subscription ends in the future", () => {
      const now = Date.UTC(2024, 0, 5);
      const endsAt = new Date(Date.UTC(2024, 0, 6)).toISOString();

      expect(hasSubscriptionExpired(endsAt, now)).toBe(false);
    });

    it("returns false when the end date cannot be parsed", () => {
      expect(hasSubscriptionExpired("invalid")).toBe(false);
    });
  });

  describe("normalizeSubscriptionEndsAt", () => {
    it("returns an ISO string when provided a parsable date string", () => {
      const endsAt = "2024-01-10 10:00:00";

      expect(normalizeSubscriptionEndsAt(endsAt)).toEqual(
        new Date(Date.parse(endsAt)).toISOString(),
      );
    });

    it("returns null when no value is provided", () => {
      expect(normalizeSubscriptionEndsAt(null)).toBeNull();
    });
  });
});

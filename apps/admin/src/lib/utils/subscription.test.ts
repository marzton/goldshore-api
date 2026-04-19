import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  deriveSubscriptionStatus,
  resolveSubscriptionEndsAt,
} from "./subscription";

const REAL_DATE_NOW = Date.now;

describe("subscription utils", () => {
  const fixedNow = 1_700_000_000_000;

  beforeEach(() => {
    Date.now = () => fixedNow;
  });

  afterEach(() => {
    Date.now = REAL_DATE_NOW;
  });

  it("returns expired when end date is before now", () => {
    const status = deriveSubscriptionStatus("active", fixedNow - 1_000);

    assert.equal(status, "expired");
  });

  it("preserves original status when end date is in the future", () => {
    const status = deriveSubscriptionStatus("active", fixedNow + 1_000);

    assert.equal(status, "active");
  });

  it("falls back to unknown when status missing", () => {
    const status = deriveSubscriptionStatus(undefined, fixedNow + 1_000);

    assert.equal(status, "unknown");
  });

  it("normalizes numeric strings and ISO dates", () => {
    const numeric = resolveSubscriptionEndsAt(String(fixedNow + 10_000));
    const iso = resolveSubscriptionEndsAt(new Date(fixedNow + 20_000).toISOString());

    assert.equal(numeric, fixedNow + 10_000);
    assert.equal(iso, fixedNow + 20_000);
  });

  it("returns null for invalid values", () => {
    assert.equal(resolveSubscriptionEndsAt("not-a-date"), null);
    assert.equal(resolveSubscriptionEndsAt(null), null);
  });
});

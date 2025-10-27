import { describe, expect, it } from "vitest";
import { normalizeCustomerPayload, normalizeSubscriptionPayload } from "./admin";

describe("normalizeCustomerPayload", () => {
  it("normalizes valid payload", () => {
    const payload = normalizeCustomerPayload({
      name: "  Jane Doe  ",
      email: "JANE@EXAMPLE.COM",
      notes: "  VIP  "
    });
    expect(payload).toEqual({
      name: "Jane Doe",
      email: "jane@example.com",
      notes: "VIP"
    });
  });

  it("rejects payload without email", () => {
    expect(normalizeCustomerPayload({ name: "Test" })).toBeNull();
  });
});

describe("normalizeSubscriptionPayload", () => {
  it("normalizes valid payload with features", () => {
    const payload = normalizeSubscriptionPayload({
      name: " Core ",
      description: " Base tier ",
      price: 1999,
      features: [
        { name: " Feature A ", description: " Desc " },
        { name: "Feature B" }
      ]
    });
    expect(payload).toEqual({
      name: "Core",
      description: "Base tier",
      price: 1999,
      features: [
        { name: "Feature A", description: "Desc" },
        { name: "Feature B", description: null }
      ]
    });
  });

  it("rejects invalid features array", () => {
    expect(
      normalizeSubscriptionPayload({
        name: "Pro",
        description: "Plan",
        price: 999,
        features: "invalid"
      })
    ).toBeNull();
  });
});

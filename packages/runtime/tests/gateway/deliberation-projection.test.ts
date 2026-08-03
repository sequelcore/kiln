import { describe, expect, it } from "vitest";
import { toCoreDeliberationIntent } from "../../src/gateway/deliberation-projection.js";

describe("deliberation projection", () => {
  it("rejects malformed fixed intent before creating a portable level id", () => {
    expect(() => toCoreDeliberationIntent({ mode: "fixed", onUnsupported: "deny" }))
      .toThrow("requires a preferred level string");
  });

  it("rejects malformed bounds and unknown fields", () => {
    expect(() => toCoreDeliberationIntent({
      mode: "adaptive",
      target: "balanced",
      bounds: "high",
      onUnsupported: "deny",
    })).toThrow("bounds must be an object");
    expect(() => toCoreDeliberationIntent({
      mode: "provider-default",
      onUnsupported: "omit",
      level: "high",
    })).toThrow("Unknown deliberation intent field");
  });
});

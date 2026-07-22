import { describe, expect, it } from "vitest";
import { createProviderUsageSnapshot } from "../../src/agents/provider-usage.js";

const OBSERVED_AT = "2026-07-22T12:00:00.000Z";
const VALID_UNTIL = "2026-07-22T12:05:00.000Z";

describe("provider usage snapshot", () => {
  it("validates and snapshots provider-neutral quota evidence", () => {
    const snapshot = createProviderUsageSnapshot({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      plan: "plus",
      primary: { usedPercent: 25.5, resetsAt: "2026-07-22T17:00:00.000Z" },
      secondary: { usedPercent: 80, resetsAt: "2026-07-29T12:00:00.000Z" },
      availability: "available",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      source: "provider-endpoint",
      confidence: "authoritative",
    });

    expect(snapshot).toEqual({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      plan: "plus",
      primary: { usedPercent: 25.5, resetsAt: "2026-07-22T17:00:00.000Z" },
      secondary: { usedPercent: 80, resetsAt: "2026-07-29T12:00:00.000Z" },
      availability: "available",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      source: "provider-endpoint",
      confidence: "authoritative",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.primary)).toBe(true);
  });

  it.each([
    { field: "provider", value: "" },
    { field: "credentialId", value: " " },
    { field: "primary.usedPercent", value: -1 },
    { field: "secondary.usedPercent", value: 101 },
  ])("rejects invalid $field", ({ field, value }) => {
    const input: any = {
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      primary: { usedPercent: 10 },
      secondary: { usedPercent: 20 },
      availability: "available",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      source: "provider-endpoint",
      confidence: "authoritative",
    };
    const path = field.split(".");
    if (path.length === 1) input[path[0]!] = value;
    else input[path[0]!]![path[1]!] = value;
    expect(() => createProviderUsageSnapshot(input)).toThrow();
  });

  it("rejects freshness windows that precede observation", () => {
    expect(() => createProviderUsageSnapshot({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      availability: "unknown",
      observedAt: OBSERVED_AT,
      validUntil: "2026-07-22T11:59:59.000Z",
      source: "unknown",
      confidence: "unknown",
    })).toThrow(/validUntil/);
  });
});

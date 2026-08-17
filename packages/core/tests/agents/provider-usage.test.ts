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
      primary: { bucketId: "primary", usedPercent: 25.5, windowDurationMinutes: 300, resetsAt: "2026-07-22T17:00:00.000Z" },
      secondary: { bucketId: "secondary", usedPercent: 80, windowDurationMinutes: 10_080, resetsAt: "2026-07-29T12:00:00.000Z" },
      credits: {
        status: "available",
        balance: {
          atoms: "175",
          scale: 1,
          unit: "credit",
          scheme: { kind: "credit", creditSchemeId: "codex-oauth" },
        },
      },
      spendControl: {
        status: "available",
        limit: { atoms: "25000", scale: 0, unit: "provider-spend-unit", scheme: { kind: "unit" } },
        used: { atoms: "8000", scale: 0, unit: "provider-spend-unit", scheme: { kind: "unit" } },
        remainingPercent: 68,
        resetsAt: "2026-07-22T13:00:00.000Z",
      },
      exhaustionReason: null,
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
      primary: { bucketId: "primary", usedPercent: 25.5, windowDurationMinutes: 300, resetsAt: "2026-07-22T17:00:00.000Z" },
      secondary: { bucketId: "secondary", usedPercent: 80, windowDurationMinutes: 10_080, resetsAt: "2026-07-29T12:00:00.000Z" },
      credits: {
        status: "available",
        balance: {
          atoms: "175",
          scale: 1,
          unit: "credit",
          scheme: { kind: "credit", creditSchemeId: "codex-oauth" },
        },
      },
      spendControl: {
        status: "available",
        limit: { atoms: "25000", scale: 0, unit: "provider-spend-unit", scheme: { kind: "unit" } },
        used: { atoms: "8000", scale: 0, unit: "provider-spend-unit", scheme: { kind: "unit" } },
        remainingPercent: 68,
        resetsAt: "2026-07-22T13:00:00.000Z",
      },
      exhaustionReason: null,
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
      primary: { bucketId: "primary", usedPercent: 10 },
      secondary: { bucketId: "secondary", usedPercent: 20 },
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
      exhaustionReason: null,
    })).toThrow(/validUntil/);
  });

  it("rejects floating-point credit balances at the sanitized boundary", () => {
    expect(() => createProviderUsageSnapshot({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      credits: {
        status: "available",
        balance: 17.5,
      },
      exhaustionReason: null,
      availability: "available",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      source: "provider-endpoint",
      confidence: "authoritative",
    } as never)).toThrow(/credits\.balance/);
  });
});

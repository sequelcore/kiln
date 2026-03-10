import { describe, expect, it } from "vitest";
import { validateTenantConfig } from "../../../src/engine/gateway/tenant-config.js";
import type { TenantConfig } from "../../../src/engine/gateway/tenant-config.js";

function baseTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "test-tenant",
    appName: "test-app",
    name: "Test Tenant",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateTenantConfig — integrations", () => {
  it("accepts valid integrations array", () => {
    const config = baseTenant({
      integrations: [
        { provider: "google_calendar", credentialKey: "gc-cred-123" },
        { provider: "stripe", credentialKey: "stripe-cred-456", operations: ["create_payment_link"] },
      ],
    });
    expect(validateTenantConfig(config)).toEqual([]);
  });

  it("accepts undefined integrations (backward compat)", () => {
    expect(validateTenantConfig(baseTenant())).toEqual([]);
  });

  it("rejects non-array integrations", () => {
    const config = baseTenant({ integrations: "bad" as unknown as never });
    const errors = validateTenantConfig(config);
    expect(errors).toContainEqual({ field: "integrations", message: "must be an array of integration definitions" });
  });

  it("rejects empty provider string", () => {
    const config = baseTenant({
      integrations: [{ provider: "", credentialKey: "key" }],
    });
    const errors = validateTenantConfig(config);
    expect(errors).toContainEqual({ field: "integrations[0].provider", message: "must be a non-empty string" });
  });

  it("rejects empty credentialKey string", () => {
    const config = baseTenant({
      integrations: [{ provider: "stripe", credentialKey: "" }],
    });
    const errors = validateTenantConfig(config);
    expect(errors).toContainEqual({ field: "integrations[0].credentialKey", message: "must be a non-empty string" });
  });

  it("rejects duplicate provider names", () => {
    const config = baseTenant({
      integrations: [
        { provider: "stripe", credentialKey: "key1" },
        { provider: "stripe", credentialKey: "key2" },
      ],
    });
    const errors = validateTenantConfig(config);
    expect(errors).toContainEqual({
      field: "integrations[1].provider",
      message: 'duplicate integration provider: "stripe"',
    });
  });

  it("validates operations sub-array", () => {
    const config = baseTenant({
      integrations: [{ provider: "cal", credentialKey: "k", operations: ["valid", "", 42 as unknown as string] }],
    });
    const errors = validateTenantConfig(config);
    expect(errors).toContainEqual({ field: "integrations[0].operations[1]", message: "must be a non-empty string" });
    expect(errors).toContainEqual({ field: "integrations[0].operations[2]", message: "must be a non-empty string" });
  });

  it("rejects non-array operations", () => {
    const config = baseTenant({
      integrations: [{ provider: "cal", credentialKey: "k", operations: "bad" as unknown as never }],
    });
    const errors = validateTenantConfig(config);
    expect(errors).toContainEqual({ field: "integrations[0].operations", message: "must be an array of operation name strings" });
  });

  it("accepts integrations with optional config", () => {
    const config = baseTenant({
      integrations: [{ provider: "sheets", credentialKey: "k", config: { spreadsheetId: "abc" } }],
    });
    expect(validateTenantConfig(config)).toEqual([]);
  });
});

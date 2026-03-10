import { describe, it, expect } from "vitest";
import type { TenantConfig } from "../../../src/engine/gateway/tenant-config.js";
import { validateTenantConfig } from "../../../src/engine/gateway/tenant-config.js";

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "salon-maria",
    appName: "atendia",
    name: "Salon Maria",
    enabled: true,
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

describe("TenantConfig", () => {
  describe("validateTenantConfig", () => {
    it("returns empty array for a valid config", () => {
      expect(validateTenantConfig(makeTenantConfig())).toEqual([]);
    });

    it("returns empty array for a fully-populated config", () => {
      const config = makeTenantConfig({
        description: "Premium hair salon",
        services: [
          { name: "Corte", description: "Haircut", price: "$150", duration: "30 min" },
        ],
        hours: { lun: "09:00-18:00", mar: "09:00-18:00" },
        faqEntries: [{ q: "Do you accept cards?", r: "Yes" }],
        escalationContact: { name: "Maria", phone: "+521234567890" },
        tone: "friendly",
        language: "es-MX",
        whatsappPhoneNumberId: "123456789",
        whatsappAccessToken: "WA_ACCESS_TOKEN",
        whatsappVerifyToken: "WA_VERIFY_TOKEN",
        billing: {
          budgetEndpoint: "https://api.example.com/budget",
          usageEndpoint: "https://api.example.com/usage",
          overBudgetMessage: "Limit reached",
        },
        idleTimeoutMs: 60000,
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("reports error for missing tenantId", () => {
      const config = makeTenantConfig({ tenantId: "" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "tenantId")).toBe(true);
    });

    it("reports error for tenantId with uppercase chars", () => {
      const config = makeTenantConfig({ tenantId: "Salon-Maria" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "tenantId")).toBe(true);
    });

    it("reports error for tenantId with spaces", () => {
      const config = makeTenantConfig({ tenantId: "salon maria" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "tenantId")).toBe(true);
    });

    it("reports error for tenantId too short (1 char)", () => {
      const config = makeTenantConfig({ tenantId: "a" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "tenantId")).toBe(true);
    });

    it("accepts tenantId with exactly 2 chars", () => {
      const config = makeTenantConfig({ tenantId: "ab" });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("reports error for tenantId with leading hyphen", () => {
      const config = makeTenantConfig({ tenantId: "-salon" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "tenantId")).toBe(true);
    });

    it("reports error for tenantId with trailing hyphen", () => {
      const config = makeTenantConfig({ tenantId: "salon-" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "tenantId")).toBe(true);
    });

    it("reports error for missing appName", () => {
      const config = makeTenantConfig({ appName: "" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "appName")).toBe(true);
    });

    it("reports error for missing name", () => {
      const config = makeTenantConfig({ name: "" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    it("reports error for invalid tone", () => {
      const config = makeTenantConfig({ tone: "rude" as TenantConfig["tone"] });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "tone")).toBe(true);
    });

    it("accepts valid tone values", () => {
      for (const tone of ["formal", "friendly", "casual"] as const) {
        const config = makeTenantConfig({ tone });
        expect(validateTenantConfig(config)).toEqual([]);
      }
    });

    it("reports error for invalid groundingMode", () => {
      const config = makeTenantConfig({ groundingMode: "aggressive" as TenantConfig["groundingMode"] });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "groundingMode")).toBe(true);
    });

    it("accepts valid groundingMode values", () => {
      for (const groundingMode of ["off", "strict"] as const) {
        const config = makeTenantConfig({ groundingMode });
        expect(validateTenantConfig(config)).toEqual([]);
      }
    });

    it("accepts config without groundingMode (defaults to off)", () => {
      const config = makeTenantConfig();
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("reports error for enabled=undefined", () => {
      const config = makeTenantConfig({ enabled: undefined as unknown as boolean });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "enabled")).toBe(true);
    });

    it("reports error for missing createdAt", () => {
      const config = makeTenantConfig({ createdAt: "" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "createdAt")).toBe(true);
    });

    it("reports error for missing updatedAt", () => {
      const config = makeTenantConfig({ updatedAt: "" });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "updatedAt")).toBe(true);
    });

    it("accumulates multiple validation errors", () => {
      const config = makeTenantConfig({
        tenantId: "",
        appName: "",
        name: "",
        enabled: undefined as unknown as boolean,
        createdAt: "",
        updatedAt: "",
      });
      const errors = validateTenantConfig(config);
      expect(errors.length).toBeGreaterThanOrEqual(6);
    });

    it("accepts config with no optional fields", () => {
      const config: TenantConfig = {
        tenantId: "minimal",
        appName: "test",
        name: "Minimal",
        enabled: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      expect(validateTenantConfig(config)).toEqual([]);
    });
  });

  describe("whatsappCoexistence validation", () => {
    it("accepts valid coexistence config", () => {
      const config = makeTenantConfig({
        whatsappCoexistence: { enabled: true, autoReleaseMs: 300_000 },
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("accepts coexistence with autoReleaseMs = 0 (manual release)", () => {
      const config = makeTenantConfig({
        whatsappCoexistence: { enabled: false, autoReleaseMs: 0 },
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("rejects non-boolean enabled", () => {
      const config = makeTenantConfig({
        whatsappCoexistence: { enabled: "yes" as any },
      });
      const errors = validateTenantConfig(config);
      expect(errors).toContainEqual({ field: "whatsappCoexistence.enabled", message: "must be a boolean" });
    });

    it("rejects negative autoReleaseMs", () => {
      const config = makeTenantConfig({
        whatsappCoexistence: { enabled: true, autoReleaseMs: -1 },
      });
      const errors = validateTenantConfig(config);
      expect(errors).toContainEqual({ field: "whatsappCoexistence.autoReleaseMs", message: "must be a non-negative integer" });
    });

    it("rejects non-integer autoReleaseMs", () => {
      const config = makeTenantConfig({
        whatsappCoexistence: { enabled: true, autoReleaseMs: 1.5 },
      });
      const errors = validateTenantConfig(config);
      expect(errors).toContainEqual({ field: "whatsappCoexistence.autoReleaseMs", message: "must be a non-negative integer" });
    });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { validateStartupConfig, assertValidStartupConfig } from "../../src/gateway/config-validator.js";
import { KilnError } from "@kilnai/core";

describe("Startup config validation integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("validateStartupConfig", () => {
    it("should return errors for missing env vars -- does not fail on first error", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
      vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
      vi.stubEnv("ADMIN_TOKEN", "");

      const result = validateStartupConfig({
        modeBApps: [
          { provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
          { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
        ],
        whatsapp: {
          verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
          accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
        },
        tenantAdmin: { adminTokenEnv: "ADMIN_TOKEN" },
      });

      expect(result.valid).toBe(false);
      // All 5 errors collected -- not just the first one
      expect(result.errors).toHaveLength(5);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("modeBApps.anthropic.apiKeyEnv");
      expect(fields).toContain("modeBApps.openai.apiKeyEnv");
      expect(fields).toContain("whatsapp.verifyTokenEnv");
      expect(fields).toContain("whatsapp.accessTokenEnv");
      expect(fields).toContain("tenantAdmin.adminTokenEnv");
    });

    it("should return valid=true when all env vars are present", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "verify-token");
      vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "access-token");
      vi.stubEnv("ADMIN_TOKEN", "admin-secret");

      const result = validateStartupConfig({
        modeBApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
        whatsapp: {
          verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
          accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
        },
        tenantAdmin: { adminTokenEnv: "ADMIN_TOKEN" },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid=true for empty config (no required env vars)", () => {
      const result = validateStartupConfig({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("assertValidStartupConfig", () => {
    it("should not throw when all required env vars are set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

      expect(() => {
        assertValidStartupConfig({
          modeBApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
        });
      }).not.toThrow();
    });

    it("should throw KilnError with code CONFIG_MISSING_ENV when env var is missing", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");

      let thrown: unknown;
      try {
        assertValidStartupConfig({
          modeBApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(KilnError);
      const kilnError = thrown as KilnError;
      expect(kilnError.code).toBe("CONFIG_MISSING_ENV");
      expect(kilnError.retryable).toBe(false);
      expect(kilnError.message).toContain("Startup configuration invalid");
    });

    it("should include ALL missing env vars in the thrown error -- not just the first", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
      vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "sk-wa-access");

      let thrown: unknown;
      try {
        assertValidStartupConfig({
          modeBApps: [
            { provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
            { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
          ],
          whatsapp: {
            verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
            accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
          },
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(KilnError);
      const kilnError = thrown as KilnError;
      const errors = (kilnError.context as { errors: { field: string; message: string }[] }).errors;
      expect(errors.length).toBeGreaterThanOrEqual(3);
      const fields = errors.map((e) => e.field);
      expect(fields).toContain("modeBApps.anthropic.apiKeyEnv");
      expect(fields).toContain("modeBApps.openai.apiKeyEnv");
      expect(fields).toContain("whatsapp.verifyTokenEnv");
    });
  });
});

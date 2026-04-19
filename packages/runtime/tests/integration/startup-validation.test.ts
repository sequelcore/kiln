import { describe, it, expect, vi, afterEach } from "vitest";
import { validateStartupConfig, assertValidStartupConfig } from "../../src/gateway/config-validator.js";
import { KilnError } from "@kilnai/core";

describe("Startup config validation integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("valid config -- all env vars set", () => {
    it("should not throw when all required env vars are present", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "verify-token");
      vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "access-token");
      vi.stubEnv("ADMIN_TOKEN", "admin-secret");

      expect(() => {
        assertValidStartupConfig({
          providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
          whatsapp: {
            verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
            accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
          },
          tenantAdmin: { adminTokenEnv: "ADMIN_TOKEN" },
        });
      }).not.toThrow();
    });

    it("should return valid=true and no errors from validateStartupConfig", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "verify-token");
      vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "access-token");

      const result = validateStartupConfig({
        providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
        whatsapp: {
          verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
          accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
        },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("missing provider-adapter API key env var", () => {
    it("should throw KilnError with code CONFIG_MISSING_ENV listing the missing var", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");

      let thrown: unknown;
      try {
        assertValidStartupConfig({
          providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(KilnError);
      const kilnError = thrown as KilnError;
      expect(kilnError.code).toBe("CONFIG_MISSING_ENV");
      expect(kilnError.retryable).toBe(false);
      expect(kilnError.message).toContain("ANTHROPIC_API_KEY");
      const errors = (kilnError.context as { errors: { field: string; message: string }[] }).errors;
      expect(errors.map((e) => e.field)).toContain("providerAdapterApps.anthropic.apiKeyEnv");
    });
  });

  describe("missing WhatsApp env vars", () => {
    it("should throw KilnError listing both missing WhatsApp vars", () => {
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
      vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");

      let thrown: unknown;
      try {
        assertValidStartupConfig({
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
      expect(kilnError.code).toBe("CONFIG_MISSING_ENV");
      const errors = (kilnError.context as { errors: { field: string; message: string }[] }).errors;
      const fields = errors.map((e) => e.field);
      expect(fields).toContain("whatsapp.verifyTokenEnv");
      expect(fields).toContain("whatsapp.accessTokenEnv");
    });
  });

  describe("multiple missing vars -- all reported in single KilnError", () => {
    it("should report all missing vars together, not one-by-one", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
      vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");

      let thrown: unknown;
      try {
        assertValidStartupConfig({
          providerAdapterApps: [
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
      expect(kilnError.code).toBe("CONFIG_MISSING_ENV");
      const errors = (kilnError.context as { errors: { field: string; message: string }[] }).errors;
      // All 4 errors collected in a single throw -- not one-by-one
      expect(errors).toHaveLength(4);
      const fields = errors.map((e) => e.field);
      expect(fields).toContain("providerAdapterApps.anthropic.apiKeyEnv");
      expect(fields).toContain("providerAdapterApps.openai.apiKeyEnv");
      expect(fields).toContain("whatsapp.verifyTokenEnv");
      expect(fields).toContain("whatsapp.accessTokenEnv");
    });
  });
});

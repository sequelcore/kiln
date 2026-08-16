import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateStartupConfig, assertValidStartupConfig } from "../../src/gateway/config-validator.js";
import { KilnError } from "@kilnai/core/engine";

describe("validateStartupConfig", () => {
  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe("valid config", () => {
    it("should return valid=true for empty config", () => {
      const result = validateStartupConfig({});

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid=true when all env vars are set for provider-adapter apps", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-123";
      process.env.OPENAI_API_KEY = "sk-openai-456";

      const result = validateStartupConfig({
        providerAdapterApps: [
          { provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
          { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
        ],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid=true when WhatsApp env vars are set", () => {
      process.env.WHATSAPP_VERIFY_TOKEN = "verify-123";
      process.env.WHATSAPP_ACCESS_TOKEN = "access-456";

      const result = validateStartupConfig({
        whatsapp: {
          verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
          accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
        },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid=true when tenant admin env var is set", () => {
      process.env.ADMIN_TOKEN = "admin-secret";

      const result = validateStartupConfig({
        tenantAdmin: { adminTokenEnv: "ADMIN_TOKEN" },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return valid=true when all config types are present and valid", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-123";
      process.env.WHATSAPP_VERIFY_TOKEN = "verify-123";
      process.env.WHATSAPP_ACCESS_TOKEN = "access-456";
      process.env.ADMIN_TOKEN = "admin-secret";

      const result = validateStartupConfig({
        providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
        whatsapp: {
          verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
          accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
        },
        tenantAdmin: { adminTokenEnv: "ADMIN_TOKEN" },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("missing env vars", () => {
    it("should report error when provider-adapter API key is missing", () => {
      // Ensure env var is not set
      delete process.env.ANTHROPIC_API_KEY;

      const result = validateStartupConfig({
        providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: "providerAdapterApps.anthropic.apiKeyEnv",
        message: "Environment variable 'ANTHROPIC_API_KEY' is required but not set",
      });
    });

    it("should report error when provider-adapter API key is empty string", () => {
      process.env.ANTHROPIC_API_KEY = "";

      const result = validateStartupConfig({
        providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.field).toBe("providerAdapterApps.anthropic.apiKeyEnv");
    });

    it("should report error when WhatsApp verify token is missing", () => {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
      process.env.WHATSAPP_ACCESS_TOKEN = "access-456";

      const result = validateStartupConfig({
        whatsapp: {
          verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
          accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: "whatsapp.verifyTokenEnv",
        message: "Environment variable 'WHATSAPP_VERIFY_TOKEN' is required but not set",
      });
    });

    it("should report error when WhatsApp access token is missing", () => {
      process.env.WHATSAPP_VERIFY_TOKEN = "verify-123";
      delete process.env.WHATSAPP_ACCESS_TOKEN;

      const result = validateStartupConfig({
        whatsapp: {
          verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
          accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: "whatsapp.accessTokenEnv",
        message: "Environment variable 'WHATSAPP_ACCESS_TOKEN' is required but not set",
      });
    });

    it("should report error when tenant admin token is missing", () => {
      delete process.env.ADMIN_TOKEN;

      const result = validateStartupConfig({
        tenantAdmin: { adminTokenEnv: "ADMIN_TOKEN" },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        field: "tenantAdmin.adminTokenEnv",
        message: "Environment variable 'ADMIN_TOKEN' is required but not set",
      });
    });

    it("should report all errors at once", () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.WHATSAPP_VERIFY_TOKEN;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.ADMIN_TOKEN;

      const result = validateStartupConfig({
        providerAdapterApps: [
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
      expect(result.errors).toHaveLength(5);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("providerAdapterApps.anthropic.apiKeyEnv");
      expect(fields).toContain("providerAdapterApps.openai.apiKeyEnv");
      expect(fields).toContain("whatsapp.verifyTokenEnv");
      expect(fields).toContain("whatsapp.accessTokenEnv");
      expect(fields).toContain("tenantAdmin.adminTokenEnv");
    });
  });

  describe("partial config", () => {
    it("should skip WhatsApp validation when whatsapp config not provided", () => {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      process.env.ANTHROPIC_API_KEY = "sk-ant-123";

      const result = validateStartupConfig({
        providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should skip tenant admin validation when tenantAdmin config not provided", () => {
      delete process.env.ADMIN_TOKEN;
      process.env.ANTHROPIC_API_KEY = "sk-ant-123";

      const result = validateStartupConfig({
        providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should skip provider-adapter validation when providerAdapterApps not provided", () => {
      delete process.env.ANTHROPIC_API_KEY;

      const result = validateStartupConfig({});

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe("assertValidStartupConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should not throw when config is valid", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-123";

    expect(() => {
      assertValidStartupConfig({
        providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
      });
    }).not.toThrow();
  });

  it("should throw KilnError with CONFIG_MISSING_ENV code when invalid", () => {
    delete process.env.ANTHROPIC_API_KEY;

    try {
      assertValidStartupConfig({
        providerAdapterApps: [{ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
      });
      expect.fail("Expected error to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(KilnError);
      expect((error as KilnError).code).toBe("CONFIG_MISSING_ENV");
      expect((error as KilnError).message).toContain("Startup configuration invalid");
      expect(((error as KilnError).context as { errors: unknown[] }).errors).toHaveLength(1);
      expect((error as KilnError).retryable).toBe(false);
    }
  });

  it("should include all errors in thrown error context", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      assertValidStartupConfig({
        providerAdapterApps: [
          { provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
          { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
        ],
      });
      expect.fail("Expected error to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(KilnError);
      const kilnError = error as KilnError;
      expect((kilnError.context as { errors: unknown[] }).errors).toHaveLength(2);
    }
  });
});

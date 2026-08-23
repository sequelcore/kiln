import { describe, it, expect } from "vitest";
import { getErrorSuggestion } from "../../src/engine/error-catalog.js";
import type { KilnErrorCode } from "../../src/engine/errors.js";

// All known error codes -- keep in sync with errors.ts
const ALL_CODES: KilnErrorCode[] = [
  "APP_YAML_INVALID",
  "PRESET_LOAD_FAILED",
  "GATEWAY_YAML_INVALID",
  "RUNTIME_MODE_CONFIG_INVALID",
  "DOMAIN_YAML_INVALID",
  "DOMAIN_KIT_INVALID",
  "TENANT_NOT_FOUND",
  "TENANT_VALIDATION_FAILED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_AUTH_FAILED",
  "BUDGET_CHECK_FAILED",
  "BUDGET_EXCEEDED",
  "CONFIG_MISSING_ENV",
  "CONFIG_INVALID",
  "CIRCUIT_OPEN",
  "GUARDRAIL_FAILED",
  "STRUCTURED_OUTPUT_INVALID",
  "HANDOFF_FAILED",
  "INTERRUPT_TIMEOUT",
  "INJECTION_DETECTED",
  "SECRET_DECRYPTION_FAILED",
  "SECRET_NOT_FOUND",
  "AUDIT_WRITE_FAILED",
  "AUDIT_CHAIN_BROKEN",
  "TENANT_ISOLATION_VIOLATED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "RATE_LIMIT_EXCEEDED",
  "SKILL_MD_INVALID",
  "SKILL_NOT_FOUND",
  "UNSUPPORTED_MODALITY",
  "CONTENT_PART_INVALID",
  "VOICE_CONFIG_INVALID",
  "STT_FAILED",
  "TTS_FAILED",
  "INVALID_SESSION_TRANSITION",
  "CONCURRENT_SESSION_MODIFICATION",
  "PII_DETECTED",
  "CONTENT_POLICY_VIOLATED",
  "SAFETY_RAIL_BLOCKED",
  "SAFETY_SCAN_FAILED",
  "INTERNAL_ERROR",
];

describe("getErrorSuggestion", () => {
  describe("all codes return valid ErrorSuggestion", () => {
    it.each(ALL_CODES)("%s returns non-empty suggestion", (code) => {
      const result = getErrorSuggestion(code);
      expect(result.suggestion).toBeTruthy();
      expect(result.suggestion.length).toBeGreaterThan(0);
    });

    it.each(ALL_CODES)(
      "%s returns docUrl starting with kilnai.dev",
      (code) => {
        const result = getErrorSuggestion(code);
        expect(result.docUrl).toBeDefined();
        expect(result.docUrl).toMatch(/^https:\/\/kilnai\.dev\/docs\/errors\//);
      },
    );
  });

  describe("docUrl format", () => {
    it("uses lowercase kebab-case for the code segment", () => {
      const result = getErrorSuggestion("APP_YAML_INVALID");
      expect(result.docUrl).toBe(
        "https://kilnai.dev/docs/errors/app-yaml-invalid",
      );
    });

    it("generates correct docUrl for DOMAIN_KIT_INVALID", () => {
      const result = getErrorSuggestion("DOMAIN_KIT_INVALID");
      expect(result.docUrl).toBe(
        "https://kilnai.dev/docs/errors/domain-kit-invalid",
      );
    });
  });

  describe("PROVIDER_AUTH_FAILED context-aware suggestions", () => {
    it("mentions ANTHROPIC_API_KEY for anthropic provider", () => {
      const result = getErrorSuggestion("PROVIDER_AUTH_FAILED", {
        provider: "anthropic",
      });
      expect(result.suggestion).toContain("ANTHROPIC_API_KEY");
    });

    it("mentions OPENAI_API_KEY for openai provider", () => {
      const result = getErrorSuggestion("PROVIDER_AUTH_FAILED", {
        provider: "openai",
      });
      expect(result.suggestion).toContain("OPENAI_API_KEY");
    });

    it("mentions DEEPSEEK_API_KEY for deepseek provider", () => {
      const result = getErrorSuggestion("PROVIDER_AUTH_FAILED", {
        provider: "deepseek",
      });
      expect(result.suggestion).toContain("DEEPSEEK_API_KEY");
    });

    it("returns generic message for unknown provider", () => {
      const result = getErrorSuggestion("PROVIDER_AUTH_FAILED", {
        provider: "unknown-llm",
      });
      expect(result.suggestion).toContain("API key");
    });

    it("returns generic message when no context provided", () => {
      const result = getErrorSuggestion("PROVIDER_AUTH_FAILED");
      expect(result.suggestion).toContain("API key");
    });
  });

  describe("PROVIDER_RATE_LIMITED context-aware suggestions", () => {
    it("adds Anthropic dashboard hint for anthropic provider", () => {
      const result = getErrorSuggestion("PROVIDER_RATE_LIMITED", {
        provider: "anthropic",
      });
      expect(result.suggestion).toContain("Anthropic usage dashboard");
    });

    it("does not add dashboard hint for other providers", () => {
      const result = getErrorSuggestion("PROVIDER_RATE_LIMITED", {
        provider: "openai",
      });
      expect(result.suggestion).not.toContain("dashboard");
    });
  });

  describe("CONFIG_MISSING_ENV context-aware suggestions", () => {
    it("includes the env var name when context.envVar is provided", () => {
      const result = getErrorSuggestion("CONFIG_MISSING_ENV", {
        envVar: "MY_VAR",
      });
      expect(result.suggestion).toContain("MY_VAR");
    });

    it("returns base message without context", () => {
      const result = getErrorSuggestion("CONFIG_MISSING_ENV");
      expect(result.suggestion).toContain("environment variable");
    });
  });

  describe("TENANT_NOT_FOUND context-aware suggestions", () => {
    it("includes tenantId when provided in context", () => {
      const result = getErrorSuggestion("TENANT_NOT_FOUND", {
        tenantId: "abc",
      });
      expect(result.suggestion).toContain("abc");
    });

    it("returns base message without tenantId context", () => {
      const result = getErrorSuggestion("TENANT_NOT_FOUND");
      expect(result.suggestion).toContain("tenant");
    });
  });

  describe("specific code suggestions", () => {
    it("INTERNAL_ERROR mentions filing an issue", () => {
      const result = getErrorSuggestion("INTERNAL_ERROR");
      expect(result.suggestion).toContain("file an issue");
    });

    it("INJECTION_DETECTED mentions safety", () => {
      const result = getErrorSuggestion("INJECTION_DETECTED");
      expect(result.suggestion).toContain("safety");
    });

    it("AUDIT_CHAIN_BROKEN mentions tampering", () => {
      const result = getErrorSuggestion("AUDIT_CHAIN_BROKEN");
      expect(result.suggestion).toContain("tampered");
    });

    it("BUDGET_EXCEEDED mentions increasing the budget", () => {
      const result = getErrorSuggestion("BUDGET_EXCEEDED");
      expect(result.suggestion).toContain("budget");
    });

    it("CIRCUIT_OPEN mentions retry", () => {
      const result = getErrorSuggestion("CIRCUIT_OPEN");
      expect(result.suggestion).toContain("retry");
    });

    it("SKILL_MD_INVALID mentions skill schema", () => {
      const result = getErrorSuggestion("SKILL_MD_INVALID");
      expect(result.suggestion).toContain("skill");
    });

    it("SKILL_NOT_FOUND mentions skill name", () => {
      const result = getErrorSuggestion("SKILL_NOT_FOUND");
      expect(result.suggestion).toContain("skill");
    });
  });
});

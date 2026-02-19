import { describe, it, expect } from "vitest";
import { KilnError } from "../../src/engine/errors.js";

describe("KilnError", () => {
  describe("construction", () => {
    it("should create error with code and message", () => {
      const error = new KilnError("APP_YAML_INVALID", "Invalid YAML syntax");

      expect(error.code).toBe("APP_YAML_INVALID");
      expect(error.message).toBe("Invalid YAML syntax");
      expect(error.name).toBe("KilnError");
    });

    it("should have empty context by default", () => {
      const error = new KilnError("INTERNAL_ERROR", "Something went wrong");

      expect(error.context).toEqual({});
    });

    it("should have retryable=false by default", () => {
      const error = new KilnError("INTERNAL_ERROR", "Something went wrong");

      expect(error.retryable).toBe(false);
    });

    it("should accept context in options", () => {
      const context = { field: "name", value: "test" };
      const error = new KilnError("CONFIG_INVALID", "Invalid config", { context });

      expect(error.context).toEqual(context);
    });

    it("should accept retryable flag in options", () => {
      const error = new KilnError("PROVIDER_UNAVAILABLE", "Service down", {
        retryable: true,
      });

      expect(error.retryable).toBe(true);
    });

    it("should accept cause in options", () => {
      const cause = new Error("Original error");
      const error = new KilnError("INTERNAL_ERROR", "Wrapped error", { cause });

      expect(error.cause).toBe(cause);
    });

    it("should accept all options together", () => {
      const cause = new Error("Network timeout");
      const context = { endpoint: "/api/budget" };
      const error = new KilnError("BUDGET_CHECK_FAILED", "Budget API error", {
        context,
        retryable: true,
        cause,
      });

      expect(error.code).toBe("BUDGET_CHECK_FAILED");
      expect(error.message).toBe("Budget API error");
      expect(error.context).toEqual(context);
      expect(error.retryable).toBe(true);
      expect(error.cause).toBe(cause);
    });
  });

  describe("error codes", () => {
    it("should support all engine/loader error codes", () => {
      const codes = [
        "APP_YAML_INVALID",
        "PRESET_LOAD_FAILED",
        "GATEWAY_YAML_INVALID",
        "MODE_B_CONFIG_INVALID",
      ] as const;

      for (const code of codes) {
        const error = new KilnError(code, "test");
        expect(error.code).toBe(code);
      }
    });

    it("should support domain error codes", () => {
      const error = new KilnError("DOMAIN_YAML_INVALID", "test");
      expect(error.code).toBe("DOMAIN_YAML_INVALID");
    });

    it("should support tenant error codes", () => {
      const codes = ["TENANT_NOT_FOUND", "TENANT_VALIDATION_FAILED"] as const;

      for (const code of codes) {
        const error = new KilnError(code, "test");
        expect(error.code).toBe(code);
      }
    });

    it("should support provider error codes", () => {
      const codes = [
        "PROVIDER_UNAVAILABLE",
        "PROVIDER_RATE_LIMITED",
        "PROVIDER_AUTH_FAILED",
      ] as const;

      for (const code of codes) {
        const error = new KilnError(code, "test");
        expect(error.code).toBe(code);
      }
    });

    it("should support budget error codes", () => {
      const codes = ["BUDGET_CHECK_FAILED", "BUDGET_EXCEEDED"] as const;

      for (const code of codes) {
        const error = new KilnError(code, "test");
        expect(error.code).toBe(code);
      }
    });

    it("should support configuration error codes", () => {
      const codes = ["CONFIG_MISSING_ENV", "CONFIG_INVALID"] as const;

      for (const code of codes) {
        const error = new KilnError(code, "test");
        expect(error.code).toBe(code);
      }
    });

    it("should support circuit breaker error codes", () => {
      const error = new KilnError("CIRCUIT_OPEN", "Circuit breaker is open");
      expect(error.code).toBe("CIRCUIT_OPEN");
    });

    it("should support agent intelligence error codes (Phase 2)", () => {
      const codes = [
        "GUARDRAIL_FAILED",
        "STRUCTURED_OUTPUT_INVALID",
        "HANDOFF_FAILED",
        "INTERRUPT_TIMEOUT",
      ] as const;

      for (const code of codes) {
        const error = new KilnError(code, "test");
        expect(error.code).toBe(code);
      }
    });

    it("should support internal error code", () => {
      const error = new KilnError("INTERNAL_ERROR", "Unexpected failure");
      expect(error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("instanceof checks", () => {
    it("should be instance of Error", () => {
      const error = new KilnError("INTERNAL_ERROR", "test");
      expect(error).toBeInstanceOf(Error);
    });

    it("should be instance of KilnError", () => {
      const error = new KilnError("INTERNAL_ERROR", "test");
      expect(error).toBeInstanceOf(KilnError);
    });
  });

  describe("error chaining", () => {
    it("should support nested error causes", () => {
      const level3 = new Error("Root cause");
      const level2 = new KilnError("PROVIDER_UNAVAILABLE", "Level 2", { cause: level3 });
      const level1 = new KilnError("INTERNAL_ERROR", "Level 1", { cause: level2 });

      expect(level1.cause).toBe(level2);
      expect((level1.cause as KilnError).cause).toBe(level3);
    });
  });
});

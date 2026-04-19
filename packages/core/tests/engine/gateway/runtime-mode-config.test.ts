import { describe, it, expect } from "vitest";
import type { RuntimeModeConfig, RuntimeModeValidationError } from "../../../src/engine/gateway/runtime-mode-config.js";
import { validateRuntimeModeConfig } from "../../../src/engine/gateway/runtime-mode-config.js";

function makeProviderConfig() {
  return { name: "anthropic", model: "claude-haiku-4-5-20251001", apiKeyEnv: "ANTHROPIC_API_KEY" };
}

function makeBillingConfig() {
  return {
    budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
    usageEndpoint: "https://api.example.com/users/{userId}/ai-usage",
    overBudgetMessage: "Budget exhausted.",
    tiers: {
      free: { agents: ["fast"] },
      pro: { agents: ["fast", "coding"] },
    },
  };
}

function makeRuntimeModeConfig(overrides: Partial<RuntimeModeConfig> = {}): RuntimeModeConfig {
  return {
    runtime: "provider-adapter",
    provider: makeProviderConfig(),
    billing: makeBillingConfig(),
    ...overrides,
  };
}

describe("RuntimeModeConfig", () => {
  describe("validateRuntimeModeConfig", () => {
    it("returns empty array for a valid provider-adapter config", () => {
      expect(validateRuntimeModeConfig(makeRuntimeModeConfig())).toEqual([]);
    });

    it("returns empty array for valid subprocess runtime config (claude-code)", () => {
      const config: RuntimeModeConfig = {
        runtime: "claude-code",
        provider: { name: "" },
      };
      expect(validateRuntimeModeConfig(config)).toEqual([]);
    });

    it("reports error for invalid runtime value", () => {
      const config = makeRuntimeModeConfig({ runtime: "unknown" as RuntimeModeConfig["runtime"] });
      const errors = validateRuntimeModeConfig(config);
      expect(errors.some((e) => e.field === "runtime")).toBe(true);
    });

    it("reports error for missing provider.name when runtime is provider-adapter", () => {
      const config = makeRuntimeModeConfig({ provider: { name: "" } });
      const errors = validateRuntimeModeConfig(config);
      expect(errors.some((e) => e.field === "provider.name")).toBe(true);
    });

    it("reports error for empty budgetEndpoint", () => {
      const config = makeRuntimeModeConfig({
        billing: { ...makeBillingConfig(), budgetEndpoint: "" },
      });
      const errors = validateRuntimeModeConfig(config);
      expect(errors.some((e) => e.field === "billing.budgetEndpoint")).toBe(true);
    });

    it("reports error for empty usageEndpoint", () => {
      const config = makeRuntimeModeConfig({
        billing: { ...makeBillingConfig(), usageEndpoint: "" },
      });
      const errors = validateRuntimeModeConfig(config);
      expect(errors.some((e) => e.field === "billing.usageEndpoint")).toBe(true);
    });

    it("reports error for empty overBudgetMessage", () => {
      const config = makeRuntimeModeConfig({
        billing: { ...makeBillingConfig(), overBudgetMessage: "" },
      });
      const errors = validateRuntimeModeConfig(config);
      expect(errors.some((e) => e.field === "billing.overBudgetMessage")).toBe(true);
    });

    it("reports error for empty tier agents array", () => {
      const config = makeRuntimeModeConfig({
        billing: {
          ...makeBillingConfig(),
          tiers: { free: { agents: [] } },
        },
      });
      const errors = validateRuntimeModeConfig(config);
      expect(errors.some((e) => e.field.includes("agents") && e.message.includes("non-empty"))).toBe(true);
    });

    it("accumulates multiple validation errors", () => {
      const config: RuntimeModeConfig = {
        runtime: "provider-adapter",
        provider: { name: "" },
        billing: {
          budgetEndpoint: "",
          usageEndpoint: "",
          overBudgetMessage: "",
        },
      };
      const errors = validateRuntimeModeConfig(config);
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });

    it("accepts provider-adapter config without billing (billing is optional)", () => {
      const config: RuntimeModeConfig = {
        runtime: "provider-adapter",
        provider: { name: "anthropic" },
      };
      expect(validateRuntimeModeConfig(config)).toEqual([]);
    });
  });
});

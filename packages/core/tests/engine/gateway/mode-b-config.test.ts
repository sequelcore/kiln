import { describe, it, expect } from "vitest";
import type { ModeBConfig, ModeBValidationError } from "../../../src/engine/gateway/mode-b-config.js";
import { validateModeBConfig } from "../../../src/engine/gateway/mode-b-config.js";

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

function makeModeBConfig(overrides: Partial<ModeBConfig> = {}): ModeBConfig {
  return {
    runtime: "provider-adapter",
    provider: makeProviderConfig(),
    billing: makeBillingConfig(),
    ...overrides,
  };
}

describe("ModeBConfig", () => {
  describe("validateModeBConfig", () => {
    it("returns empty array for a valid Mode B config", () => {
      expect(validateModeBConfig(makeModeBConfig())).toEqual([]);
    });

    it("returns empty array for valid Mode A config (claude-code)", () => {
      const config: ModeBConfig = {
        runtime: "claude-code",
        provider: { name: "" },
      };
      expect(validateModeBConfig(config)).toEqual([]);
    });

    it("reports error for invalid runtime value", () => {
      const config = makeModeBConfig({ runtime: "unknown" as ModeBConfig["runtime"] });
      const errors = validateModeBConfig(config);
      expect(errors.some((e) => e.field === "runtime")).toBe(true);
    });

    it("reports error for missing provider.name when runtime is provider-adapter", () => {
      const config = makeModeBConfig({ provider: { name: "" } });
      const errors = validateModeBConfig(config);
      expect(errors.some((e) => e.field === "provider.name")).toBe(true);
    });

    it("reports error for empty budgetEndpoint", () => {
      const config = makeModeBConfig({
        billing: { ...makeBillingConfig(), budgetEndpoint: "" },
      });
      const errors = validateModeBConfig(config);
      expect(errors.some((e) => e.field === "billing.budgetEndpoint")).toBe(true);
    });

    it("reports error for empty usageEndpoint", () => {
      const config = makeModeBConfig({
        billing: { ...makeBillingConfig(), usageEndpoint: "" },
      });
      const errors = validateModeBConfig(config);
      expect(errors.some((e) => e.field === "billing.usageEndpoint")).toBe(true);
    });

    it("reports error for empty overBudgetMessage", () => {
      const config = makeModeBConfig({
        billing: { ...makeBillingConfig(), overBudgetMessage: "" },
      });
      const errors = validateModeBConfig(config);
      expect(errors.some((e) => e.field === "billing.overBudgetMessage")).toBe(true);
    });

    it("reports error for empty tier agents array", () => {
      const config = makeModeBConfig({
        billing: {
          ...makeBillingConfig(),
          tiers: { free: { agents: [] } },
        },
      });
      const errors = validateModeBConfig(config);
      expect(errors.some((e) => e.field.includes("agents") && e.message.includes("non-empty"))).toBe(true);
    });

    it("accumulates multiple validation errors", () => {
      const config: ModeBConfig = {
        runtime: "provider-adapter",
        provider: { name: "" },
        billing: {
          budgetEndpoint: "",
          usageEndpoint: "",
          overBudgetMessage: "",
        },
      };
      const errors = validateModeBConfig(config);
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });

    it("accepts Mode B config without billing (billing is optional)", () => {
      const config: ModeBConfig = {
        runtime: "provider-adapter",
        provider: { name: "anthropic" },
      };
      expect(validateModeBConfig(config)).toEqual([]);
    });
  });
});

import { describe, it, expect } from "vitest";
import { parseRuntimeModeConfig, RuntimeModeLoaderError } from "../../../src/engine/gateway/runtime-mode-loader.js";

const VALID_PROVIDER_ADAPTER_YAML = `
name: test-mode-b
runtime: provider-adapter
channels: [api]

provider:
  name: anthropic
  model: claude-haiku-4-5-20251001
  apiKeyEnv: ANTHROPIC_API_KEY

billing:
  budgetEndpoint: https://api.example.com/users/{userId}/ai-budget
  usageEndpoint: https://api.example.com/users/{userId}/ai-usage
  overBudgetMessage: "Budget exhausted."
  tiers:
    free:
      agents: [fast]
    pro:
      agents: [fast, coding]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: assistant

teams:
  assistant:
    agents:
      conversant:
        tier: fast
        tools: []
    workflow:
      phases: [understand, respond]
      gates: {}
    capabilities: []
    qualityGates: []
`;

describe("parseRuntimeModeConfig", () => {
  it("returns null for YAML without runtime field (default subprocess runtime)", () => {
    const yaml = `
name: my-app
teams:
  assistant:
    agents: {}
`;
    expect(parseRuntimeModeConfig(yaml)).toBeNull();
  });

  it("returns null for YAML with runtime: claude-code", () => {
    const yaml = `
name: test-app
runtime: claude-code
teams:
  assistant:
    agents: {}
`;
    expect(parseRuntimeModeConfig(yaml)).toBeNull();
  });

  it("parses valid provider-adapter config with provider and billing", () => {
    const config = parseRuntimeModeConfig(VALID_PROVIDER_ADAPTER_YAML);
    expect(config).not.toBeNull();
    expect(config!.runtime).toBe("provider-adapter");
    expect(config!.provider.name).toBe("anthropic");
    expect(config!.provider.model).toBe("claude-haiku-4-5-20251001");
    expect(config!.provider.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(config!.billing).toBeDefined();
    expect(config!.billing!.budgetEndpoint).toBe("https://api.example.com/users/{userId}/ai-budget");
    expect(config!.billing!.usageEndpoint).toBe("https://api.example.com/users/{userId}/ai-usage");
    expect(config!.billing!.overBudgetMessage).toBe("Budget exhausted.");
  });

  it("parses provider-adapter config without billing (billing is optional)", () => {
    const yaml = `
runtime: provider-adapter
provider:
  name: anthropic
  model: claude-haiku-4-5-20251001
`;
    const config = parseRuntimeModeConfig(yaml);
    expect(config).not.toBeNull();
    expect(config!.runtime).toBe("provider-adapter");
    expect(config!.billing).toBeUndefined();
  });

  it("throws RuntimeModeLoaderError on missing provider.name for provider-adapter", () => {
    const yaml = `
runtime: provider-adapter
provider:
  model: claude-haiku-4-5-20251001
`;
    expect(() => parseRuntimeModeConfig(yaml)).toThrow(RuntimeModeLoaderError);
  });

  it("throws RuntimeModeLoaderError on invalid billing fields (empty endpoints)", () => {
    const yaml = `
runtime: provider-adapter
provider:
  name: anthropic
billing:
  budgetEndpoint: ""
  usageEndpoint: ""
  overBudgetMessage: ""
`;
    expect(() => parseRuntimeModeConfig(yaml)).toThrow(RuntimeModeLoaderError);
  });

  it("preserves all provider fields (name, model, apiKeyEnv)", () => {
    const config = parseRuntimeModeConfig(VALID_PROVIDER_ADAPTER_YAML);
    expect(config!.provider.name).toBe("anthropic");
    expect(config!.provider.model).toBe("claude-haiku-4-5-20251001");
    expect(config!.provider.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
  });

  it("preserves all billing tier definitions", () => {
    const config = parseRuntimeModeConfig(VALID_PROVIDER_ADAPTER_YAML);
    expect(config!.billing!.tiers).toBeDefined();
    expect(config!.billing!.tiers!["free"]).toBeDefined();
    expect(config!.billing!.tiers!["free"]!.agents).toEqual(["fast"]);
    expect(config!.billing!.tiers!["pro"]).toBeDefined();
    expect(config!.billing!.tiers!["pro"]!.agents).toEqual(["fast", "coding"]);
  });

  it("throws RuntimeModeLoaderError on invalid YAML syntax (non-object like an array)", () => {
    expect(() => parseRuntimeModeConfig("- item1\n- item2")).toThrow(RuntimeModeLoaderError);
  });

  it("throws RuntimeModeLoaderError on parse failure and includes yaml field", () => {
    const badYaml = `runtime: [\nthis is not valid yaml:::`;
    try {
      parseRuntimeModeConfig(badYaml);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeModeLoaderError);
      const loaderErr = err as RuntimeModeLoaderError;
      expect(loaderErr.errors.some((e) => e.field === "yaml")).toBe(true);
    }
  });

  it("RuntimeModeLoaderError message includes field and message", () => {
    const yaml = `
runtime: provider-adapter
provider:
  model: claude-haiku-4-5-20251001
`;
    try {
      parseRuntimeModeConfig(yaml);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeModeLoaderError);
      const loaderErr = err as RuntimeModeLoaderError;
      expect(loaderErr.message).toContain("runtime mode config");
      expect(loaderErr.errors.length).toBeGreaterThan(0);
    }
  });
});

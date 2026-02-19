import { describe, it, expect } from "vitest";
import { parseModeBConfig, ModeBLoaderError } from "../../../src/engine/gateway/mode-b-loader.js";

const VALID_MODE_B_YAML = `
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

describe("parseModeBConfig", () => {
  it("returns null for YAML without runtime field (default Mode A)", () => {
    const yaml = `
name: my-app
teams:
  assistant:
    agents: {}
`;
    expect(parseModeBConfig(yaml)).toBeNull();
  });

  it("returns null for YAML with runtime: claude-code", () => {
    const yaml = `
name: test-app
runtime: claude-code
teams:
  assistant:
    agents: {}
`;
    expect(parseModeBConfig(yaml)).toBeNull();
  });

  it("parses valid Mode B config with provider and billing", () => {
    const config = parseModeBConfig(VALID_MODE_B_YAML);
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

  it("parses Mode B config without billing (billing is optional)", () => {
    const yaml = `
runtime: provider-adapter
provider:
  name: anthropic
  model: claude-haiku-4-5-20251001
`;
    const config = parseModeBConfig(yaml);
    expect(config).not.toBeNull();
    expect(config!.runtime).toBe("provider-adapter");
    expect(config!.billing).toBeUndefined();
  });

  it("throws ModeBLoaderError on missing provider.name for provider-adapter", () => {
    const yaml = `
runtime: provider-adapter
provider:
  model: claude-haiku-4-5-20251001
`;
    expect(() => parseModeBConfig(yaml)).toThrow(ModeBLoaderError);
  });

  it("throws ModeBLoaderError on invalid billing fields (empty endpoints)", () => {
    const yaml = `
runtime: provider-adapter
provider:
  name: anthropic
billing:
  budgetEndpoint: ""
  usageEndpoint: ""
  overBudgetMessage: ""
`;
    expect(() => parseModeBConfig(yaml)).toThrow(ModeBLoaderError);
  });

  it("preserves all provider fields (name, model, apiKeyEnv)", () => {
    const config = parseModeBConfig(VALID_MODE_B_YAML);
    expect(config!.provider.name).toBe("anthropic");
    expect(config!.provider.model).toBe("claude-haiku-4-5-20251001");
    expect(config!.provider.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
  });

  it("preserves all billing tier definitions", () => {
    const config = parseModeBConfig(VALID_MODE_B_YAML);
    expect(config!.billing!.tiers).toBeDefined();
    expect(config!.billing!.tiers!["free"]).toBeDefined();
    expect(config!.billing!.tiers!["free"]!.agents).toEqual(["fast"]);
    expect(config!.billing!.tiers!["pro"]).toBeDefined();
    expect(config!.billing!.tiers!["pro"]!.agents).toEqual(["fast", "coding"]);
  });

  it("throws ModeBLoaderError on invalid YAML syntax (non-object like an array)", () => {
    expect(() => parseModeBConfig("- item1\n- item2")).toThrow(ModeBLoaderError);
  });

  it("throws ModeBLoaderError on parse failure and includes yaml field", () => {
    const badYaml = `runtime: [\nthis is not valid yaml:::`;
    try {
      parseModeBConfig(badYaml);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ModeBLoaderError);
      const loaderErr = err as ModeBLoaderError;
      expect(loaderErr.errors.some((e) => e.field === "yaml")).toBe(true);
    }
  });

  it("ModeBLoaderError message includes field and message", () => {
    const yaml = `
runtime: provider-adapter
provider:
  model: claude-haiku-4-5-20251001
`;
    try {
      parseModeBConfig(yaml);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ModeBLoaderError);
      const loaderErr = err as ModeBLoaderError;
      expect(loaderErr.message).toContain("Mode B config");
      expect(loaderErr.errors.length).toBeGreaterThan(0);
    }
  });
});

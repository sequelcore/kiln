import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { generateAppYaml, generateGatewayYaml } from "../../src/commands/init-templates.js";
import type { InitOptions } from "../../src/commands/init-templates.js";

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    appName: "myapp",
    domain: "typescript",
    domainDisplayName: "TypeScript",
    provider: "anthropic",
    channels: ["cli", "web"],
    teamMode: "sequential",
    qualityGates: [],
    ...overrides,
  };
}

describe("generateAppYaml", () => {
  it("produces valid YAML", () => {
    const yaml = generateAppYaml(makeOptions());
    expect(() => parseYaml(yaml)).not.toThrow();
  });

  it("includes the correct app name", () => {
    const yaml = generateAppYaml(makeOptions({ appName: "projectx" }));
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["name"]).toBe("projectx");
  });

  it("includes the correct channels", () => {
    const yaml = generateAppYaml(makeOptions({ channels: ["cli", "api"] }));
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["channels"]).toContain("cli");
    expect(parsed["channels"]).toContain("api");
  });

  it("includes quality gates from domain", () => {
    const gates = [
      { name: "typecheck", command: "tsc --noEmit", description: "Type check" },
      { name: "test", command: "vitest run", description: "Run tests" },
    ];
    const yaml = generateAppYaml(makeOptions({ qualityGates: gates }));
    expect(yaml).toContain("typecheck");
    expect(yaml).toContain("tsc --noEmit");
    expect(yaml).toContain("vitest run");
  });

  it("produces valid YAML with empty quality gates array", () => {
    const yaml = generateAppYaml(makeOptions({ qualityGates: [] }));
    expect(() => parseYaml(yaml)).not.toThrow();
  });

  it("includes memory configuration", () => {
    const yaml = generateAppYaml(makeOptions());
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["memory"]).toBeDefined();
  });

  it("uses shared resource tools instead of legacy kiln_memory tools", () => {
    const yaml = generateAppYaml(makeOptions());
    expect(yaml).toContain("resource_list");
    expect(yaml).toContain("resource_template_list");
    expect(yaml).toContain("resource_read");
    expect(yaml).toContain("memory_search");
    expect(yaml).not.toContain("kiln_memory_");
  });

  it("includes planner and worker agents", () => {
    const yaml = generateAppYaml(makeOptions());
    expect(yaml).toContain("planner:");
    expect(yaml).toContain("worker:");
  });

  it("router fallback is main", () => {
    const yaml = generateAppYaml(makeOptions());
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    const router = parsed["router"] as Record<string, unknown>;
    expect(router["fallback"]).toBe("main");
  });

  it("single channel renders correctly", () => {
    const yaml = generateAppYaml(makeOptions({ channels: ["api"] }));
    expect(() => parseYaml(yaml)).not.toThrow();
    expect(yaml).toContain("api");
  });
});

describe("generateGatewayYaml", () => {
  it("produces valid YAML", () => {
    const yaml = generateGatewayYaml(makeOptions());
    expect(() => parseYaml(yaml)).not.toThrow();
  });

  it("includes the correct port", () => {
    const yaml = generateGatewayYaml(makeOptions());
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["port"]).toBe(4800);
  });

  it("includes the app name in apps list", () => {
    const yaml = generateGatewayYaml(makeOptions({ appName: "myapp" }));
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    const apps = parsed["apps"] as Array<Record<string, unknown>>;
    expect(apps[0]!["name"]).toBe("myapp");
  });

  it("anthropic uses claude-sonnet-4-6 model", () => {
    const yaml = generateGatewayYaml(makeOptions({ provider: "anthropic" }));
    expect(yaml).toContain("claude-sonnet-4-6");
    expect(yaml).toContain("ANTHROPIC_API_KEY");
  });

  it("openai uses gpt-4o model", () => {
    const yaml = generateGatewayYaml(makeOptions({ provider: "openai" }));
    expect(yaml).toContain("gpt-4o");
    expect(yaml).toContain("OPENAI_API_KEY");
  });

  it("deepseek uses deepseek-chat model", () => {
    const yaml = generateGatewayYaml(makeOptions({ provider: "deepseek" }));
    expect(yaml).toContain("deepseek-chat");
    expect(yaml).toContain("DEEPSEEK_API_KEY");
  });

  it("ollama uses llama3.2 model", () => {
    const yaml = generateGatewayYaml(makeOptions({ provider: "ollama" }));
    expect(yaml).toContain("llama3.2");
  });

  it("includes api channel path with app name", () => {
    const yaml = generateGatewayYaml(makeOptions({ appName: "myapp" }));
    expect(yaml).toContain("/api/myapp");
  });

  it("modeB section references provider-adapter", () => {
    const yaml = generateGatewayYaml(makeOptions());
    expect(yaml).toContain("provider-adapter");
  });
});

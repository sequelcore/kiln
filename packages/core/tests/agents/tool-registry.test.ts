import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/agents/tool-registry.js";
import type { ToolDefinition } from "../../src/agents/index.js";
import type { DomainConfig } from "../../src/domain/index.js";

function makeTool(
  name: string,
  tags: readonly string[] = [],
): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {},
    tags: new Set(tags),
  };
}

function makeDomainConfig(toolTags: readonly string[]): DomainConfig {
  return {
    name: "test",
    displayName: "Test",
    toolTags: new Set(toolTags),
    qualityGates: [],
    detectPatterns: [],
    multishotExamples: "",
    phaseExamples: "",
  };
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("registers and retrieves a tool", () => {
    const tool = makeTool("search");
    registry.register(tool);

    expect(registry.get("search")).toBe(tool);
  });

  it("registers many tools at once", () => {
    const tools = [makeTool("a"), makeTool("b"), makeTool("c")];
    registry.registerMany(tools);

    expect(registry.count).toBe(3);
    expect(registry.get("a")).toBe(tools[0]);
    expect(registry.get("b")).toBe(tools[1]);
    expect(registry.get("c")).toBe(tools[2]);
  });

  it("unregisters a tool", () => {
    registry.register(makeTool("search"));
    expect(registry.get("search")).toBeDefined();

    registry.unregister("search");
    expect(registry.get("search")).toBeUndefined();
    expect(registry.count).toBe(0);
  });

  it("filters by tags with ANY overlap", () => {
    registry.registerMany([
      makeTool("mol-search", ["molecular"]),
      makeTool("train-search", ["training"]),
      makeTool("dual", ["molecular", "training"]),
      makeTool("untagged"),
    ]);

    const result = registry.filterByTags(new Set(["molecular"]));
    const names = result.map((t) => t.name);

    expect(names).toContain("mol-search");
    expect(names).toContain("dual");
    expect(names).not.toContain("train-search");
    expect(names).not.toContain("untagged");
  });

  it("returns universal tools (empty tag set)", () => {
    registry.registerMany([
      makeTool("universal-a"),
      makeTool("universal-b"),
      makeTool("tagged", ["molecular"]),
    ]);

    const result = registry.universal();
    const names = result.map((t) => t.name);

    expect(names).toEqual(["universal-a", "universal-b"]);
  });

  it("forDomain returns universal + domain-specific combined", () => {
    registry.registerMany([
      makeTool("universal"),
      makeTool("mol-tool", ["molecular"]),
      makeTool("train-tool", ["training"]),
    ]);

    const config = makeDomainConfig(["molecular"]);
    const result = registry.forDomain(config);
    const names = result.map((t) => t.name);

    expect(names).toContain("universal");
    expect(names).toContain("mol-tool");
    expect(names).not.toContain("train-tool");
  });

  it("forDomain deduplicates tools", () => {
    // A tool that is both universal (no tags) AND matches domain would be weird,
    // but a tool tagged with domain tags should appear only once
    registry.registerMany([
      makeTool("universal"),
      makeTool("mol-tool", ["molecular"]),
    ]);

    const config = makeDomainConfig(["molecular"]);
    const result = registry.forDomain(config);

    expect(result).toHaveLength(2);
  });

  it("returns undefined for missing tool", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("clear empties the registry", () => {
    registry.registerMany([makeTool("a"), makeTool("b")]);
    expect(registry.count).toBe(2);

    registry.clear();
    expect(registry.count).toBe(0);
    expect(registry.all()).toEqual([]);
  });

  it("duplicate registration overwrites previous", () => {
    const original = makeTool("search");
    const replacement: ToolDefinition = {
      name: "search",
      description: "updated",
      inputSchema: { type: "object" },
      tags: new Set(["new-tag"]),
    };

    registry.register(original);
    registry.register(replacement);

    expect(registry.count).toBe(1);
    expect(registry.get("search")?.description).toBe("updated");
  });

  it("count reflects current state", () => {
    expect(registry.count).toBe(0);

    registry.register(makeTool("a"));
    expect(registry.count).toBe(1);

    registry.register(makeTool("b"));
    expect(registry.count).toBe(2);

    registry.unregister("a");
    expect(registry.count).toBe(1);
  });

  it("filterByDomain uses config.toolTags", () => {
    registry.registerMany([
      makeTool("mol-tool", ["molecular"]),
      makeTool("train-tool", ["training"]),
    ]);

    const config = makeDomainConfig(["training"]);
    const result = registry.filterByDomain(config);
    const names = result.map((t) => t.name);

    expect(names).toEqual(["train-tool"]);
  });
});

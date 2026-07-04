import { describe, expect, it } from "vitest";
import { ToolCatalogIndex } from "../../../src/tools/domain/tool-catalog.js";
import type { DevTool, ToolInput, ToolResult } from "../../../src/tools/domain/tool.js";
import { ToolCatalogSearchTool } from "../../../src/tools/infrastructure/tool-catalog-search-tool.js";

describe("ToolCatalogSearchTool", () => {
  it("filters discovery results to the effective per-turn allowlist", async () => {
    const catalog = ToolCatalogIndex.fromTools([
      fakeTool("bash", { destructive: true }),
      fakeTool("git", { readOnly: true, idempotent: true }),
      fakeTool("grep", { readOnly: true, idempotent: true }),
      fakeTool("tool_catalog_search", { readOnly: true, idempotent: true }),
    ]);
    const tool = new ToolCatalogSearchTool(() => catalog);

    const result = await tool.execute(
      {
        name: "tool_catalog_search",
        input: { query: "bash command", verbosity: "structured" },
      },
      { allowedToolNames: ["git", "grep", "tool_catalog_search"] },
    );

    expect(result.isError).toBe(false);
    const output = JSON.parse(result.output) as {
      entries: readonly { readonly name: string }[];
      totalIndexed: number;
    };
    expect(output.entries.map((entry) => entry.name)).not.toContain("bash");
    expect(output.totalIndexed).toBe(3);
  });

  it("marks exact lookups outside the effective allowlist as stale", async () => {
    const catalog = ToolCatalogIndex.fromTools([
      fakeTool("bash", { destructive: true }),
      fakeTool("git", { readOnly: true, idempotent: true }),
      fakeTool("tool_catalog_search", { readOnly: true, idempotent: true }),
    ]);
    const tool = new ToolCatalogSearchTool(() => catalog);

    const result = await tool.execute(
      {
        name: "tool_catalog_search",
        input: { exact: "bash", verbosity: "structured" },
      },
      { allowedToolNames: ["git", "tool_catalog_search"] },
    );

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({
      entries: [],
      totalIndexed: 2,
      stale: true,
      reason: "tool_not_found",
    });
  });

  it("treats null optional tags as omitted provider JSON", async () => {
    const catalog = ToolCatalogIndex.fromTools([
      fakeTool("git", { readOnly: true, idempotent: true }),
      fakeTool("tool_catalog_search", { readOnly: true, idempotent: true }),
    ]);
    const tool = new ToolCatalogSearchTool(() => catalog);

    const result = await tool.execute({
      name: "tool_catalog_search",
      input: { query: "git", tags: null, verbosity: "summary" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("git");
  });

  it("identifies a successful exact schema lookup as materializable", async () => {
    const catalog = ToolCatalogIndex.fromTools([
      fakeTool("browser_session_start", { readOnly: true, idempotent: true }),
      fakeTool("tool_catalog_search", { readOnly: true, idempotent: true }),
    ]);
    const tool = new ToolCatalogSearchTool(() => catalog);

    const result = await tool.execute({
      name: "tool_catalog_search",
      input: { exact: "browser_session_start", includeSchemas: true, verbosity: "structured" },
    });

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      materializableToolName: "browser_session_start",
    });
  });

  it.each([
    ["query", { query: "browser session", includeSchemas: true }],
    ["prefix", { prefix: "browser_session", includeSchemas: true }],
    ["missing exact", { exact: "missing_tool", includeSchemas: true }],
  ])("does not identify a %s lookup as materializable", async (_scenario, input) => {
    const catalog = ToolCatalogIndex.fromTools([
      fakeTool("browser_session_start", { readOnly: true, idempotent: true }),
      fakeTool("tool_catalog_search", { readOnly: true, idempotent: true }),
    ]);
    const tool = new ToolCatalogSearchTool(() => catalog);

    const result = await tool.execute({
      name: "tool_catalog_search",
      input: { ...input, verbosity: "structured" },
    });

    expect(result.isError).toBe(false);
    expect(result.metadata).not.toHaveProperty("materializableToolName");
  });

  it("does not identify a stale exact schema lookup as materializable", async () => {
    const catalog = ToolCatalogIndex.fromTools([
      fakeTool("browser_session_start", { readOnly: true, idempotent: true }),
      fakeTool("tool_catalog_search", { readOnly: true, idempotent: true }),
    ]);
    const tool = new ToolCatalogSearchTool(() => catalog);

    const result = await tool.execute(
      {
        name: "tool_catalog_search",
        input: { exact: "browser_session_start", includeSchemas: true, verbosity: "structured" },
      },
      { allowedToolNames: ["tool_catalog_search"] },
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({ stale: true });
    expect(result.metadata).not.toHaveProperty("materializableToolName");
  });
});

function fakeTool(name: string, annotations: NonNullable<DevTool["annotations"]>): DevTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    annotations,
    async execute(_input: ToolInput): Promise<ToolResult> {
      return { output: "", isError: false };
    },
  };
}

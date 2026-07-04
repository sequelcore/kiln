import { describe, expect, it } from "vitest";
import { admitProgressiveTool } from "../../src/session/progressive-tool-admission.js";

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly tags: ReadonlySet<string>;
}

const READ_TOOL = tool("read");
const WRITE_TOOL = tool("write");
const GREP_TOOL = tool("grep");

const MATERIALIZABLE_TOOLS = new Map<string, ToolDefinition>([
  [WRITE_TOOL.name, WRITE_TOOL],
  [GREP_TOOL.name, GREP_TOOL],
]);

const CATALOG_METADATA = {
  toolName: "tool_catalog_search",
  kind: "catalog",
  operation: "search",
  exact: "write",
  resultCount: 1,
  totalIndexed: 3,
  includedSchemas: true,
  stale: false,
  materializableToolName: "write",
} as const;

describe("admitProgressiveTool", () => {
  it("admits the canonical definition authorized by the turn allowlist", () => {
    const result = admitProgressiveTool(
      [READ_TOOL],
      MATERIALIZABLE_TOOLS,
      new Set(["read", "write"]),
      CATALOG_METADATA,
    );

    expect(result).toEqual({
      tools: [READ_TOOL, WRITE_TOOL],
      decision: "admitted",
    });
    expect(result.tools[1]).toBe(WRITE_TOOL);
  });

  it("does not duplicate a definition that is already materialized", () => {
    const tools = [READ_TOOL, WRITE_TOOL];

    expect(admitProgressiveTool(
      tools,
      MATERIALIZABLE_TOOLS,
      new Set(["read", "write"]),
      CATALOG_METADATA,
    )).toEqual({ tools, decision: "already_materialized" });
  });

  it("rejects a canonical definition outside the turn authority", () => {
    const tools = [READ_TOOL];

    expect(admitProgressiveTool(
      tools,
      MATERIALIZABLE_TOOLS,
      new Set(["read"]),
      CATALOG_METADATA,
    )).toEqual({ tools, decision: "outside_authority" });
  });

  it("rejects a materialization name missing from the canonical map", () => {
    const tools = [READ_TOOL];
    const metadata = { ...CATALOG_METADATA, exact: "stat", materializableToolName: "stat" };

    expect(admitProgressiveTool(
      tools,
      MATERIALIZABLE_TOOLS,
      new Set(["read", "stat"]),
      metadata,
    )).toEqual({ tools, decision: "not_found" });
  });

  it.each([
    ["has no materializable name", { ...CATALOG_METADATA, materializableToolName: undefined }],
    ["is stale", { ...CATALOG_METADATA, stale: true }],
    ["belongs to another metadata kind", { ...CATALOG_METADATA, kind: "file" }],
  ])("rejects metadata that is not materializable when it %s", (_case, metadata) => {
    const tools = [READ_TOOL];

    expect(admitProgressiveTool(
      tools,
      MATERIALIZABLE_TOOLS,
      new Set(["read", "write"]),
      metadata,
    )).toEqual({ tools, decision: "not_materializable" });
  });

  it("preserves input collections and appends the admitted definition in order", () => {
    const tools = Object.freeze([READ_TOOL, GREP_TOOL]);
    const materializableEntries = [...MATERIALIZABLE_TOOLS.entries()];
    const allowlist = new Set(["read", "grep", "write"]);

    const result = admitProgressiveTool(tools, MATERIALIZABLE_TOOLS, allowlist, CATALOG_METADATA);

    expect(result.tools).not.toBe(tools);
    expect(result.tools).toEqual([READ_TOOL, GREP_TOOL, WRITE_TOOL]);
    expect(tools).toEqual([READ_TOOL, GREP_TOOL]);
    expect([...MATERIALIZABLE_TOOLS.entries()]).toEqual(materializableEntries);
    expect([...allowlist]).toEqual(["read", "grep", "write"]);
  });
});

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object" },
    tags: new Set(["development"]),
  };
}

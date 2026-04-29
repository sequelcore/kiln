import { describe, expect, it } from "vitest";
import { createDefaultBuiltinTools } from "../../../src/tools/default-tool-surface.js";
import { ToolCatalogIndex } from "../../../src/tools/domain/tool-catalog.js";

describe("ToolCatalogIndex", () => {
  it("indexes names, descriptions, schemas, tags, authority, and source package", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    const result = catalog.search({ exact: "read" });

    expect(result.totalIndexed).toBe(16);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      name: "read",
      sourcePackage: "@kilnai/core",
      authority: "read_only",
      inputFields: ["filePath", "offset", "limit"],
      tags: expect.arrayContaining(["file", "read-only", "idempotent"]),
      outputFields: ["result", "attempts", "fallbackUsed"],
    });
    expect(result.entries[0]?.inputSchema).toBeUndefined();
    expect(result.entries[0]?.outputSchema).toBeUndefined();
  });

  it("supports exact, prefix, tag, and lexical query search without embeddings", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ exact: "glob" }).entries.map((entry) => entry.name)).toEqual(["glob"]);
    expect(catalog.search({ prefix: "web_" }).entries.map((entry) => entry.name)).toEqual([
      "web_search",
      "web_fetch",
    ]);
    expect(catalog.search({ tags: ["media"] }).entries.map((entry) => entry.name)).toEqual([
      "view_image",
      "ocr_image",
    ]);
    expect(catalog.search({ query: "apply patch dry run", limit: 1 }).entries[0]?.name).toBe("patch");
  });

  it("returns cloned schemas only when requested", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    const first = catalog.search({ exact: "read", includeSchemas: true }).entries[0];
    const second = catalog.search({ exact: "read", includeSchemas: true }).entries[0];

    expect(first?.inputSchema).toMatchObject({ type: "object" });
    expect(first?.outputSchema).toMatchObject({ type: "object" });
    expect(first?.inputSchema).not.toBe(second?.inputSchema);
    expect(first?.outputSchema).not.toBe(second?.outputSchema);
  });

  it("reports missing exact matches without falling back to unrelated tools", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ exact: "missing_tool" })).toMatchObject({
      totalIndexed: 16,
      entries: [],
      stale: true,
      reason: "tool_not_found",
    });
  });

  it("indexes code intelligence as a semantic code tool", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ exact: "code_intelligence" }).entries[0]).toMatchObject({
      name: "code_intelligence",
      sourcePackage: "@kilnai/core",
      authority: "read_only",
      tags: expect.arrayContaining(["code", "semantic", "read-only"]),
      inputFields: expect.arrayContaining(["operation", "path", "position", "query", "symbol", "verbosity"]),
    });
    expect(catalog.search({ tags: ["code"] }).entries.map((entry) => entry.name)).toContain("code_intelligence");
  });
});

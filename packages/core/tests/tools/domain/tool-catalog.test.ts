import { describe, expect, it } from "vitest";
import { createDefaultBuiltinTools } from "../../../src/tools/default-tool-surface.js";
import { ToolCatalogIndex } from "../../../src/tools/domain/tool-catalog.js";

describe("ToolCatalogIndex", () => {
  it("indexes names, descriptions, schemas, tags, authority, and source package", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    const result = catalog.search({ exact: "read" });

    expect(result.totalIndexed).toBe(45);
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
      "web_extract",
    ]);
    expect(catalog.search({ prefix: "browser_" }).entries.map((entry) => entry.name)).toEqual([
      "browser_session_start",
      "browser_navigate",
      "browser_observe",
      "browser_click",
      "browser_type",
      "browser_keypress",
      "browser_scroll",
      "browser_session_stop",
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
      totalIndexed: 45,
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

  it("indexes read_many as a bulk context file tool", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ exact: "read_many" }).entries[0]).toMatchObject({
      name: "read_many",
      sourcePackage: "@kilnai/core",
      authority: "read_only",
      tags: expect.arrayContaining(["file", "context", "read-only"]),
      inputFields: expect.arrayContaining(["paths", "include", "exclude", "recursive", "respectGitIgnore"]),
    });
  });

  it("indexes monitor tools as lifecycle command tools", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ tags: ["monitor"] }).entries.map((entry) => entry.name)).toEqual([
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
    ]);
    expect(catalog.search({ exact: "monitor_start" }).entries[0]).toMatchObject({
      name: "monitor_start",
      sourcePackage: "@kilnai/core",
      authority: "destructive",
      tags: expect.arrayContaining(["monitor", "command", "destructive"]),
      inputFields: expect.arrayContaining(["command", "cwd", "name", "timeout", "verbosity"]),
    });
  });

  it("indexes task state tools as shared session progress tools", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ tags: ["task-state"] }).entries.map((entry) => entry.name)).toEqual([
      "task_list",
      "task_update",
    ]);
    expect(catalog.search({ exact: "task_update" }).entries[0]).toMatchObject({
      name: "task_update",
      sourcePackage: "@kilnai/core",
      authority: "standard",
      tags: expect.arrayContaining(["task-state", "progress"]),
      inputFields: expect.arrayContaining(["id", "title", "status", "details", "dependsOn", "verbosity"]),
    });
  });

  it("indexes operator elicitation as a cross-surface operator tool", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ exact: "operator_elicit" }).entries[0]).toMatchObject({
      name: "operator_elicit",
      sourcePackage: "@kilnai/core",
      authority: "standard",
      tags: expect.arrayContaining(["operator", "elicitation"]),
      inputFields: expect.arrayContaining(["mode", "message", "schema", "url", "sensitive", "verbosity"]),
    });
  });

  it("indexes browser and computer use as cross-surface interactive automation tools", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ tags: ["browser"] }).entries.map((entry) => entry.name)).toEqual([
      "browser_session_start",
      "browser_navigate",
      "browser_observe",
      "browser_click",
      "browser_type",
      "browser_keypress",
      "browser_scroll",
      "browser_session_stop",
    ]);
    expect(catalog.search({ tags: ["computer"] }).entries.map((entry) => entry.name)).toEqual([
      "computer_observe",
      "computer_click",
      "computer_type",
      "computer_keypress",
      "computer_open_application",
      "computer_focus_application",
      "computer_minimize_application",
      "computer_close_application",
    ]);
    expect(catalog.search({ exact: "browser_type" }).entries[0]).toMatchObject({
      name: "browser_type",
      sourcePackage: "@kilnai/core",
      authority: "destructive",
      tags: expect.arrayContaining(["interactive", "browser", "automation", "destructive"]),
      inputFields: expect.arrayContaining(["sessionId", "text", "sensitive", "verbosity"]),
    });
    expect(catalog.search({ exact: "computer_observe" }).entries[0]).toMatchObject({
      name: "computer_observe",
      sourcePackage: "@kilnai/core",
      authority: "read_only",
      tags: expect.arrayContaining(["interactive", "computer", "automation", "read-only"]),
      inputFields: expect.arrayContaining(["windowTitle", "verbosity"]),
    });
  });

  it("indexes resource tools as read-only context tools", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ tags: ["resource"] }).entries.map((entry) => entry.name)).toEqual([
      "resource_list",
      "resource_template_list",
      "resource_read",
    ]);
    expect(catalog.search({ exact: "resource_read" }).entries[0]).toMatchObject({
      name: "resource_read",
      sourcePackage: "@kilnai/core",
      authority: "read_only",
      tags: expect.arrayContaining(["resource", "context", "read-only", "idempotent"]),
      inputFields: ["uri"],
    });
  });
});

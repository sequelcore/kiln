import { describe, expect, it } from "vitest";
import { createDefaultBuiltinTools } from "../../../src/tools/default-tool-surface.js";
import {
  digestToolDefinition,
  ToolCatalogIndex,
  type BuiltinToolCatalogContribution,
} from "../../../src/tools/domain/tool-catalog.js";
import type { DevTool } from "../../../src/tools/domain/tool.js";

function verificationTool(name: string): DevTool {
  return {
    name,
    description: `${name} verification tool`,
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      return { output: "ok", isError: false };
    },
  };
}

const CONTRIBUTION_EFFECT = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
} as const;

function catalogContribution(
  name: string,
  aliases: readonly string[] = [],
): BuiltinToolCatalogContribution {
  return {
    definition: {
      name,
      description: `${name} managed tool`,
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: [],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { result: { type: "string" } },
        required: ["result"],
        additionalProperties: false,
      },
    },
    effectEnvelope: CONTRIBUTION_EFFECT,
    sourcePackage: "@kilnai/runtime",
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

describe("ToolCatalogIndex", () => {
  it("indexes names, descriptions, schemas, tags, authority, and source package", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    const result = catalog.search({ exact: "read" });

    expect(result.totalIndexed).toBe(47);
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

  it("normalizes inert contributions and makes their identity independent of input order", () => {
    const firstContribution = catalogContribution("managed_beta", ["Beta managed"]);
    const secondContribution = catalogContribution("managed_alpha", ["Alpha managed"]);
    const first = ToolCatalogIndex.fromTools([], undefined, {
      catalogContributions: [firstContribution, secondContribution],
    });
    const second = ToolCatalogIndex.fromTools([], undefined, {
      catalogContributions: [secondContribution, firstContribution],
    });

    expect(first.snapshotId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.snapshotId).toBe(second.snapshotId);
    expect(first.search({ exact: "Beta managed", includeSchemas: true })).toMatchObject({
      entries: [{
        name: "managed_beta",
        aliases: ["Beta managed"],
        authority: "read_only",
        tags: ["read-only", "idempotent"],
        sourcePackage: "@kilnai/runtime",
        toolDefinitionDigest: digestToolDefinition(firstContribution.definition),
      }],
    });
    expect(first.search({ exact: "managed_alpha" }).entries[0]?.inputSchema).toBeUndefined();
  });

  it("preserves the source snapshot identity while restricting visible canonical names", () => {
    const catalog = ToolCatalogIndex.fromTools([], undefined, {
      catalogContributions: [catalogContribution("managed_tool", ["Managed tool"])],
    });
    const restricted = catalog.restrictToCanonicalNames(new Set(["tool_catalog_search"]));

    expect(restricted).not.toBe(catalog);
    expect(restricted.snapshotId).toBe(catalog.snapshotId);
    expect(restricted.search({ query: "managed" }).entries).toEqual([]);
    expect(restricted.search({ exact: "Managed tool" })).toMatchObject({
      entries: [],
      stale: true,
      reason: "unauthorized",
      diagnostic: { canonicalName: "managed_tool", alias: "Managed tool" },
    });
  });

  it("preserves a retained tagged strict definition identity while restricting visibility", () => {
    const base = catalogContribution("managed_tool");
    const contribution = {
      ...base,
      definition: {
        ...base.definition,
        strict: true as const,
        tags: ["managed-invocation", "control"],
      },
    } satisfies BuiltinToolCatalogContribution;
    const catalog = ToolCatalogIndex.fromTools([], undefined, {
      catalogContributions: [contribution],
    });
    const original = catalog.search({ exact: "managed_tool", includeSchemas: true }).entries[0];
    const restricted = catalog.restrictToCanonicalNames(new Set(["managed_tool"]));
    const retained = restricted.search({ exact: "managed_tool", includeSchemas: true }).entries[0];

    expect(restricted.snapshotId).toBe(catalog.snapshotId);
    expect(retained?.toolDefinitionDigest).toBe(original?.toolDefinitionDigest);
    expect(retained?.toolDefinitionDigest).toBe(digestToolDefinition(contribution.definition));
  });

  it("rejects executable or accessor-backed contribution schema values without invoking accessors", () => {
    let getterInvocations = 0;
    const accessorSchema: Record<string, unknown> = { type: "object" };
    Object.defineProperty(accessorSchema, "properties", {
      enumerable: true,
      get() {
        getterInvocations += 1;
        return {};
      },
    });

    expect(() => ToolCatalogIndex.fromTools([], undefined, {
      catalogContributions: [{
        ...catalogContribution("managed_accessor"),
        definition: {
          ...catalogContribution("managed_accessor").definition,
          inputSchema: accessorSchema,
        },
      }],
    })).toThrow(/schema.*accessor|accessor.*schema/i);
    expect(getterInvocations).toBe(0);

    expect(() => ToolCatalogIndex.fromTools([], undefined, {
      catalogContributions: [{
        ...catalogContribution("managed_function"),
        definition: {
          ...catalogContribution("managed_function").definition,
          inputSchema: {
            type: "object",
            properties: { callback: () => "not declarative" },
          },
        },
      }],
    })).toThrow(/schema.*unsupported|unsupported.*schema/i);

    expect(() => ToolCatalogIndex.fromTools([], undefined, {
      catalogContributions: [{
        ...catalogContribution("managed_to_json"),
        definition: {
          ...catalogContribution("managed_to_json").definition,
          inputSchema: {
            type: "object",
            properties: {},
            toJSON() {
              return { type: "string" };
            },
          },
        },
      }],
    })).toThrow(/schema.*unsupported|unsupported.*schema/i);
  });

  it("includes provider-facing tags and strictness in definition identity", () => {
    const base = catalogContribution("managed_identity");
    const tagged = {
      ...base,
      definition: { ...base.definition, tags: new Set(["managed", "read-only"]) },
    } satisfies BuiltinToolCatalogContribution;
    const runtimeTags = {
      [Symbol.iterator]: () => ["managed", "read-only"][Symbol.iterator](),
    } satisfies Iterable<string>;
    const structurallyRuntimeOwned = {
      ...base,
      definition: { ...base.definition, tags: runtimeTags },
    } satisfies BuiltinToolCatalogContribution;
    const strict = {
      ...tagged,
      definition: { ...tagged.definition, strict: true as const },
    } satisfies BuiltinToolCatalogContribution;

    expect(digestToolDefinition(base.definition)).not.toBe(digestToolDefinition(tagged.definition));
    expect(digestToolDefinition(tagged.definition)).toBe(digestToolDefinition(structurallyRuntimeOwned.definition));
    expect(digestToolDefinition(tagged.definition)).not.toBe(digestToolDefinition(strict.definition));
    expect(ToolCatalogIndex.fromTools([], undefined, { catalogContributions: [base] }).snapshotId)
      .not.toBe(ToolCatalogIndex.fromTools([], undefined, { catalogContributions: [tagged] }).snapshotId);
    expect(ToolCatalogIndex.fromTools([], undefined, { catalogContributions: [tagged] }).snapshotId)
      .not.toBe(ToolCatalogIndex.fromTools([], undefined, { catalogContributions: [strict] }).snapshotId);
  });

  it("fails closed when canonical names or aliases collide", () => {
    expect(() => ToolCatalogIndex.fromTools([
      verificationTool("duplicate_tool"),
      verificationTool("duplicate_tool"),
    ])).toThrow(/canonical name collision/i);
    expect(() => ToolCatalogIndex.fromTools([verificationTool("managed_tool")], undefined, {
      catalogContributions: [catalogContribution("managed_tool")],
    })).toThrow(/canonical name collision/i);
    expect(() => ToolCatalogIndex.fromTools([verificationTool("read")], undefined, {
      catalogContributions: [catalogContribution("managed_tool", ["read"])],
    })).toThrow(/alias collision/i);
    expect(() => ToolCatalogIndex.fromTools([], undefined, {
      catalogContributions: [
        catalogContribution("managed_one", ["same alias"]),
        catalogContribution("managed_two", ["same alias"]),
      ],
    })).toThrow(/alias collision/i);
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
    expect(catalog.search({ tags: ["media"] }).entries.map((entry) => entry.name)).toEqual(["view_image", "ocr_image"]);
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
      totalIndexed: 47,
      entries: [],
      stale: true,
      reason: "not_registered",
      diagnostic: {
        code: "not_registered",
        requestedName: "missing_tool",
      },
    });
  });

  it.each([
    ["Dafny", "formal_verify"],
    ["Oxlint", "static_analyze"],
    ["Gentle", "gentle_review"],
    ["Gentle AI", "gentle_review"],
  ])("resolves the %s catalog alias to the canonical %s identity", (alias, canonicalName) => {
    const catalog = ToolCatalogIndex.fromTools([
      ...createDefaultBuiltinTools({
        verificationTools: [
          verificationTool("formal_verify"),
          verificationTool("static_analyze"),
          verificationTool("gentle_review"),
        ],
      }),
    ]);

    expect(catalog.search({ exact: alias, includeSchemas: true })).toMatchObject({
      entries: [{ name: canonicalName }],
      diagnostic: {
        code: "available",
        requestedName: alias,
        canonicalName,
        alias,
      },
    });
    expect(catalog.search({ exact: alias, includeSchemas: true }).entries[0]?.inputSchema).toMatchObject({
      type: "object",
    });
  });

  it("reports an unavailable configured producer while keeping it out of the executable catalog", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools(), undefined, {
      configuredProducerDiagnostics: [
        {
          canonicalName: "formal_verify",
          status: "validation_failed",
          configuration: {
            code: "version_mismatch",
            message: "Dafny version mismatch",
            expectedVersion: "4.11.0",
            observedVersion: "4.10.0",
          },
        },
      ],
    });

    expect(catalog.search({ exact: "Dafny", includeSchemas: true })).toMatchObject({
      entries: [],
      stale: true,
      reason: "validation_failed",
      diagnostic: {
        code: "validation_failed",
        canonicalName: "formal_verify",
        alias: "Dafny",
        configuration: { code: "version_mismatch" },
      },
    });
  });

  it("returns a typed unauthorized diagnostic when an alias resolves outside the allowlist", () => {
    const catalog = ToolCatalogIndex.fromTools([
      ...createDefaultBuiltinTools({
        verificationTools: [verificationTool("formal_verify")],
      }),
    ]).restrictToCanonicalNames(new Set(["tool_catalog_search"]));

    expect(catalog.search({ exact: "Dafny", includeSchemas: true })).toMatchObject({
      entries: [],
      stale: true,
      reason: "unauthorized",
      diagnostic: {
        code: "unauthorized",
        requestedName: "Dafny",
        canonicalName: "formal_verify",
        alias: "Dafny",
      },
    });
    expect(catalog.search({ exact: "Dafny", includeSchemas: true }).entries).toHaveLength(0);
  });

  it("indexes code intelligence as a semantic code tool", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ exact: "code_intelligence" }).entries[0]).toMatchObject({
      name: "code_intelligence",
      sourcePackage: "@kilnai/core",
      authority: "standard",
      tags: expect.arrayContaining(["code", "semantic", "read-only", "egress"]),
      inputFields: expect.arrayContaining(["operation", "path", "position", "query", "symbol", "verbosity"]),
    });
    expect(catalog.search({ tags: ["code"] }).entries.map((entry) => entry.name)).toContain("code_intelligence");
  });

  it("indexes json_query as a structured JSON query tool", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ exact: "json_query" }).entries[0]).toMatchObject({
      name: "json_query",
      sourcePackage: "@kilnai/core",
      authority: "standard",
      tags: expect.arrayContaining(["structured-data", "json", "query", "read-only", "egress"]),
      inputFields: ["filter", "json", "path", "maxBytes", "verbosity"],
    });
    expect(catalog.search({ tags: ["json"] }).entries.map((entry) => entry.name)).toContain("json_query");
  });

  it("indexes read_many as a bulk context file tool", () => {
    const catalog = ToolCatalogIndex.fromTools(createDefaultBuiltinTools());

    expect(catalog.search({ exact: "read_many" }).entries[0]).toMatchObject({
      name: "read_many",
      sourcePackage: "@kilnai/core",
      authority: "standard",
      tags: expect.arrayContaining(["file", "context", "read-only", "egress"]),
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
      authority: "standard",
      tags: expect.arrayContaining(["monitor", "command", "egress"]),
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
      authority: "standard",
      tags: expect.arrayContaining(["interactive", "computer", "automation", "read-only", "egress"]),
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
      authority: "standard",
      tags: expect.arrayContaining(["resource", "context", "read-only", "egress"]),
      inputFields: ["uri", "cursor", "limit"],
    });
  });
});

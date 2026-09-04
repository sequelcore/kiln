import type { ToolDefinition } from "@kilnai/core/agents";
import type { ActionEffectEnvelope, Capability } from "@kilnai/core/engine";
import { digestToolDefinition } from "@kilnai/core/tools";
import { describe, expect, it, vi } from "vitest";
import type { EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import {
  admitProgressiveTool,
  createMaterializableRuntimeToolBinding,
  type MaterializableRuntimeToolBinding,
} from "../../src/session/progressive-tool-admission.js";

const SNAPSHOT_ID = `sha256:${"1".repeat(64)}` as const;
const AUTHORITY_ADMISSION_ID = `sha256:${"2".repeat(64)}` as const;
const READ_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};
const READ_TOOL = tool("read");
const WRITE_TOOL = tool("write");
const EXECUTOR = vi.fn(async () => ({ ok: true }));
const WRITE_BINDING = binding(WRITE_TOOL, EXECUTOR);

describe("admitProgressiveTool", () => {
  it("derives a stable executable admission identity without hashing callback state", () => {
    const first = binding(WRITE_TOOL, vi.fn(async () => ({ version: 1 })));
    const second = binding(WRITE_TOOL, vi.fn(async () => ({ version: 2 })));

    expect(first.executableAdmissionId).toBe(second.executableAdmissionId);
    expect(first.definitionDigest).toBe(second.definitionDigest);
    expect(first.definition).toBe(WRITE_TOOL);
    expect(second.definition).toBe(WRITE_TOOL);
  });

  it("admits the exact frozen binding under the current catalog and authority", () => {
    const result = admit([READ_TOOL]);

    expect(result.decision).toBe("admitted");
    expect(result.tools).toEqual([READ_TOOL, WRITE_TOOL]);
    expect(result.tools[1]).toBe(WRITE_TOOL);
    expect(result.binding).toBe(WRITE_BINDING);
  });

  it("does not duplicate an identical already-materialized definition", () => {
    const tools = [READ_TOOL, WRITE_TOOL];

    const result = admit(tools);

    expect(result).toMatchObject({ tools, decision: "already_materialized", binding: WRITE_BINDING });
    expect(result.tools).toBe(tools);
  });

  it.each([
    ["input schema", { ...WRITE_TOOL, inputSchema: { type: "object", properties: { changed: { type: "boolean" } } } }],
    ["description", { ...WRITE_TOOL, description: "different description" }],
    ["output schema", { ...WRITE_TOOL, outputSchema: { type: "string" } }],
  ])("rejects a same-name collision with a different %s", (_case, conflicting) => {
    expect(admit([READ_TOOL, conflicting]).decision).toBe("not_materializable");
  });

  it("rejects stale catalog, definition, and authority evidence", () => {
    expect(admit([READ_TOOL], { currentCatalogSnapshotId: `sha256:${"3".repeat(64)}` }).decision)
      .toBe("not_materializable");
    expect(admit([READ_TOOL], {
      metadata: { ...metadata(), materializableToolDefinitionDigest: `sha256:${"4".repeat(64)}` },
    }).decision).toBe("not_materializable");
    expect(admit([READ_TOOL], { authorityAdmission: authorityAdmission([]) }).decision)
      .toBe("outside_authority");
  });

  it("rejects missing and substituted executable bindings", () => {
    expect(admit([READ_TOOL], { bindings: new Map() }).decision).toBe("not_found");
    expect(admit([READ_TOOL], { currentExecutor: vi.fn() }).decision).toBe("not_materializable");
    const substituted = {
      ...WRITE_BINDING,
      executableAdmissionId: `sha256:${"5".repeat(64)}`,
    } as MaterializableRuntimeToolBinding;
    expect(admit([READ_TOOL], { bindings: new Map([["write", substituted]]) }).decision)
      .toBe("not_materializable");
  });

  it.each([
    ["legacy name-only metadata", {
      kind: "catalog", toolName: "tool_catalog_search", operation: "search", stale: false,
      materializableToolName: "write",
    }],
    ["schema-omitting metadata", { ...metadata(), includedSchemas: false }],
    ["multi-result metadata", { ...metadata(), resultCount: 2 }],
    ["stale metadata", { ...metadata(), stale: true }],
  ])("rejects %s", (_case, candidate) => {
    expect(admit([READ_TOOL], { metadata: candidate }).decision).toBe("not_materializable");
  });

  it("preserves all input collections", () => {
    const tools = Object.freeze([READ_TOOL]);
    const bindings = new Map([["write", WRITE_BINDING]]);
    const allowlist = new Set(["read", "write"]);
    const originalEntries = [...bindings];

    const result = admitProgressiveTool({
      tools,
      materializableToolBindings: bindings,
      turnToolAllowlist: allowlist,
      currentCatalogSnapshotId: SNAPSHOT_ID,
      authorityAdmission: authorityAdmission(["write"]),
      currentExecutor: WRITE_BINDING.executor,
      metadata: metadata(),
    });

    expect(result.tools).not.toBe(tools);
    expect(tools).toEqual([READ_TOOL]);
    expect([...bindings]).toEqual(originalEntries);
    expect([...allowlist]).toEqual(["read", "write"]);
  });
});

function admit(
  tools: readonly ToolDefinition[],
  overrides: {
    readonly bindings?: ReadonlyMap<string, MaterializableRuntimeToolBinding>;
    readonly currentCatalogSnapshotId?: `sha256:${string}`;
    readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
    readonly currentExecutor?: MaterializableRuntimeToolBinding["executor"];
    readonly metadata?: unknown;
  } = {},
) {
  return admitProgressiveTool({
    tools,
    materializableToolBindings: overrides.bindings ?? new Map([["write", WRITE_BINDING]]),
    turnToolAllowlist: new Set(["read", "write"]),
    currentCatalogSnapshotId: overrides.currentCatalogSnapshotId ?? SNAPSHOT_ID,
    authorityAdmission: overrides.authorityAdmission ?? authorityAdmission(["write"]),
    currentExecutor: overrides.currentExecutor
      ?? (overrides.bindings ?? new Map([["write", WRITE_BINDING]])).get("write")?.executor,
    metadata: overrides.metadata ?? metadata(),
  });
}

function binding(
  definition: ToolDefinition,
  executor: MaterializableRuntimeToolBinding["executor"],
): MaterializableRuntimeToolBinding {
  const capability: Capability = {
    name: definition.name,
    description: definition.description,
    schema: definition.inputSchema,
    tags: [...definition.tags],
    effectEnvelope: READ_EFFECT,
  };
  return createMaterializableRuntimeToolBinding({
    definition,
    capability,
    executor,
    scopeIdentity: "test-surface",
  });
}

function metadata() {
  return {
    toolName: "tool_catalog_search",
    kind: "catalog",
    operation: "search",
    exact: "write",
    resultCount: 1,
    totalIndexed: 3,
    includedSchemas: true,
    stale: false,
    materializableToolName: "write",
    catalogSnapshotId: SNAPSHOT_ID,
    materializableToolDefinitionDigest: digestToolDefinition(WRITE_TOOL),
  } as const;
}

function authorityAdmission(allowedToolNames: readonly string[]): EffectiveAuthorityAdmissionBundle {
  return {
    admissionId: AUTHORITY_ADMISSION_ID,
    turn: {
      tools: {
        allowedToolPermissions: allowedToolNames.map((toolName) => ({
          toolName,
          authority: { level: 1, allowed: true, requiresApproval: false, reason: "test" },
          effectEnvelope: READ_EFFECT,
        })),
        deniedToolNames: [],
      },
    },
  } as unknown as EffectiveAuthorityAdmissionBundle;
}

function tool(name: string): ToolDefinition {
  return Object.freeze({
    name,
    description: `${name} tool`,
    inputSchema: Object.freeze({ type: "object", properties: {}, additionalProperties: false }),
    outputSchema: Object.freeze({ type: "object", properties: {} }),
    tags: new Set(["development"]),
  });
}

import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@kilnai/core/agents";
import type { ProviderRequestToolMaterializationDecisionEvidence } from "@kilnai/core/events";
import { createMaterializableRuntimeToolBinding } from "../../src/session/progressive-tool-admission.js";
import {
  buildProviderRequestToolProjectionEvidence,
  verifyLexicalMaterializationDecisions,
} from "../../src/session/runtime-session-orchestrator-telemetry.js";
import { FIXTURE_READ_ONLY_EFFECT } from "./runtime-claim-fixture.js";

const CATALOG_ID = `sha256:${"c".repeat(64)}` as const;
const AUTHORITY_ID = `sha256:${"a".repeat(64)}` as const;

function fixture() {
  const definition: ToolDefinition = {
    name: "managed_agent.status",
    description: "Reads managed agent status",
    inputSchema: { type: "object", properties: { runId: { type: "string" } } },
    tags: new Set(["managed-agent", "read-only"]),
  };
  const binding = createMaterializableRuntimeToolBinding({
    definition,
    capability: {
      name: definition.name,
      description: definition.description,
      schema: definition.inputSchema,
      tags: [...definition.tags],
      effectEnvelope: FIXTURE_READ_ONLY_EFFECT,
    },
    executor: vi.fn().mockResolvedValue({ output: "running", isError: false }),
    scopeIdentity: "telemetry-test-surface",
  });
  const decision: ProviderRequestToolMaterializationDecisionEvidence = {
    decision: "materialized",
    toolName: definition.name,
    sourceToolCallId: "catalog-call-1",
    sourceToolName: "tool_catalog_search",
    catalog: {
      exact: definition.name,
      includedSchemas: true,
      resultCount: 1,
      stale: false,
    },
    lexicalBinding: {
      catalogSnapshotId: CATALOG_ID,
      toolDefinitionDigest: binding.definitionDigest,
      authorityAdmissionId: AUTHORITY_ID,
      executableAdmissionId: binding.executableAdmissionId,
    },
  };
  return { definition, binding, decision };
}

describe("legacy lexical materialization telemetry", () => {
  it("binds the decision to the exact definition in the provider projection", () => {
    const { definition, binding, decision } = fixture();

    expect(buildProviderRequestToolProjectionEvidence({
      projectedTools: [definition],
      materializableTools: new Map([[definition.name, definition]]),
      materializableToolBindings: new Map([[definition.name, binding]]),
      materializationDecisions: [decision],
      authorityAdmissionId: AUTHORITY_ID,
      currentCatalogSnapshotId: CATALOG_ID,
      currentBuiltinTools: new Map([[definition.name, binding.executor]]),
    })).toEqual(expect.objectContaining({
      materializedAdditions: [definition.name],
      materializationDecisions: [decision],
    }));
  });

  it.each([
    ["projected definition", { description: "Substituted description" }, AUTHORITY_ID, CATALOG_ID],
    ["authority admission", {}, `sha256:${"b".repeat(64)}` as const, CATALOG_ID],
    ["catalog snapshot", {}, AUTHORITY_ID, `sha256:${"d".repeat(64)}` as const],
  ])("fails closed on a mismatched %s", (_label, definitionPatch, authorityId, catalogId) => {
    const { definition, binding, decision } = fixture();

    expect(() => verifyLexicalMaterializationDecisions({
      projectedTools: [{ ...definition, ...definitionPatch }],
      materializationDecisions: [decision],
      materializableToolBindings: new Map([[definition.name, binding]]),
      authorityAdmissionId: authorityId,
      currentCatalogSnapshotId: catalogId,
      currentBuiltinTools: new Map([[definition.name, binding.executor]]),
    })).toThrow(/mismatch/u);
  });

  it("fails closed when the current executable binding identity differs", () => {
    const { definition, binding, decision } = fixture();
    const replacement = createMaterializableRuntimeToolBinding({
      definition,
      capability: binding.capability,
      executor: vi.fn().mockResolvedValue({ output: "replacement", isError: false }),
      scopeIdentity: "another-runtime-surface",
    });

    expect(() => verifyLexicalMaterializationDecisions({
      projectedTools: [definition],
      materializationDecisions: [decision],
      materializableToolBindings: new Map([[definition.name, replacement]]),
      authorityAdmissionId: AUTHORITY_ID,
      currentCatalogSnapshotId: CATALOG_ID,
      currentBuiltinTools: new Map([[definition.name, replacement.executor]]),
    })).toThrow(/executable binding mismatch/u);
  });

  it("fails closed when the current dispatch callback is replaced without changing public binding evidence", () => {
    const { definition, binding, decision } = fixture();
    const substitute = vi.fn().mockResolvedValue({ output: "substitute", isError: false });

    expect(() => verifyLexicalMaterializationDecisions({
      projectedTools: [definition],
      materializationDecisions: [decision],
      materializableToolBindings: new Map([[definition.name, binding]]),
      authorityAdmissionId: AUTHORITY_ID,
      currentCatalogSnapshotId: CATALOG_ID,
      currentBuiltinTools: new Map([[definition.name, substitute]]),
    })).toThrow(/resolved executor mismatch/u);
    expect(substitute).not.toHaveBeenCalled();
  });
});

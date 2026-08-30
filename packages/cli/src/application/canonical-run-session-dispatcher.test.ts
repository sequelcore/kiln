import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeOmittedAuthority,
  createCanonicalRunAttendedTrustedExecutionSessionAuthority,
  createCanonicalRunSessionDispatcher,
  intersectCanonicalMcpCapabilities,
  isCanonicalAuthorityAdmissible,
  partitionCanonicalMcpCapabilities,
} from "./canonical-run-session-dispatcher.js";

const mocks = vi.hoisted(() => ({
  dispatchTurn: vi.fn(),
  close: vi.fn(),
}));

const authorityEvidenceStore = {
  persist: vi.fn(),
  loadSessionFacet: vi.fn(),
};

vi.mock("./operator-turn-dispatch-composition.js", () => ({
  createOperatorTurnDispatchComposition: vi.fn(() => ({
    bridge: { bind: vi.fn() },
    authorityAdmissionBridge: { bind: vi.fn() },
    dispatcher: { dispatchTurn: mocks.dispatchTurn },
    close: mocks.close,
  })),
}));

describe("createCanonicalRunSessionDispatcher", () => {
  it("binds attended trusted execution to a distinct process-local principal and exact CLI session", async () => {
    const approve = vi.fn(() => ({ status: "approved" as const, authorizedBy: "CLI operator" }));
    const projectRuntimeId = `krp_${"1".repeat(64)}` as const;
    const compositionRevision = `sha256:${"2".repeat(64)}` as const;
    const authority = createCanonicalRunAttendedTrustedExecutionSessionAuthority({
      operatorSessionId: "operator-session-1",
      projectRuntimeId,
      configurationRevision: { revisionSetId: compositionRevision, revisions: { test: compositionRevision } },
      approvalPort: { approve },
    });

    expect(authority.binding).toMatchObject({
      operatorSessionId: "operator-session-1",
      projectRuntimeId,
      compositionRevision,
    });
    expect(authority.binding.localPrincipalId).toMatch(/^local-operator-session:/u);
    expect(authority.binding.localPrincipalId).not.toBe(authority.binding.operatorSessionId);

    const tree = authority.createInvocationTreeAuthority("invocation-tree-1");
    const issued = await tree.issue({
      harness: "codex",
      routeId: "codex-direct",
      profileCeiling: "trusted-full-access",
      allowedToolNames: ["workspace.write"],
      effectCeiling: {
        operation: "mutate",
        boundaries: ["workspace"],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: ["local-state"],
        idempotency: "idempotent",
      },
      policyDigest: `sha256:${"3".repeat(64)}`,
      enforcementRevision: "runtime-attended-trusted-execution-v1",
      durationMs: 60_000,
    });

    expect(issued.status).toBe("issued");
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorSessionId: "operator-session-1",
        invocationTreeId: "invocation-tree-1",
        projectRuntimeId,
        compositionRevision,
      }),
    );
    authority.closeSession();
    expect(tree.lifecycle).toBe("session-closed");
  });

  it("binds an operator-selected eligible account into the canonical turn intent", async () => {
    mocks.dispatchTurn.mockResolvedValue({ result: { sessionSucceeded: true } });
    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "C:/workspace",
      executionId: "benchmark-trial-1",
      targetId: "codex-sol",
      accountOverrideId: "subscription-a",
      authorityAdmissionEvidenceStore: authorityEvidenceStore,
      captureCatalogSnapshot: () => ({
        catalog: {} as never,
        configurationRevision: { revisionSetId: "sha256:test", revisions: {} },
      }),
      configurationRevision: {
        revisionSetId: "sha256:test",
        revisions: { global: "global", project: "project" },
      },
    });

    await dispatcher.dispatch({} as never);

    expect(mocks.dispatchTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "benchmark-trial-1",
        intent: {
          targetId: "codex-sol",
          accountOverrideId: "subscription-a",
        },
      }),
    );
  });

  it("allows authoritative auto that admits no tools as model-only fail-closed execution", () => {
    expect(isCanonicalAuthorityAdmissible({ completeness: "authoritative", admittedAuthority: "fail_closed" })).toBe(
      true,
    );
    expect(isCanonicalAuthorityAdmissible({ completeness: "partial", admittedAuthority: "unknown" })).toBe(false);
  });

  it("denies unknown MCP effects without adding them to the admitted tool set", () => {
    const result = partitionCanonicalMcpCapabilities([
      {
        name: "mcp:known",
        effectEnvelope: {
          operation: "observe",
          boundaries: ["workspace"],
          reversibility: "reversible",
          dataEgress: "none",
          identityUse: "none",
          consequences: [],
          idempotency: "idempotent",
        },
      } as never,
      { name: "mcp:unknown" } as never,
      { name: "mcp:resource", tags: ["mcp", "resource"], effectEnvelope: undefined } as never,
      {
        name: "mcp:conservative",
        tags: ["mcp", "tool"],
        effectEnvelope: {
          operation: "mutate",
          boundaries: ["process", "workspace", "machine", "network", "external-system"],
          reversibility: "unknown",
          dataEgress: "unknown",
          identityUse: "unknown",
          consequences: ["unknown"],
          idempotency: "unknown",
        },
      } as never,
    ]);
    expect(result.admitted.map(({ name }) => name)).toEqual(["mcp:known"]);
    expect(result.denied.map(({ name }) => name)).toEqual(["mcp:unknown", "mcp:resource", "mcp:conservative"]);
    expect(result.denied.find(({ name }) => name === "mcp:resource")?.kind).toBe("resource");
  });

  it("intersects canonical MCP capabilities with both explicit and scoped permission selectors", () => {
    const result = intersectCanonicalMcpCapabilities(
      [
        {
          name: "mcp:server:tool:read",
          tags: ["mcp", "tool"],
          effectEnvelope: {
            operation: "observe",
            boundaries: [],
            reversibility: "reversible",
            dataEgress: "none",
            identityUse: "none",
            consequences: [],
            idempotency: "idempotent",
          },
        } as never,
        {
          name: "mcp:server:tool:write",
          tags: ["mcp", "tool"],
          effectEnvelope: {
            operation: "observe",
            boundaries: [],
            reversibility: "reversible",
            dataEgress: "none",
            identityUse: "none",
            consequences: [],
            idempotency: "idempotent",
          },
        } as never,
      ],
      new Set(["mcp:server:tool:read", "mcp:server:tool:write"]),
      new Set(["mcp:server:tool:read"]),
    );
    expect(result.admitted.map(({ name }) => name)).toEqual(["mcp:server:tool:read"]);
    expect(result.denied.map(({ name }) => name)).toEqual(["mcp:server:tool:write"]);
  });

  it("converts omitted/auto authority to authoritative fail-closed only for an empty tool set", () => {
    expect(canonicalizeOmittedAuthority({
      requestedAuthority: undefined,
      admittedToolCount: 0,
      candidateToolCount: 3,
    })).toMatchObject({
      completeness: "authoritative",
      admittedAuthority: "fail_closed",
      toolCount: 0,
      deniedToolCount: 3,
    });
    expect(canonicalizeOmittedAuthority({
      requestedAuthority: "auto",
      admittedToolCount: 0,
      candidateToolCount: 3,
    })).toMatchObject({
      completeness: "authoritative",
      admittedAuthority: "fail_closed",
      toolCount: 0,
      deniedToolCount: 3,
    });
    expect(() => canonicalizeOmittedAuthority({
      requestedAuthority: "auto",
      admittedToolCount: 1,
      candidateToolCount: 3,
    })).toThrow(/concrete/i);
  });
});

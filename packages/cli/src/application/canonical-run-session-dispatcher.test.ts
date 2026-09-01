import { describe, expect, it, vi } from "vitest";
import { createSessionBuiltinToolOptions } from "@kilnai/core/tools";
import { withProgressiveRuntimeToolProjection } from "../config/builtin-tool-surface-config.js";
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
  authorityCoordinatorOptions: undefined as unknown,
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

vi.mock("@kilnai/runtime", async () => {
  const actual = await vi.importActual<typeof import("@kilnai/runtime")>("@kilnai/runtime");
  return {
    ...actual,
    OperatorAuthorityAdmissionCoordinator: class {
      constructor(options: unknown) { mocks.authorityCoordinatorOptions = options; }
    },
  };
});

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

  it("prepares read-only repository tools without provider transport", async () => {
    createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "C:/workspace",
      executionId: "benchmark-trial-read-only",
      targetId: "codex-sol",
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

    const coordinator = mocks.authorityCoordinatorOptions as {
      prepare(input: unknown): Promise<{ facets: { turn: {
        authority: { admittedAuthority: string; toolCount: number; deniedToolCount: number };
        tools: {
          allowedToolPermissions: readonly { authority: { level: number } }[];
          deniedToolNames: readonly string[];
        };
      } } }>;
    };
    const { RuntimeSession } = await vi.importActual<typeof import("@kilnai/runtime")>("@kilnai/runtime");
    const session = new RuntimeSession({ id: "benchmark-read-only-session" });
    const configurationRevision = {
      revisionSetId: "sha256:test",
      revisions: { global: "global", project: "project" },
    };
    const result = await coordinator.prepare({
      request: {
        executionId: "benchmark-trial-read-only",
        payload: {
          sessionConfig: {
            task: "Inspect repository files without mutation.",
            cwd: "C:/workspace",
            requestedAuthority: "read_only",
            builtinToolOptions: createSessionBuiltinToolOptions(
              withProgressiveRuntimeToolProjection({}, "execute"),
            ),
          },
          permissionPolicy: {},
          sessionId: "benchmark-read-only-session",
          operatorAdoption: { persist: async () => undefined },
        },
      },
      admission: {
        targetId: "codex-sol",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-luna",
      },
      snapshot: { catalog: {}, configurationRevision },
      binding: {
        status: "bound",
        routeId: "codex-sol",
        accountId: "account-1",
        credentialId: "credential-1",
        credentialRevision: "revision-1",
      },
      dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "test" } },
      session,
    });

    expect(result.facets.turn.authority).toMatchObject({
      admittedAuthority: "read_only",
    });
    expect(result.facets.turn.authority.toolCount).toBeGreaterThan(0);
    expect(result.facets.turn.authority.toolCount).toBe(result.facets.turn.tools.allowedToolPermissions.length);
    expect(result.facets.turn.authority.deniedToolCount).toBe(result.facets.turn.tools.deniedToolNames.length);
    expect(result.facets.turn.tools.allowedToolPermissions.every(({ authority }) => authority.level <= 1)).toBe(true);
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

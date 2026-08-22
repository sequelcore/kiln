import { describe, expect, it, vi } from "vitest";
import {
  createCanonicalRunSessionDispatcher,
  intersectCanonicalMcpCapabilities,
  canonicalizeOmittedAuthority,
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
  it("binds an operator-selected eligible account into the canonical turn intent", async () => {
    mocks.dispatchTurn.mockResolvedValue({ result: { sessionSucceeded: true } });
    const dispatcher = createCanonicalRunSessionDispatcher({
      catalog: {} as never,
      cwd: "C:/workspace",
      executionId: "benchmark-trial-1",
      routeId: "codex-sol",
      accountOverrideId: "subscription-a",
      authorityAdmissionEvidenceStore: authorityEvidenceStore,
      captureCatalogSnapshot: () => ({ catalog: {} as never, configurationRevision: { revisionSetId: "sha256:test", revisions: {} } }),
      configurationRevision: {
        revisionSetId: "sha256:test",
        revisions: { global: "global", project: "project" },
      },
    });

    await dispatcher.dispatch({} as never);

    expect(mocks.dispatchTurn).toHaveBeenCalledWith(expect.objectContaining({
      executionId: "benchmark-trial-1",
      intent: {
        routeId: "codex-sol",
        accountOverrideId: "subscription-a",
      },
    }));
  });

  it("allows authoritative auto that admits no tools as model-only fail-closed execution", () => {
    expect(isCanonicalAuthorityAdmissible({ completeness: "authoritative", admittedAuthority: "fail_closed" })).toBe(true);
    expect(isCanonicalAuthorityAdmissible({ completeness: "partial", admittedAuthority: "unknown" })).toBe(false);
  });

  it("denies unknown MCP effects without adding them to the admitted tool set", () => {
    const result = partitionCanonicalMcpCapabilities([
      { name: "mcp:known", effectEnvelope: { operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" } } as never,
      { name: "mcp:unknown" } as never,
      { name: "mcp:resource", tags: ["mcp", "resource"], effectEnvelope: undefined } as never,
      { name: "mcp:conservative", tags: ["mcp", "tool"], effectEnvelope: { operation: "mutate", boundaries: ["process", "workspace", "machine", "network", "external-system"], reversibility: "unknown", dataEgress: "unknown", identityUse: "unknown", consequences: ["unknown"], idempotency: "unknown" } } as never,
    ]);
    expect(result.admitted.map(({ name }) => name)).toEqual(["mcp:known"]);
    expect(result.denied.map(({ name }) => name)).toEqual(["mcp:unknown", "mcp:resource", "mcp:conservative"]);
    expect(result.denied.find(({ name }) => name === "mcp:resource")?.kind).toBe("resource");
  });

  it("intersects canonical MCP capabilities with both explicit and scoped permission selectors", () => {
    const result = intersectCanonicalMcpCapabilities([
      { name: "mcp:server:tool:read", tags: ["mcp", "tool"], effectEnvelope: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" } } as never,
      { name: "mcp:server:tool:write", tags: ["mcp", "tool"], effectEnvelope: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" } } as never,
    ], new Set(["mcp:server:tool:read", "mcp:server:tool:write"]), new Set(["mcp:server:tool:read"]));
    expect(result.admitted.map(({ name }) => name)).toEqual(["mcp:server:tool:read"]);
    expect(result.denied.map(({ name }) => name)).toEqual(["mcp:server:tool:write"]);
  });

  it("converts omitted/auto authority to authoritative fail-closed only for an empty tool set", () => {
    expect(canonicalizeOmittedAuthority(undefined, 0)).toMatchObject({ completeness: "authoritative", admittedAuthority: "fail_closed", toolCount: 0 });
    expect(canonicalizeOmittedAuthority("auto", 0)).toMatchObject({ completeness: "authoritative", admittedAuthority: "fail_closed", toolCount: 0 });
    expect(() => canonicalizeOmittedAuthority("auto", 1)).toThrow(/concrete/i);
  });
});

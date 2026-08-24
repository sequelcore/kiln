import type { ResolvedInvocationEffect } from "@kilnai/core/engine";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import { describe, expect, it, vi } from "vitest";
import {
  type RuntimeToolActionAdmissionReceipt,
  type RuntimeToolActionClaim,
  type RuntimeToolActionClaimPermit,
  type RuntimeToolActionClaimStore,
  RuntimeToolActionCommittedError,
  RuntimeToolActionDispatchService,
} from "../../src/execution-kernel/runtime-tool-action-claim.js";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";

const effect: ResolvedInvocationEffect = {
  operation: "mutate",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};

function admission(): RuntimeToolActionAdmissionReceipt {
  const revision = {
    revisionSetId: "runtime-tool-action-test",
    revisions: { test: "runtime-tool-action-test" },
  } as const;
  const turnId = canonicalTurnId("session-1", 1);
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-1",
    turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "test", revision: "test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "test", subjectId: "session-1" },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "destructive",
        admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection",
        reason: "test",
        completeness: "authoritative",
        toolCount: 0,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: {
        status: "admitted",
        decision: createOperatorAdoptionDecisionAuthority({
          ownerSessionId: "session-1",
          operatorTurnId: turnId,
          actorId: "user-1",
        }),
      },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: effect,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: {
          routeId: "route-1",
          providerId: "provider-1",
          providerModelId: "model-1",
          accountSelection: { mode: "exact", accountId: "account-1", source: "route" },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId: "route-1",
          accountId: "account-1",
          credentialId: "credential-1",
          credentialRevision: "revision-1",
        },
      },
    },
  });
}

function memoryStore(events: string[]) {
  const rows = new Map<string, RuntimeToolActionClaim>();
  const states = new WeakMap<object, { consumed: boolean; claimId: string }>();
  const store: RuntimeToolActionClaimStore = {
    claim: vi.fn((claim: RuntimeToolActionClaim) => {
      events.push("claim");
      const permit = {
        permitId: `permit:${claim.claimId}`,
        claimId: claim.claimId,
        consume: vi.fn(() => {
          const state = states.get(permit);
          if (!state || state.consumed) throw new Error("double consume");
          state.consumed = true;
          events.push("consume");
        }),
      } as unknown as RuntimeToolActionClaimPermit;
      states.set(permit, { consumed: false, claimId: claim.claimId });
      rows.set(claim.claimId, claim);
      return permit;
    }),
    settle: vi.fn(
      (permit: RuntimeToolActionClaimPermit, settlement: { kind: "success" | "unknown"; reason?: string }) => {
        const state = states.get(permit);
        if (!state?.consumed) throw new Error("unconsumed");
        const row = rows.get(permit.claimId);
        if (!row) throw new Error("missing");
        rows.set(permit.claimId, {
          ...row,
          status: settlement.kind === "success" ? "settled" : "unknown",
          unknownReason: settlement.reason,
        });
        events.push("settle");
      },
    ),
  };
  return { store, rows };
}

function input(overrides: Partial<Parameters<RuntimeToolActionDispatchService["dispatch"]>[0]> = {}) {
  const persisted = admission();
  const events: string[] = [];
  const { store } = memoryStore(events);
  return {
    admission: persisted,
    sessionId: persisted.sessionId,
    turnId: persisted.turnId,
    attemptId: "attempt-1",
    toolCallScopeId: "scope-1",
    toolCallId: "call-1",
    selector: "filesystem.write",
    normalizedInput: '{"path":"a.txt","text":"x"}',
    resolvedEffect: effect,
    adapterIdentity: "operator:builtin:filesystem.write",
    readAdmission: vi.fn(async () => {
      events.push("read");
      return persisted;
    }),
    store,
    invoke: vi.fn(async () => {
      events.push("invoke");
      return "ok";
    }),
    events,
    ...overrides,
  };
}

describe("RuntimeToolActionDispatchService", () => {
  it("reads the full admission and consumes one opaque permit immediately before one effect", async () => {
    const value = input();
    await expect(new RuntimeToolActionDispatchService(() => "2026-01-01T00:00:00.000Z").dispatch(value)).resolves.toBe(
      "ok",
    );
    expect(value.events).toEqual(["read", "claim", "consume", "invoke", "settle"]);
    expect(value.invoke).toHaveBeenCalledOnce();
  });

  it("does not claim or invoke when cancelled before the claim", async () => {
    const controller = new AbortController();
    controller.abort();
    const value = input({ abortSignal: controller.signal });
    await expect(new RuntimeToolActionDispatchService().dispatch(value)).rejects.toMatchObject({
      name: "RuntimeToolActionPreDispatchCancellationError",
    });
    expect(value.events).toEqual([]);
    expect(value.invoke).not.toHaveBeenCalled();
  });

  it("runs the final synchronous authority guard after readback and before claiming", async () => {
    const beforeClaim = vi.fn(() => {
      throw new Error("lease revoked during admission readback");
    });
    const value = input({ beforeClaim });

    await expect(new RuntimeToolActionDispatchService().dispatch(value)).rejects.toThrow(
      "lease revoked during admission readback",
    );
    expect(beforeClaim).toHaveBeenCalledOnce();
    expect(value.events).toEqual(["read"]);
    expect(value.store.claim).not.toHaveBeenCalled();
    expect(value.invoke).not.toHaveBeenCalled();
  });

  it("rejects an asynchronous before-claim guard before creating a claim", async () => {
    const value = input({ beforeClaim: vi.fn(async () => undefined) });

    await expect(new RuntimeToolActionDispatchService().dispatch(value)).rejects.toThrow(
      "beforeClaim guard must complete synchronously",
    );
    expect(value.events).toEqual(["read"]);
    expect(value.store.claim).not.toHaveBeenCalled();
    expect(value.invoke).not.toHaveBeenCalled();
  });

  it("commits unknown on a post-claim adapter failure and never offers a retry", async () => {
    const value = input({
      invoke: vi.fn(async () => {
        value.events.push("invoke");
        throw new Error("transport");
      }),
    });
    await expect(new RuntimeToolActionDispatchService().dispatch(value)).rejects.toBeInstanceOf(
      RuntimeToolActionCommittedError,
    );
    expect(value.invoke).toHaveBeenCalledOnce();
    expect(value.events).toEqual(["read", "claim", "consume", "invoke", "settle"]);
  });

  it("rejects an admission readback that is not the committed full bundle", async () => {
    const value = input({ readAdmission: vi.fn(async () => undefined) });
    await expect(new RuntimeToolActionDispatchService().dispatch(value)).rejects.toThrow("missing before claiming");
    expect(value.store.claim).not.toHaveBeenCalled();
    expect(value.invoke).not.toHaveBeenCalled();
  });
});

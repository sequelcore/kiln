import { describe, expect, it, vi } from "vitest";
import type { AgentResponse, AgentStreamEvent, CreateMessageOptions, ProviderAdapter } from "@kilnai/core/agents";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import {
  RuntimeModelRoundCommittedError,
  RuntimeModelRoundDispatchService,
  type RuntimeModelRoundActionClaim,
  type RuntimeModelRoundActionClaimPermit,
  type RuntimeModelRoundAdmissionReceipt,
} from "../../src/execution-kernel/runtime-model-round-action-claim.js";

function admission(): RuntimeModelRoundAdmissionReceipt {
  const revision = { revisionSetId: "runtime-model-round-test", revisions: { test: "runtime-model-round-test" } } as const;
  const turnId = canonicalTurnId("session-1", 1);
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-1",
    turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "test", revision: "test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "test", subjectId: "session-1" },
    },
    turn: {
      authority: {
        executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed",
        sourcePolicy: "runtime_surface_projection", reason: "test", completeness: "authoritative",
        toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: {
        status: "admitted",
        decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: "session-1", operatorTurnId: turnId, actorId: "user-1" }),
      },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: { routeId: "route-1", providerId: "provider-1", providerModelId: "model-1", accountSelection: { mode: "exact", accountId: "account-1", source: "route" } },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId: "route-1", accountId: "account-1", credentialId: "credential-1", credentialRevision: "revision-1" },
      },
    },
  });
}

function response(): AgentResponse {
  return { parts: [{ type: "text", text: "ok" }], inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: [], stopReason: "end_turn" };
}

function provider(createMessage: ProviderAdapter["createMessage"]): ProviderAdapter {
  return { name: "provider-1", createMessage, async *streamMessage() { yield { type: "done", content: "" }; } };
}

function request(): CreateMessageOptions {
  return { sessionId: "session-1", system: "system", messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }] };
}

function memoryStore() {
  const claims = new Map<string, RuntimeModelRoundActionClaim>();
  const permits = new Map<string, { readonly permit: RuntimeModelRoundActionClaimPermit; consumed: boolean }>();
  const events: string[] = [];
  return {
    claims,
    events,
    claim: vi.fn((claim: RuntimeModelRoundActionClaim): RuntimeModelRoundActionClaimPermit => {
      const permit = {
        claimId: claim.claimId,
        permitId: `permit:${claim.claimId}`,
        consume: vi.fn(() => {
          const state = permits.get(`permit:${claim.claimId}`);
          if (!state || state.consumed) throw new Error("permit already consumed");
          state.consumed = true;
          events.push("consume");
        }),
      } as RuntimeModelRoundActionClaimPermit;
      claims.set(claim.claimId, claim);
      permits.set(permit.permitId, { permit, consumed: false });
      events.push("claim");
      return permit;
    }),
    settle: vi.fn((permit: RuntimeModelRoundActionClaimPermit, settlement: { kind: "success" | "unknown"; reason?: string }) => {
      const claim = claims.get(permit.claimId);
      const state = permits.get(permit.permitId);
      if (!claim || !state || state.permit !== permit || !state.consumed) throw new Error("permit must be consumed");
      claims.set(permit.claimId, { ...claim, status: settlement.kind === "success" ? "settled" : "unknown", unknownReason: settlement.reason });
      permits.delete(permit.permitId);
      events.push("settle");
    }),
  };
}

describe("RuntimeModelRoundDispatchService", () => {
  it("reads the full persisted admission before claiming and invokes the prepared provider once", async () => {
    const store = memoryStore();
    const createMessage = vi.fn(async () => {
      store.events.push("provider");
      return response();
    });
    const persisted = admission();
    const service = new RuntimeModelRoundDispatchService(store, () => "2026-01-01T00:00:00.000Z");

    await expect(service.dispatch({
      admission: persisted,
      sessionId: "session-1",
      turnId: persisted.turnId,
      attemptId: "attempt-1",
      round: 0,
      intentFingerprint: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
      effectIdentity: `sha256:${"c".repeat(64)}` as `sha256:${string}`,
      providerRequestId: "request-1",
      routeId: "route-1",
      accountId: "account-1",
      credentialRevision: "revision-1",
      readAdmission: async () => persisted,
      provider: provider(createMessage),
      request: request(),
    })).resolves.toEqual(response());

    expect(store.claim).toHaveBeenCalledOnce();
    expect(createMessage).toHaveBeenCalledOnce();
    expect(store.events).toEqual(["claim", "consume", "provider", "settle"]);
  });

  it("marks a claimed provider failure unknown without offering a retry", async () => {
    const store = memoryStore();
    const createMessage = vi.fn(async () => {
      store.events.push("provider");
      throw new Error("transport failed");
    });
    const persisted = admission();
    const service = new RuntimeModelRoundDispatchService(store, () => "2026-01-01T00:00:00.000Z");

    await expect(service.dispatch({
      admission: persisted,
      sessionId: "session-1", turnId: persisted.turnId, attemptId: "attempt-1", round: 0,
      intentFingerprint: `sha256:${"b".repeat(64)}` as `sha256:${string}`, effectIdentity: `sha256:${"c".repeat(64)}` as `sha256:${string}`,
      providerRequestId: "request-1", routeId: "route-1", accountId: "account-1", credentialRevision: "revision-1",
      readAdmission: async () => persisted, provider: provider(createMessage), request: request(),
    })).rejects.toBeInstanceOf(RuntimeModelRoundCommittedError);

    expect(createMessage).toHaveBeenCalledOnce();
    expect(store.settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "unknown" }));
    expect(store.events).toEqual(["claim", "consume", "provider", "settle"]);
  });

  it("claims and settles one admitted provider stream, with no retry after a stream failure", async () => {
    const store = memoryStore();
    const streamMessage = vi.fn(async function* (): AsyncGenerator<AgentStreamEvent> {
      store.events.push("provider");
      yield { type: "text", content: "hello" };
      yield { type: "done", content: "" };
    });
    const persisted = admission();
    const service = new RuntimeModelRoundDispatchService(store, () => "2026-01-01T00:00:00.000Z");

    const events: AgentStreamEvent[] = [];
    for await (const event of service.dispatchStream({
      admission: persisted,
      sessionId: "session-1",
      turnId: persisted.turnId,
      attemptId: "attempt-stream-1",
      round: 0,
      intentFingerprint: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
      effectIdentity: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
      providerRequestId: "request-stream-1",
      routeId: "route-1",
      accountId: "account-1",
      credentialRevision: "revision-1",
      readAdmission: async () => persisted,
      provider: { name: "provider-1", createMessage: vi.fn(), streamMessage },
      request: request(),
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", content: "hello" },
      { type: "done", content: "" },
    ]);
    expect(streamMessage).toHaveBeenCalledOnce();
    expect(store.events).toEqual(["claim", "consume", "provider", "settle"]);
  });

  it("marks a claimed stream unknown when it throws or ends without done", async () => {
    for (const mode of ["throw", "lost"] as const) {
      const store = memoryStore();
      const streamMessage = vi.fn(async function* (): AsyncGenerator<AgentStreamEvent> {
        store.events.push("provider");
        yield { type: "text", content: "partial" };
        if (mode === "throw") throw new Error("stream failed");
      });
      const persisted = admission();
      const service = new RuntimeModelRoundDispatchService(store, () => "2026-01-01T00:00:00.000Z");

      await expect((async () => {
        for await (const _event of service.dispatchStream({
          admission: persisted,
          sessionId: "session-1",
          turnId: persisted.turnId,
          attemptId: `attempt-stream-${mode}`,
          round: 0,
          intentFingerprint: `sha256:${"f".repeat(64)}` as `sha256:${string}`,
          effectIdentity: `sha256:${"a".repeat(64)}` as `sha256:${string}`,
          providerRequestId: `request-stream-${mode}`,
          routeId: "route-1",
          accountId: "account-1",
          credentialRevision: "revision-1",
          readAdmission: async () => persisted,
          provider: { name: "provider-1", createMessage: vi.fn(), streamMessage },
          request: request(),
        })) {
          void _event;
        }
      })()).rejects.toBeInstanceOf(RuntimeModelRoundCommittedError);
      expect(store.events).toEqual(["claim", "consume", "provider", "settle"]);
      expect(store.settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "unknown" }));
    }
  });

  it("does not attempt a contradictory settlement when streamed success settlement fails", async () => {
    const store = memoryStore();
    store.settle.mockImplementation(() => {
      throw new Error("success settlement outcome is unknown");
    });
    const persisted = admission();
    const streamMessage = vi.fn(async function* (): AsyncGenerator<AgentStreamEvent> {
      store.events.push("provider");
      yield { type: "done", content: "" };
    });
    const service = new RuntimeModelRoundDispatchService(store, () => "2026-01-01T00:00:00.000Z");

    await expect((async () => {
      for await (const event of service.dispatchStream({
        admission: persisted,
        sessionId: "session-1",
        turnId: persisted.turnId,
        attemptId: "attempt-stream-settlement-failure",
        round: 0,
        intentFingerprint: `sha256:${"8".repeat(64)}` as `sha256:${string}`,
        effectIdentity: `sha256:${"9".repeat(64)}` as `sha256:${string}`,
        providerRequestId: "request-stream-settlement-failure",
        routeId: "route-1",
        accountId: "account-1",
        credentialRevision: "revision-1",
        readAdmission: async () => persisted,
        provider: { name: "provider-1", createMessage: vi.fn(), streamMessage },
        request: request(),
      })) {
        void event;
      }
    })()).rejects.toBeInstanceOf(RuntimeModelRoundCommittedError);

    expect(streamMessage).toHaveBeenCalledOnce();
    expect(store.settle).toHaveBeenCalledOnce();
    expect(store.settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "success" }));
  });
});

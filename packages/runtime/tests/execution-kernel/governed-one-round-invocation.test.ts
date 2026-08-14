import { describe, expect, it, vi } from "vitest";
import {
  createExecutionAccountRef,
  type ModelTurnResult,
} from "@kilnai/core";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import {
  GovernedOneRoundCommittedError,
  invokeGovernedOneRound,
  type GovernedOneRoundInvocationPorts,
} from "../../src/execution-kernel/governed-one-round-invocation.js";
import { ProviderDispatchTerminalError } from "../../src/execution-kernel/provider-dispatch-terminal-error.js";

const route = {
  providerId: "fixture",
  providerModelId: "model",
  scope: "virtual:fixture",
};
const admission = {
  routeId: "route",
  providerId: route.providerId,
  providerModelId: route.providerModelId,
  accountSelection: { mode: "exact" as const, accountId: "account", source: "route" as const },
};
const result: ModelTurnResult = {
  parts: [{ type: "text", text: "ok" }],
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  stopReason: "completed",
};
function fixture() {
  const authority = new SqliteManagedAccountLeaseAuthority({
    path: ":memory:",
    participantKind: "model-gateway-ingress",
    recoveryDomain: `test-${crypto.randomUUID()}`,
    configurationRevision: "test",
  });
  const events: string[] = [];
  let resolved = 0;
  let dispatched = 0;
  const ports: GovernedOneRoundInvocationPorts = {
    candidateCatalog: {
      list: async () => ({
        admission,
        candidates: [{
          candidate: {
            accountId: "account",
            safety: "eligible",
            health: "healthy",
            quota: "available",
            capacity: "available",
            economicCost: { atoms: "0", scale: 0, unit: "request", scheme: { kind: "unit" } },
            pressure: 0,
          },
          lease: {
            candidate: {
              account: createExecutionAccountRef("account"),
              route,
              health: "healthy",
              leaseCapacity: "available",
              pressure: 0,
              reservedForNewWork: false,
            },
            capacityIdentity: "configured:fixture:account",
            credentialRevisionId: "a".repeat(64),
            usageEvidence: { health: "healthy", freshness: "missing" },
            capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 },
          },
        }],
      }),
    },
    accountCapacityAuthority: authority,
    attemptEvidence: {
      record: async (event) => {
        events.push(event.phase);
      },
    },
    dispatcherResolver: {
      resolve: async () => {
        resolved += 1;
        return {
          dispatchOneRound: async () => {
            dispatched += 1;
            return result;
          },
        };
      },
    },
  };
  return {
    authority,
    ports,
    events,
    get resolved() {
      return resolved;
    },
    get dispatched() {
      return dispatched;
    },
  };
}
function input(id = "attempt") {
  return {
    attemptId: id,
    identity: {
      tenantId: "tenant",
      applicationId: "app",
      callerId: "caller",
      sessionId: "session",
      turnId: "turn",
    },
    route,
    authority: {
      status: "admitted" as const,
      capabilityId: "cap",
      scopes: ["model.invoke"],
    },
    budget: { status: "admitted" as const, evidenceId: "budget" },
    affinity: { continuity: "prefer" as const, key: "session" },
    toolExecutionMode: "caller-owned" as const,
    turn: {
      history: [
        {
          role: "user" as const,
          parts: [{ type: "text" as const, text: "hello" }],
        },
      ],
    },
  };
}

function capacityInputFor(runtimeInvocationId: string) {
  return {
    runtimeInvocationId,
    intentFingerprint: `sha256:${"b".repeat(64)}`,
    accountPolicyId: "policy" as never,
    route,
    candidates: [{
      candidate: {
        account: createExecutionAccountRef("account"),
        route,
        health: "healthy" as const,
        leaseCapacity: "available" as const,
        pressure: 0,
        reservedForNewWork: false,
      },
      capacityIdentity: "configured:fixture:account",
      credentialRevisionId: "a".repeat(64),
      usageEvidence: { health: "healthy" as const, freshness: "missing" as const },
      capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 },
    }],
  } as const;
}

describe("governed one-round capacity", () => {
  it("runs the lifecycle hook before fencing and resolves credentials only after the dispatch fence", async () => {
    const value = fixture();
    const order: string[] = [];
    const ports = {
      ...value.ports,
      dispatcherResolver: {
        resolve: async () => {
          order.push(value.authority.recoverAccountCapacity()[0]!.state);
          return {
            dispatchOneRound: async () => {
              order.push(value.authority.recoverAccountCapacity()[0]!.state);
              return result;
            },
          };
        },
      },
    };
    await invokeGovernedOneRound({ ...input(), lifecycle: { afterCommittedBeforeDispatch: () => { order.push(`hook:${value.authority.recoverAccountCapacity()[0]!.state}`); } } }, ports);
    expect(order).toEqual(["hook:held", "dispatch-fenced", "dispatch-fenced"]);
    expect(value.events).toEqual([
      "planned",
      "leased",
      "dispatching",
      "committed",
      "succeeded",
    ]);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("retains an unknown outcome while freeing local capacity when dispatcher resolution fails", async () => {
    const value = fixture();
    await expect(
      invokeGovernedOneRound(input(), {
        ...value.ports,
        dispatcherResolver: {
          resolve: async () => {
            throw new Error("credential unavailable");
          },
        },
      }),
    ).rejects.toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(value.authority.recoverAccountCapacity()).toMatchObject([
      { state: "settlement-pending" },
    ]);
    expect(value.authority.acquireAccountCapacity(capacityInputFor("next-attempt")))
      .toMatchObject({ status: "acquired", replay: false });
    value.authority.close();
  });

  it.each(["planned", "leased", "dispatching"] as const)(
    "releases held capacity when %s evidence fails before the fence",
    async (phase) => {
      const value = fixture();
      await expect(
        invokeGovernedOneRound(input(), {
          ...value.ports,
          attemptEvidence: {
            record: async (event) => {
              if (event.phase === phase)
                throw new Error("evidence unavailable");
            },
          },
        }),
      ).rejects.toThrow("evidence unavailable");
      expect(value.authority.recoverAccountCapacity()).toEqual([]);
      value.authority.close();
    },
  );

  it("treats post-fence evidence as best effort and still dispatches", async () => {
    const value = fixture();
    const output = await invokeGovernedOneRound(input(), {
      ...value.ports,
      attemptEvidence: {
        record: async (event) => {
          if (event.phase === "succeeded")
            throw new Error("evidence unavailable");
        },
      },
    });
    expect(output.result).toBe(result);
    expect(output.closeout.diagnostics).toContainEqual({
      code: "terminal-evidence-failed",
      phase: "succeeded",
    });
    expect(value.dispatched).toBe(1);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("releases pre-fence when the committed lifecycle hook fails without dispatching", async () => {
    const value = fixture();
    const failure = await invokeGovernedOneRound(
      { ...input(), lifecycle: { afterCommittedBeforeDispatch: () => { throw new Error("replay hook failed"); } } },
      value.ports,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(value.dispatched).toBe(0);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("records secret-free settlement failure and retains fenced capacity", async () => {
    const value = fixture();
    vi.spyOn(value.authority, "settleAccountCapacity").mockImplementation(() => { throw new Error("settlement unavailable"); });
    const evidence: unknown[] = [];
    const output = await invokeGovernedOneRound(input(), {
      ...value.ports,
      attemptEvidence: { record: async (event) => { evidence.push(event); } },
    });
    expect(output.closeout.diagnostics).toContainEqual({ code: "capacity-settlement-failed", phase: "succeeded" });
    expect(evidence).toContainEqual(expect.objectContaining({ settlement: "failed" }));
    expect(JSON.stringify(evidence)).not.toMatch(/secret|token|authorization|password/i);
    expect(value.authority.recoverAccountCapacity()[0]).toMatchObject({ state: "dispatch-fenced" });
    value.authority.close();
  });

  it("preserves a post-fence provider failure as unknown while releasing the local slot", async () => {
    const value = fixture();
    const failure = await invokeGovernedOneRound(input(), {
      ...value.ports,
      dispatcherResolver: {
        resolve: async () => ({
          dispatchOneRound: async () => {
            throw new Error("provider failed");
          },
        }),
      },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(value.authority.recoverAccountCapacity()[0]).toMatchObject({
      state: "settlement-pending",
    });
    expect(value.authority.acquireAccountCapacity(capacityInputFor("next-attempt")))
      .toMatchObject({ status: "acquired", replay: false });
    value.authority.close();
  });

  it("settles an exact rejected provider response as terminal provider-error", async () => {
    const value = fixture();
    const failure = await invokeGovernedOneRound(input(), {
      ...value.ports,
      dispatcherResolver: {
        resolve: async () => ({
          dispatchOneRound: async () => {
            throw new ProviderDispatchTerminalError({
              outcome: "provider-error",
              requestId: "attempt:dispatch",
              status: 503,
              observedAt: "2026-08-13T20:00:00.000Z",
            }, new Error("provider payload is not durable evidence"));
          },
        }),
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("rejects an idempotent capacity replay before resolving credentials again", async () => {
    const value = fixture();
    await invokeGovernedOneRound(input(), value.ports);
    await expect(
      invokeGovernedOneRound(input(), value.ports),
    ).rejects.toMatchObject({ code: "lease-conflict" });
    expect(value.resolved).toBe(1);
    expect(value.dispatched).toBe(1);
    value.authority.close();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createExecutionAccountRef, type ModelTurnResult } from "@kilnai/core/agents";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import {
  GovernedOneRoundCommittedError,
  invokeGovernedOneRound,
  type GovernedOneRoundInvocationPorts,
} from "../../src/execution-kernel/governed-one-round-invocation.js";
import { ProviderDispatchTerminalError } from "../../src/execution-kernel/provider-dispatch-terminal-error.js";
import type { EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";

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
          dispatcher: {
            dispatchOneRound: async () => {
              dispatched += 1;
              return result;
            },
          },
          binding: { status: "bound", routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) },
        };
      },
    },
    budgetAdmission: {
      admit: async () => ({ status: "admitted", reason: "observed-below-limit", observation: { observedTokens: 1, source: "fixture" } }),
    },
    authorityAdmission: {
      compose: async () => ({}) as EffectiveAuthorityAdmissionBundle,
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
  it("reads the live budget before candidate or capacity admission", async () => {
    const value = fixture();
    const order: string[] = [];
    const ports = {
      ...value.ports,
      budgetAdmission: { admit: async () => { order.push("budget"); return { status: "denied" as const, reason: "usage-unknown" as const, action: "stop" as const, message: "unknown" }; } },
      candidateCatalog: { list: async () => { order.push("candidates"); throw new Error("must not select"); } },
    };
    await expect(invokeGovernedOneRound(input(), ports)).rejects.toMatchObject({ code: "budget-denied" });
    expect(order).toEqual(["budget"]);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("composes and commits the bundle after the exact post-fence binding and before dispatch", async () => {
    const value = fixture();
    const order: string[] = [];
    const bundle = { admissionId: "sha256:test" } as EffectiveAuthorityAdmissionBundle;
    const ports = {
      ...value.ports,
      dispatcherResolver: { resolve: async () => {
        order.push("resolve");
        return {
          dispatcher: { dispatchOneRound: async () => { order.push("dispatch"); return result; } },
          binding: { status: "bound" as const, routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) },
        };
      } },
      authorityAdmission: { compose: async ({ binding }: { readonly binding: { readonly accountId: string; readonly credentialRevision: string } }) => {
        order.push(`compose:${binding.accountId}:${binding.credentialRevision}`);
        return bundle;
      } },
    };
    await invokeGovernedOneRound({ ...input(), lifecycle: { afterCommittedBeforeDispatch: ({ bundle: admitted }) => {
      expect(admitted).toBe(bundle);
      order.push("commit");
    } } }, ports);
    expect(order).toEqual(["resolve", `compose:account:${"a".repeat(64)}`, "commit", "dispatch"]);
    value.authority.close();
  });

  it("resolves credentials, composes authority, and runs the lifecycle hook only after the dispatch fence", async () => {
    const value = fixture();
    const order: string[] = [];
    const ports = {
      ...value.ports,
      dispatcherResolver: {
        resolve: async () => {
          order.push(value.authority.recoverAccountCapacity()[0]!.state);
          return {
            dispatcher: {
              dispatchOneRound: async () => {
                order.push(value.authority.recoverAccountCapacity()[0]!.state);
                return result;
              },
            },
            binding: { status: "bound", routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) },
          };
        },
      },
    };
    await invokeGovernedOneRound({ ...input(), lifecycle: { afterCommittedBeforeDispatch: () => { order.push(`hook:${value.authority.recoverAccountCapacity()[0]!.state}`); } } }, ports);
    expect(order).toEqual(["dispatch-fenced", "hook:dispatch-fenced", "dispatch-fenced"]);
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
    ).rejects.toThrow("credential unavailable");
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
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

  it("settles the fenced capacity when authority commit fails without dispatching", async () => {
    const value = fixture();
    const failure = await invokeGovernedOneRound(
      { ...input(), lifecycle: { afterCommittedBeforeDispatch: () => { throw new Error("replay hook failed"); } } },
      value.ports,
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: "replay hook failed" });
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
          dispatcher: {
            dispatchOneRound: async () => {
              throw new Error("provider failed");
            },
          },
          binding: { status: "bound", routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) },
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
          dispatcher: {
            dispatchOneRound: async () => {
              throw new ProviderDispatchTerminalError({
                outcome: "provider-error",
                requestId: "attempt:dispatch",
                status: 503,
                observedAt: "2026-08-13T20:00:00.000Z",
              }, new Error("provider payload is not durable evidence"));
            },
          },
          binding: { status: "bound", routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) },
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

import { describe, expect, it, vi } from "vitest";
import { createExecutionAccountRef, type ModelTurnResult } from "@kilnai/core/agents";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import {
  GovernedOneRoundCommittedError,
  invokeGovernedOneRound,
  type GovernedOneRoundInvocationPorts,
} from "../../src/execution-kernel/governed-one-round-invocation.js";
import { ProviderDispatchTerminalError } from "../../src/execution-kernel/provider-dispatch-terminal-error.js";
import { defineEffectiveAuthorityAdmissionBundle, type EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { createGovernedOneRoundDispatchPermit } from "../../src/execution-kernel/dispatch-permit.js";

const route = { routeId: "route", providerId: "fixture", providerModelId: "model", scope: "virtual:fixture" } as const;
const admission = { routeId: "route", providerId: route.providerId, providerModelId: route.providerModelId, accountSelection: { mode: "exact" as const, accountId: "account", source: "route" as const } };
const result: ModelTurnResult = { parts: [{ type: "text", text: "ok" }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" };

function bundle(): EffectiveAuthorityAdmissionBundle {
  const revision = { revisionSetId: "kernel-test", revisions: { modelGateway: ("sha256:" + "a".repeat(64)) as `sha256:${string}` } } as const;
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session", turnId: "turn", admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: { skillCatalog: { catalogId: "kernel", revision: ("sha256:" + "b".repeat(64)) as `sha256:${string}`, skillIds: [] }, authorityCeiling: { maximumAuthority: "read_only", reason: "fixture" } },
    turn: {
      authority: { executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "read_only", sourcePolicy: "runtime_surface_projection", reason: "fixture", completeness: "authoritative", toolCount: 0, deniedToolCount: 0 },
      workGovernance: { status: "not-required" }, operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [], callerOwnedToolContract: { names: [], digest: ("sha256:" + "c".repeat(64)) as `sha256:${string}` } },
      effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
      budget: { status: "not-configured" },
      execution: { status: "routed", route: admission, dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } }, binding: { status: "bound", routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) } },
    },
  });
}

function fixture() {
  const authority = new SqliteManagedAccountLeaseAuthority({ path: ":memory:", participantKind: "model-gateway-ingress", recoveryDomain: `kernel-test-${crypto.randomUUID()}`, configurationRevision: "test" });
  const events: string[] = [];
  let dispatched = 0;
  const accountCapacityAuthority = {
    acquireAccountCapacity: (...args: Parameters<typeof authority.acquireAccountCapacity>) => authority.acquireAccountCapacity(...args),
    releaseAccountCapacityPreFence: (...args: Parameters<typeof authority.releaseAccountCapacityPreFence>) => authority.releaseAccountCapacityPreFence(...args),
    fenceAccountCapacityDispatch: (runtimeInvocationId: string, dispatchFenceId: string) => {
      events.push("capacity-fence");
      return authority.fenceAccountCapacityDispatch(runtimeInvocationId, dispatchFenceId);
    },
    settleAccountCapacity: (...args: Parameters<typeof authority.settleAccountCapacity>) => authority.settleAccountCapacity(...args),
  };
  const ports: GovernedOneRoundInvocationPorts = {
    candidateCatalog: { list: async () => ({ admission, candidates: [{ candidate: { accountId: "account", safety: "eligible", health: "healthy", quota: "available", capacity: "available", economicCost: { atoms: "0", scale: 0, unit: "request", scheme: { kind: "unit" } }, pressure: 0 }, lease: { candidate: { account: createExecutionAccountRef("account"), route, health: "healthy", leaseCapacity: "available", pressure: 0, reservedForNewWork: false }, capacityIdentity: "configured:fixture:account", credentialRevisionId: "a".repeat(64), usageEvidence: { health: "healthy", freshness: "missing" }, capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 } } }] }) },
    accountCapacityAuthority,
    attemptEvidence: { record: async (event) => { events.push(`evidence:${event.phase}`); } },
    dispatcherResolver: { resolve: async () => { events.push(`resolve:${authority.recoverAccountCapacity()[0]?.state}`); return { dispatcher: { dispatchOneRound: async () => { events.push(`dispatch:${authority.recoverAccountCapacity()[0]?.state}`); dispatched += 1; return result; } }, binding: { status: "bound", routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) } }; } },
    budgetAdmission: { admit: async () => ({ status: "admitted", reason: "observed-below-limit", observation: { observedTokens: 1, source: "fixture" } }) },
    authorityAdmission: { compose: async () => { events.push("compose"); return bundle(); } },
    admissionEvidence: { persistAndReadback: async (admitted) => { events.push("persist"); return { attemptId: "attempt", admissionId: admitted.admissionId, bundle: admitted }; } },
    dispatchClaim: { claim: () => { events.push("action-claim"); return createGovernedOneRoundDispatchPermit(); } },
  };
  return { authority, ports, events, get dispatched() { return dispatched; } };
}

function input() {
  return {
    attemptId: "attempt",
    identity: { tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn" },
    route, authority: { status: "admitted" as const, capabilityId: "cap", scopes: ["model.invoke"] }, budget: { status: "admitted" as const, evidenceId: "budget" },
    affinity: { continuity: "prefer" as const, key: "session" }, toolExecutionMode: "caller-owned" as const,
    turn: { history: [{ role: "user" as const, parts: [{ type: "text" as const, text: "hello" }] }] },
  };
}

describe("governed one-round capacity and dispatch", () => {
  it("reads live budget before candidate or capacity admission", async () => {
    const value = fixture();
    const order: string[] = [];
    const ports = { ...value.ports, budgetAdmission: { admit: async () => { order.push("budget"); return { status: "denied" as const, reason: "usage-unknown" as const, action: "stop" as const, message: "unknown" }; } }, candidateCatalog: { list: async () => { order.push("candidates"); throw new Error("must not select"); } } };
    await expect(invokeGovernedOneRound(input(), ports)).rejects.toMatchObject({ code: "budget-denied" });
    expect(order).toEqual(["budget"]);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("completes the recoverable capacity transition before the final action claim", async () => {
    const value = fixture();
    await invokeGovernedOneRound(input(), value.ports);
    expect(value.events).toEqual(expect.arrayContaining(["resolve:held", "compose", "persist", "action-claim", "capacity-fence", "dispatch:dispatch-fenced"]));
    expect(value.events.indexOf("resolve:held")).toBeLessThan(value.events.indexOf("persist"));
    expect(value.events.indexOf("persist")).toBeLessThan(value.events.indexOf("capacity-fence"));
    expect(value.events.indexOf("capacity-fence")).toBeLessThan(value.events.indexOf("action-claim"));
    expect(value.events.indexOf("action-claim")).toBeLessThan(value.events.indexOf("dispatch:dispatch-fenced"));
    expect(value.events.indexOf("dispatch:dispatch-fenced")).toBeLessThan(value.events.indexOf("evidence:committed"));
    expect(value.dispatched).toBe(1);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("releases held capacity when adapter preparation fails before the action claim", async () => {
    const value = fixture();
    await expect(invokeGovernedOneRound(input(), { ...value.ports, dispatcherResolver: { resolve: async () => { throw new Error("credential unavailable"); } } })).rejects.toThrow("credential unavailable");
    expect(value.dispatched).toBe(0);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("does not dispatch when the canonical action claim fails", async () => {
    const value = fixture();
    await expect(invokeGovernedOneRound(input(), { ...value.ports, dispatchClaim: { claim: () => { throw new Error("claim unavailable"); } } })).rejects.toThrow("claim unavailable");
    expect(value.dispatched).toBe(0);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("does not claim or dispatch when the recoverable capacity transition fails", async () => {
    const value = fixture();
    const claim = vi.fn(() => createGovernedOneRoundDispatchPermit());
    await expect(invokeGovernedOneRound(input(), {
      ...value.ports,
      accountCapacityAuthority: {
        ...value.ports.accountCapacityAuthority,
        fenceAccountCapacityDispatch: () => { throw new Error("capacity fence unavailable"); },
      },
      dispatchClaim: { claim },
    })).rejects.toThrow("capacity fence unavailable");
    expect(claim).not.toHaveBeenCalled();
    expect(value.dispatched).toBe(0);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("checks cancellation immediately before the capacity fence", async () => {
    const value = fixture();
    const controller = new AbortController();
    const ports = {
      ...value.ports,
      admissionEvidence: {
        persistAndReadback: async (admitted: EffectiveAuthorityAdmissionBundle) => {
          controller.abort();
          return { attemptId: "attempt", admissionId: admitted.admissionId, bundle: admitted };
        },
      },
    };
    await expect(invokeGovernedOneRound({ ...input(), signal: controller.signal }, ports)).rejects.toMatchObject({ code: "aborted" });
    expect(value.events).not.toContain("capacity-fence");
    expect(value.events).not.toContain("action-claim");
    expect(value.dispatched).toBe(0);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("cancels before the final action claim when cancellation arrives during the capacity transition", async () => {
    const value = fixture();
    const controller = new AbortController();
    const ports = {
      ...value.ports,
      accountCapacityAuthority: {
        ...value.ports.accountCapacityAuthority,
        fenceAccountCapacityDispatch: (runtimeInvocationId: string, dispatchFenceId: string) => {
          const lease = value.ports.accountCapacityAuthority.fenceAccountCapacityDispatch(runtimeInvocationId, dispatchFenceId);
          controller.abort();
          return lease;
        },
      },
    };
    await expect(invokeGovernedOneRound({ ...input(), signal: controller.signal }, ports)).rejects.toMatchObject({ code: "aborted" });
    expect(value.events).not.toContain("action-claim");
    expect(value.dispatched).toBe(0);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("releases capacity when pre-fence attempt evidence fails", async () => {
    const value = fixture();
    await expect(invokeGovernedOneRound(input(), { ...value.ports, attemptEvidence: { record: async () => { throw new Error("evidence unavailable"); } } })).rejects.toThrow("evidence unavailable");
    expect(value.dispatched).toBe(0);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("reports terminal evidence closeout failure without reopening the action", async () => {
    const value = fixture();
    const resultValue = await invokeGovernedOneRound(input(), { ...value.ports, attemptEvidence: { record: async (event) => { if (event.phase === "succeeded") throw new Error("terminal evidence unavailable"); } } });
    expect(resultValue.closeout).toMatchObject({ status: "incomplete", diagnostics: [{ code: "terminal-evidence-failed", phase: "succeeded" }] });
    expect(value.dispatched).toBe(1);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("retains consuming capacity when settlement closeout fails", async () => {
    const value = fixture();
    vi.spyOn(value.authority, "settleAccountCapacity").mockImplementation(() => { throw new Error("settlement unavailable"); });
    const resultValue = await invokeGovernedOneRound(input(), value.ports);
    expect(resultValue.closeout).toMatchObject({ status: "incomplete", diagnostics: [{ code: "capacity-settlement-failed", phase: "succeeded" }] });
    expect(value.authority.recoverAccountCapacity()[0]).toMatchObject({ state: "dispatch-fenced" });
    value.authority.close();
  });

  it("retains an unknown outcome after the one-use action claim and provider transport failure", async () => {
    const value = fixture();
    const failure = await invokeGovernedOneRound(input(), { ...value.ports, dispatcherResolver: { resolve: async () => ({ dispatcher: { dispatchOneRound: async () => { throw new Error("provider failed"); } }, binding: { status: "bound", routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) } }) } }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(value.authority.recoverAccountCapacity()[0]).toMatchObject({ state: "settlement-pending" });
    value.authority.close();
  });

  it("settles an exact provider rejection as terminal provider-error", async () => {
    const value = fixture();
    const failure = await invokeGovernedOneRound(input(), { ...value.ports, dispatcherResolver: { resolve: async () => ({ dispatcher: { dispatchOneRound: async () => { throw new ProviderDispatchTerminalError({ outcome: "provider-error", requestId: "attempt:capacity", status: 503, observedAt: "2026-08-22T00:00:00.000Z" }, new Error("provider rejected")); } }, binding: { status: "bound", routeId: admission.routeId, accountId: "account", credentialId: "credential", credentialRevision: "a".repeat(64) } }) } }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(value.authority.recoverAccountCapacity()).toEqual([]);
    value.authority.close();
  });

  it("does not resolve the adapter twice for an idempotent capacity replay", async () => {
    const value = fixture();
    await invokeGovernedOneRound(input(), value.ports);
    await expect(invokeGovernedOneRound(input(), value.ports)).rejects.toMatchObject({ code: "lease-conflict" });
    expect(value.dispatched).toBe(1);
    value.authority.close();
  });
});

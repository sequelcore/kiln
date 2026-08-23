import { describe, expect, it, vi } from "vitest";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import type { ProviderAdapter } from "@kilnai/core/agents";
import type { Capability, ResolvedInvocationEffect, ToolAuthorizer } from "@kilnai/core/engine";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { RuntimeSessionToolExecutor } from "../../src/session/runtime-session-orchestrator-tool-executor.js";
import type { OrchestratorDeps, PerCallToolConfig, RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.types.js";
import type {
  RuntimeToolActionClaim,
  RuntimeToolActionClaimPermit,
  RuntimeToolActionClaimStore,
  RuntimeToolActionClaimsContext,
} from "../../src/execution-kernel/runtime-tool-action-claim.js";

const EFFECT: ResolvedInvocationEffect = {
  operation: "mutate", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none",
  identityUse: "none", consequences: ["local-state"], idempotency: "idempotent",
};

const READ_EFFECT: ResolvedInvocationEffect = {
  operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none",
  identityUse: "none", consequences: [], idempotency: "idempotent",
};

function store(events: string[] = []) {
  const rows = new Map<string, RuntimeToolActionClaim>();
  const consumed = new WeakSet<object>();
  const actionStore: RuntimeToolActionClaimStore = {
    claim: vi.fn((claim: RuntimeToolActionClaim) => {
      events.push("claim");
      const permit = {
        claimId: claim.claimId,
        permitId: `permit:${claim.claimId}`,
        consume: vi.fn(() => {
          if (consumed.has(permit)) throw new Error("double consume");
          consumed.add(permit);
          events.push("consume");
        }),
      } as unknown as RuntimeToolActionClaimPermit;
      rows.set(claim.claimId, claim);
      return permit;
    }),
    settle: vi.fn((permit: RuntimeToolActionClaimPermit, settlement: { kind: "success" | "unknown"; reason?: string }) => {
      events.push("settle");
      const claim = rows.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("permit not consumed");
      rows.set(permit.claimId, { ...claim, status: settlement.kind === "success" ? "settled" : "unknown", unknownReason: settlement.reason });
    }),
  };
  return { actionStore, rows, events };
}

function admission(
  sessionId: string,
  turnId: string,
  toolAuthority = { level: 2 as const, allowed: true, requiresApproval: false, reason: "test" },
  toolName = "write_data",
  toolEffect: ResolvedInvocationEffect = EFFECT,
) {
  const revision = { revisionSetId: "tool-executor-test", revisions: { test: "tool-executor-test" } } as const;
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId, turnId, admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "test", revision: "test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "test", subjectId: sessionId },
    },
    turn: {
      authority: {
        executionMode: "execute", requestedAuthority: "destructive", admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection", reason: "test", completeness: "authoritative",
        toolCount: 1, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: {
        status: "admitted",
        decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: sessionId, operatorTurnId: turnId, actorId: "operator" }),
      },
      tools: { allowedToolPermissions: [{ toolName, authority: toolAuthority, effectEnvelope: toolEffect }], deniedToolNames: [] },
      effectCeiling: toolEffect,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: { routeId: "route-1", providerId: "provider-1", providerModelId: "model-1", accountSelection: { mode: "exact", accountId: "account-1", source: "route" } },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "test" } },
        binding: { status: "bound", routeId: "route-1", accountId: "account-1", credentialId: "credential-1", credentialRevision: "revision-1" },
      },
    },
  });
}

function claimsContext(
  session: RuntimeSession,
  turnId: string,
  actionStore: RuntimeToolActionClaimStore,
  state?: RuntimeToolActionClaimsContext["state"],
  toolAuthority?: Parameters<typeof admission>[2],
  toolName = "write_data",
  toolEffect: ResolvedInvocationEffect = EFFECT,
): RuntimeToolActionClaimsContext {
  const bundle = admission(session.id, turnId, toolAuthority, toolName, toolEffect);
  return {
    admission: bundle,
    attemptId: "attempt-1",
    adapterIdentity: "test:builtin",
    readAdmission: async () => bundle,
    store: actionStore,
    ...(state ? { state } : {}),
  };
}

function provider(): ProviderAdapter {
  return { name: "test", createMessage: vi.fn(), async *streamMessage() { yield { type: "done", content: "" }; } };
}

function baseDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return { provider: provider(), ...overrides };
}

function executor(deps: OrchestratorDeps, requestApproval = vi.fn(async () => ({ approved: true }))) {
  return new RuntimeSessionToolExecutor(deps, undefined, requestApproval, vi.fn());
}

describe("RuntimeSessionToolExecutor consequential action boundary", () => {
  it("claims and invokes a mutation exactly once, with no capability retry or fallback", async () => {
    const events: string[] = [];
    const action = vi.fn(async () => { events.push("invoke"); return "written"; });
    const fallback = vi.fn(async () => "fallback");
    const { actionStore } = store(events);
    const session = new RuntimeSession({ appName: "test", tenantId: "tenant", userId: "user" });
    const capability: Capability = {
      name: "write_data", description: "write", schema: {}, tags: [], effectEnvelope: EFFECT,
      retry: { maxAttempts: 3, onTransientError: "exponential", fallback: "fallback_data" },
    };
    const claims = claimsContext(session, "turn-1", actionStore);
    const result = await executor(baseDeps({
      builtinTools: new Map([["write_data", action], ["fallback_data", fallback]]),
      capabilityMap: new Map([["write_data", capability]]),
    })).executeToolCalls(session, [{ id: "call-1", name: "write_data", input: { value: 1 } }], "turn-1:response:1", {
      perCallCapabilities: new Map([["write_data", capability]]),
      authorityAdmission: claims.admission,
      runtimeToolActionClaims: claims,
    });
    expect(result.toolExecutions[0]?.success).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(events).toEqual(["claim", "consume", "invoke", "settle"]);
  });

  it("uses the persisted bundle authority and effect over execution capability metadata", async () => {
    const { actionStore, rows } = store();
    const action = vi.fn(async () => "written");
    const session = new RuntimeSession({ appName: "test", tenantId: "tenant", userId: "user" });
    const legacyCapability: Capability = { name: "write_data", description: "write", schema: {}, tags: [], effectEnvelope: READ_EFFECT };
    const claims = claimsContext(session, "turn-1", actionStore);
    const result = await executor(baseDeps({
      builtinTools: new Map([["write_data", action]]), capabilityMap: new Map([["write_data", legacyCapability]]),
    })).executeToolCalls(session, [{ id: "call-1", name: "write_data", input: {} }], "turn-1:response:1", {
      perCallCapabilities: new Map([["write_data", legacyCapability]]),
      authorityAdmission: claims.admission,
      runtimeToolActionClaims: claims,
    });
    expect(result.toolExecutions[0]?.success).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    expect([...rows.values()][0]?.resolvedEffect).toEqual(EFFECT);
  });

  it("fails closed without a durable consequential claim context", async () => {
    const action = vi.fn(async () => "must not run");
    const session = new RuntimeSession({ appName: "test", tenantId: "tenant", userId: "user" });
    const capability: Capability = { name: "write_data", description: "write", schema: {}, tags: [], effectEnvelope: EFFECT };
    const bundle = admission(session.id, "turn-1");
    const result = await executor(baseDeps({ builtinTools: new Map([["write_data", action]]), capabilityMap: new Map([["write_data", capability]]) }))
      .executeToolCalls(session, [{ id: "call-1", name: "write_data", input: {} }], "turn-1:response:1", { authorityAdmission: bundle, perCallCapabilities: new Map([["write_data", capability]]) });
    expect(action).not.toHaveBeenCalled();
    expect(result.toolExecutions[0]?.success).toBe(false);
    expect(result.resultParts[0]?.content).toContain("claim context");
  });

  it("treats MCP as consequential even when its declared envelope says observe", async () => {
    const { actionStore, events } = store();
    const executeCapability = vi.fn(async () => "mcp-result");
    const mcp = { serverName: "server", executeCapability };
    const session = new RuntimeSession({ appName: "test", tenantId: "tenant", userId: "user" });
    const capability: Capability = { name: "mcp:server:tool", description: "mcp", schema: {}, tags: [], effectEnvelope: READ_EFFECT };
    const claims = claimsContext(session, "turn-1", actionStore, undefined, undefined, capability.name, READ_EFFECT);
    const result = await executor(baseDeps({ mcpClients: [mcp] as never, capabilityMap: new Map([[capability.name, capability]]) }))
      .executeToolCalls(session, [{ id: "call-1", name: capability.name, input: {} }], "turn-1:response:1", {
        perCallCapabilities: new Map([[capability.name, capability]]),
        authorityAdmission: claims.admission,
        runtimeToolActionClaims: claims,
      });
    expect(executeCapability).toHaveBeenCalledOnce();
    expect(result.toolExecutions[0]?.success).toBe(true);
    expect(events).toEqual(["claim", "consume", "settle"]);
  });

  it("does not invoke the live approval callback after the claim boundary", async () => {
    const { actionStore } = store();
    const requestApproval = vi.fn(async () => ({ approved: true }));
    let effectExecuted = false;
    const action = vi.fn(async (_input: Record<string, unknown>, context: RuntimeBuiltinToolExecutionContext | undefined) =>
      {
        await context?.requestApproval?.("new approval after claim");
        effectExecuted = true;
        return "written";
      });
    const session = new RuntimeSession({ appName: "test", tenantId: "tenant", userId: "user" });
    const capability: Capability = { name: "write_data", description: "write", schema: {}, tags: [], effectEnvelope: EFFECT };
    const authority = { level: 2 as const, allowed: false, requiresApproval: true, reason: "operator approval" };
    const claims = claimsContext(session, "turn-1", actionStore, undefined, authority);
    await expect(executor(baseDeps({ builtinTools: new Map([["write_data", action]]), capabilityMap: new Map([["write_data", capability]]) }), requestApproval)
      .executeToolCalls(session, [{ id: "call-1", name: "write_data", input: {} }], "turn-1:response:1", {
        perCallCapabilities: new Map([["write_data", capability]]),
        authorityAdmission: claims.admission, runtimeToolActionClaims: claims,
      })).rejects.toMatchObject({ name: "RuntimeToolActionCommittedError", retryable: false });
    expect(effectExecuted).toBe(false);
    expect(requestApproval).toHaveBeenCalledOnce();
  });

  it("propagates a post-claim sanitizer failure as committed unknown", async () => {
    const { actionStore } = store();
    const action = vi.fn(async () => "written");
    const session = new RuntimeSession({ appName: "test", tenantId: "tenant", userId: "user" });
    const capability: Capability = { name: "write_data", description: "write", schema: {}, tags: [], effectEnvelope: EFFECT };
    const sanitizer = { sanitize: vi.fn(async () => { throw new Error("projection failed"); }) };
    const claims = claimsContext(session, "turn-1", actionStore);
    await expect(executor(baseDeps({
      builtinTools: new Map([["write_data", action]]), capabilityMap: new Map([["write_data", capability]]), toolResultSanitizer: sanitizer as never,
    })).executeToolCalls(session, [{ id: "call-1", name: "write_data", input: {} }], "turn-1:response:1", {
      perCallCapabilities: new Map([["write_data", capability]]), authorityAdmission: claims.admission, runtimeToolActionClaims: claims,
    })).rejects.toMatchObject({ name: "RuntimeToolActionCommittedError", retryable: false });
    expect(action).toHaveBeenCalledOnce();
  });
});

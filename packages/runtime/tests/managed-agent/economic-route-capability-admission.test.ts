import { describe, expect, it, vi } from "vitest";
import {
  collectManagedEconomicCandidates,
  createManagedInvocationLifecycleToolExecutors,
  MANAGED_AGENT_INVOKE_TOOL,
  RuntimeManagedAgentInvocationService,
  type ManagedInvocationToolAttachment,
  type ManagedInvocationToolRoute,
} from "../../src/agents/managed-invocation/index.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.types.js";

const readonlyProfile = {
  authorityProfileId: "readonly",
  permissionProfile: "read-only",
  allowedToolNames: ["read"],
  writeAllowed: false,
  networkAllowed: false,
  workingDirectory: { path: "C:/workspace", mode: "read-only" as const },
  timeoutMs: 300_000,
  credentialRoute: { mode: "credentialless" as const },
  memoryScope: {
    scope: { kind: "project" as const, id: "kiln" },
    access: "read-only" as const,
  },
};

function route(input: {
  readonly routeId: string;
  readonly providerId: string;
  readonly model?: string;
  readonly policy?: boolean;
  readonly capability?: "verified" | "unverified";
  readonly profile?: boolean;
}): ManagedInvocationToolRoute {
  return {
    routeId: input.routeId,
    ...(input.policy ? { economicPolicyIds: ["economy-policy"] } : {}),
    routeSource: "explicit-managed-route",
    providerId: input.providerId,
    ...(input.model ? { model: input.model } : {}),
    ...(input.capability
      ? {
          economicCapability: {
            status: input.capability,
            ...(input.capability === "verified"
              ? {
                  adapterCapabilityId: `${input.providerId}-direct`,
                  adapterCapabilityVersion: "1",
                }
              : {}),
          },
        }
      : {}),
    profiles: input.profile === false
      ? {}
      : { "foundation-readonly-plan": readonlyProfile },
  };
}

const command = {
  economicPolicyId: "economy-policy",
  economicPolicyRevision: "revision-001",
  configuredAgentProfileId: "scout",
  admissionProfileId: "foundation-readonly-plan" as const,
};

describe("managed economic candidate admission", () => {
  it("makes providerRoute optional at the public policy-owned command boundary", () => {
    expect(MANAGED_AGENT_INVOKE_TOOL.inputSchema.required).toEqual([
      "profile",
      "task",
    ]);
  });

  it("collects every admitted cross-provider candidate without selecting one", () => {
    const candidates = collectManagedEconomicCandidates(command, [
      route({
        routeId: "codex-primary",
        providerId: "codex-oauth",
        model: "gpt-test",
        policy: true,
        capability: "verified",
      }),
      route({
        routeId: "opencode-secondary",
        providerId: "opencode-go",
        model: "go-test",
        policy: true,
        capability: "verified",
      }),
    ]);

    expect(candidates.candidates.map((candidate) => candidate.routeId)).toEqual([
      "codex-primary",
      "opencode-secondary",
    ]);
    expect(candidates.candidates[0]).toMatchObject({
      adapterCapabilityId: "codex-oauth-direct",
      adapterCapabilityVersion: "1",
    });
    expect(candidates).not.toHaveProperty("selectedRoute");
    expect(candidates).not.toHaveProperty("adapter");
  });

  it("uses caller route/provider/model fields only to remove candidates", () => {
    const candidates = collectManagedEconomicCandidates({
      ...command,
      providerRoute: {
        providerId: "opencode-go",
        model: "go-test",
        surface: "configured",
      },
    }, [
      route({
        routeId: "codex-primary",
        providerId: "codex-oauth",
        model: "gpt-test",
        policy: true,
        capability: "verified",
      }),
      route({
        routeId: "opencode-secondary",
        providerId: "opencode-go",
        model: "go-test",
        policy: true,
        capability: "verified",
      }),
    ]);

    expect(candidates.candidates).toEqual([
      expect.objectContaining({ routeId: "opencode-secondary" }),
    ]);
    expect(candidates.rejections).toContainEqual({
      stage: "managed-candidate-admission",
      routeId: "codex-primary",
      reason: "caller-constraint-excluded",
    });
  });

  it("owns exactly the four canonical rejection reasons at one stage", () => {
    const outsidePolicy = collectManagedEconomicCandidates(command, [
      route({
        routeId: "outside-policy",
        providerId: "codex-oauth",
        capability: "verified",
      }),
    ]);
    const constrained = collectManagedEconomicCandidates({
      ...command,
      routeId: "selected-route",
    }, [
      route({
        routeId: "constraint-excluded",
        providerId: "opencode-go",
        policy: true,
        capability: "verified",
      }),
    ]);
    const admissionFailed = collectManagedEconomicCandidates({
      ...command,
      requiredToolNames: ["shell"],
    }, [
      route({
        routeId: "admission-failed",
        providerId: "codex-oauth",
        policy: true,
        capability: "verified",
      }),
    ]);
    const capabilityUnverified = collectManagedEconomicCandidates(command, [
      route({
        routeId: "capability-unverified",
        providerId: "codex-oauth",
        policy: true,
        capability: "unverified",
      }),
    ]);

    const rejections = [
      ...outsidePolicy.rejections,
      ...constrained.rejections,
      ...admissionFailed.rejections,
      ...capabilityUnverified.rejections,
    ];
    expect(rejections.every(
      (rejection) => rejection.stage === "managed-candidate-admission",
    )).toBe(true);
    expect(rejections.map((rejection) => rejection.reason)).toEqual([
      "not-in-policy",
      "caller-constraint-excluded",
      "non-economic-admission-failed",
      "economic-capability-unverified",
    ]);
  });

  it("rejects unhealthy policy routes before economic capability evaluation", () => {
    const result = collectManagedEconomicCandidates(command, [], [{
      routeId: "unhealthy-route",
      economicPolicyIds: ["economy-policy"],
      economicCapability: { status: "unverified" },
      routeSource: "explicit-managed-route",
      providerId: "codex-oauth",
      profiles: ["foundation-readonly-plan"],
      reason: "Route health proof is stale.",
    }]);

    expect(result.rejections).toEqual([{
      stage: "managed-candidate-admission",
      routeId: "unhealthy-route",
      reason: "non-economic-admission-failed",
    }]);
  });

  it("performs no construction or execution side effects during admission", () => {
    const createAdapter = vi.fn();
    const materializeCredential = vi.fn();
    const acquireLease = vi.fn();
    const reserve = vi.fn();
    const invokeProvider = vi.fn();
    const candidate = {
      ...route({
        routeId: "codex-primary",
        providerId: "codex-oauth",
        policy: true,
        capability: "verified",
      }),
      createCommittedAdapter: createAdapter,
    };

    collectManagedEconomicCandidates(command, [candidate]);

    expect(createAdapter).not.toHaveBeenCalled();
    expect(materializeCredential).not.toHaveBeenCalled();
    expect(acquireLease).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(invokeProvider).not.toHaveBeenCalled();
  });

  it("denies unsupported deliberation before economic commitment", async () => {
    const prepare = vi.fn();
    const service = new RuntimeManagedAgentInvocationService();
    const attachment: ManagedInvocationToolAttachment = {
      options: {
        routes: [route({
          routeId: "codex-primary",
          providerId: "codex-oauth",
          model: "gpt-test",
          policy: true,
          capability: "verified",
        })],
        agentCatalog: [{
          name: "scout",
          role: "Scout",
          goal: "Inspect bounded work.",
          tier: "reasoning",
          economicPolicyId: "economy-policy",
          economicPolicyRevision: "revision-001",
          economicPolicyCandidateRouteIds: ["codex-primary"],
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-test",
            surface: "configured",
            deliberationIntent: {
              mode: "fixed",
              preferredLevel: "high" as never,
              onUnsupported: "deny",
            },
          },
        }],
        contextResolver: async () => ({ admittedAgentProfile: "scout" }),
        invocationService: service,
        economicDispatch: { prepare },
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "test",
        attachmentId: "attachment:test",
      },
    };
    const executor = createManagedInvocationLifecycleToolExecutors(attachment).get("managed_agent.invoke");
    if (!executor) throw new Error("managed_agent.invoke was not registered");

    const result = await executor({
      profile: "foundation-readonly-plan",
      agentProfile: "scout",
      task: "Inspect the deliberation boundary.",
    }, {
      session: { id: "session-test" } as RuntimeBuiltinToolExecutionContext["session"],
      turnId: "turn-test",
      toolCall: { id: "tool-call-test", name: "managed_agent.invoke", input: {} },
    }) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(result).toMatchObject({
      isError: true,
      metadata: {
        errorCode: "economic_commitment_unavailable",
        candidateSet: {
          candidates: [],
          rejections: [{ routeId: "codex-primary", reason: "deliberation-denied" }],
        },
      },
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("fails a provider-free policy invocation at commitment without starting Runtime", async () => {
    const service = new RuntimeManagedAgentInvocationService();
    const start = vi.spyOn(service, "start");
    const attachment: ManagedInvocationToolAttachment = {
      options: {
        routes: [route({
          routeId: "codex-primary",
          providerId: "codex-oauth",
          policy: true,
          capability: "verified",
        })],
        agentCatalog: [{
          name: "scout",
          role: "Scout",
          goal: "Inspect bounded work.",
          tier: "reasoning",
          economicPolicyId: "economy-policy",
          economicPolicyRevision: "revision-001",
          economicPolicyCandidateRouteIds: ["codex-primary"],
        }],
        contextResolver: async () => ({ admittedAgentProfile: "scout" }),
        invocationService: service,
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "test",
        attachmentId: "attachment:test",
      },
    };
    const executor = createManagedInvocationLifecycleToolExecutors(attachment)
      .get("managed_agent.invoke");
    if (!executor) throw new Error("managed_agent.invoke was not registered");

    const result = await executor({
      profile: "foundation-readonly-plan",
      agentProfile: "scout",
      task: "Inspect the policy boundary.",
    }, {
      session: { id: "session-test" } as RuntimeBuiltinToolExecutionContext["session"],
      turnId: "turn-test",
      toolCall: {
        id: "tool-call-test",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly isError: boolean;
      readonly metadata: Record<string, unknown>;
    };

    expect(result).toMatchObject({
      isError: true,
      metadata: {
        errorCode: "economic_commitment_unavailable",
        candidateSet: {
          candidates: [{ routeId: "codex-primary" }],
        },
      },
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("records a fenced commitment as pending when postcommit request realization fails", async () => {
    const service = new RuntimeManagedAgentInvocationService();
    const start = vi.spyOn(service, "start");
    const recordExecutionSettlementPending = vi.fn();
    const contextResolver = vi.fn()
      .mockResolvedValueOnce({ admittedAgentProfile: "scout" })
      .mockRejectedValueOnce(new Error("synthetic postcommit context failure"));
    const committedRoute = route({
      routeId: "codex-primary",
      providerId: "codex-oauth",
      model: "gpt-test",
      policy: true,
      capability: "verified",
    });
    const attachment: ManagedInvocationToolAttachment = {
      options: {
        routes: [committedRoute],
        agentCatalog: [{
          name: "scout",
          role: "Scout",
          goal: "Inspect bounded work.",
          tier: "reasoning",
          economicPolicyId: "economy-policy",
          economicPolicyRevision: "revision-001",
          economicPolicyCandidateRouteIds: ["codex-primary"],
        }],
        contextResolver,
        invocationService: service,
        workspaceRoot: "C:/workspace",
        economicDispatch: {
          prepare: async (input: { readonly lifecycleEvents?: { readonly record: (recordInput: unknown) => void } }) => {
            input.lifecycleEvents?.record({
              transition: "held",
              policy: {
                policyId: "economy-policy",
                policyRevision: "revision-001",
                policyDigest: "sha256:test-policy-digest",
              },
            });
            return {
              status: "prepared",
              commitment: {
                reservation: {
                  selectedIdentity: {
                    route: {
                      routeId: "codex-primary",
                      providerId: "codex-oauth",
                      modelId: "gpt-test",
                    },
                  },
                },
              } as never,
              adapter: { descriptor: {} } as never,
              recordExecutionSettlementPending,
              createExecutionSettlement: () => ({} as never),
              registerEconomicSettlement: () => undefined,
            };
          },
        },
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "test",
        attachmentId: "attachment:test",
      },
    };
    const executor = createManagedInvocationLifecycleToolExecutors(attachment)
      .get("managed_agent.invoke");
    if (!executor) throw new Error("managed_agent.invoke was not registered");

    const sessionEvents: any[] = [];
    const result = await executor({
      profile: "foundation-readonly-plan",
      agentProfile: "scout",
      task: "Inspect the policy boundary.",
    }, {
      session: {
        id: "session-test",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        userTurnCount: 1,
        get sessionEvents() { return sessionEvents; },
        nextSessionEventSequence: () => sessionEvents.length + 1,
        appendSessionEvents: (events: readonly unknown[]) => { sessionEvents.push(...events); },
      } as RuntimeBuiltinToolExecutionContext["session"],
      turnId: "turn-test",
      toolCall: { id: "tool-call-test", name: "managed_agent.invoke", input: {} },
    }) as { readonly isError: boolean; readonly output: string };

    expect(result).toMatchObject({ isError: true, output: "synthetic postcommit context failure" });
    expect(recordExecutionSettlementPending).toHaveBeenCalledOnce();
    expect(recordExecutionSettlementPending).toHaveBeenCalledWith("postcommit-request-denied");
    expect(start).not.toHaveBeenCalled();

    // Proves the session-event jobId<->invocationId join: the economic lifecycle event recorded
    // during commitment carries the same invocationId this invocation would be assigned, even
    // though the recursive "already-admitted" call that would normally reach that computation
    // failed here (postcommit context realization failure). The invocationId is computed once,
    // from context alone, before the economic block runs.
    expect(sessionEvents).toHaveLength(1);
    expect(sessionEvents[0]).toMatchObject({
      kind: "managed_economic_lifecycle",
      invocationId: "managed-session-test-1-tool-call-test",
    });
  });

  it("denies skills before exposing economic candidates", async () => {
    const service = new RuntimeManagedAgentInvocationService();
    const attachment: ManagedInvocationToolAttachment = {
      options: {
        routes: [route({
          routeId: "codex-primary",
          providerId: "codex-oauth",
          policy: true,
          capability: "verified",
        })],
        agentCatalog: [{
          name: "scout",
          role: "Scout",
          goal: "Inspect bounded work.",
          tier: "reasoning",
          economicPolicyId: "economy-policy",
          economicPolicyRevision: "revision-001",
          economicPolicyCandidateRouteIds: ["codex-primary"],
        }],
        contextResolver: async () => ({ deniedSkills: ["forbidden-skill"] }),
        invocationService: service,
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "test",
        attachmentId: "attachment:test",
      },
    };
    const executor = createManagedInvocationLifecycleToolExecutors(attachment)
      .get("managed_agent.invoke");
    if (!executor) throw new Error("managed_agent.invoke was not registered");

    const result = await executor({
      profile: "foundation-readonly-plan",
      agentProfile: "scout",
      skills: ["forbidden-skill"],
      task: "Inspect the policy boundary.",
    }, {
      session: { id: "session-test" } as RuntimeBuiltinToolExecutionContext["session"],
      turnId: "turn-test",
      toolCall: { id: "tool-call-test", name: "managed_agent.invoke", input: {} },
    }) as { readonly output: string; readonly metadata: Record<string, unknown> };

    expect(result.output).toContain("Managed invocation denied skill(s): forbidden-skill");
    expect(result.metadata).not.toHaveProperty("candidateSet");
  });

  it("denies destructive authority before exposing economic candidates", async () => {
    const service = new RuntimeManagedAgentInvocationService();
    const requestApproval = vi.fn(async () => ({ approved: false as const, reason: "operator denied" }));
    const attachment: ManagedInvocationToolAttachment = {
      options: {
        routes: [],
        agentCatalog: [{
          name: "writer",
          role: "Writer",
          goal: "Apply bounded work.",
          tier: "reasoning",
          economicPolicyId: "economy-policy",
          economicPolicyRevision: "revision-001",
          economicPolicyCandidateRouteIds: [],
        }],
        contextResolver: async () => ({ admittedAgentProfile: "writer" }),
        invocationService: service,
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "test",
        attachmentId: "attachment:test",
      },
    };
    const executor = createManagedInvocationLifecycleToolExecutors(attachment)
      .get("managed_agent.invoke");
    if (!executor) throw new Error("managed_agent.invoke was not registered");

    const result = await executor({
      profile: "foundation-apply-approved-writes",
      agentProfile: "writer",
      requestedAuthority: "destructive",
      task: "Apply the policy boundary.",
    }, {
      session: { id: "session-test" } as RuntimeBuiltinToolExecutionContext["session"],
      turnId: "turn-test",
      toolCall: { id: "tool-call-test", name: "managed_agent.invoke", input: {} },
      requestApproval,
    }) as { readonly output: string; readonly metadata: Record<string, unknown> };

    expect(requestApproval).toHaveBeenCalledOnce();
    expect(result.output).toContain("destructive requested authority denied: operator denied");
    expect(result.metadata).not.toHaveProperty("candidateSet");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  buildManagedAgentDecompositionOrchestrationRequest,
  buildManagedAgentFanOutOrchestrationRequest,
  buildManagedAgentReviewSwarmOrchestrationRequest,
  defineDeliberationLevelId,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  type ManagedAgentAdmissionDecision,
} from "@kilnai/core/agents";
import {
  RuntimeManagedAgentInvocationService,
  runManagedAgentOrchestrationLifecycle,
  type ManagedAgentRuntimeInvocationInput,
  type ManagedAgentRuntimeAdapter,
  type ManagedAgentWorktreeLeaseManager,
  type ManagedAgentWorktreeLeaseManagerInput,
  type ManagedAgentWorktreeLeaseReleaseInput,
} from "../../src/agents/managed-invocation/index.js";
import type { ManagedInvocationToolOptions } from "../../src/agents/managed-invocation/runtime-tool/index.js";
import { managedEconomicAdmissionBundle } from "./managed-economic-admission-fixture.js";

const WRITE_AUTHORITY_DESCRIPTOR = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;

describe("runManagedAgentOrchestrationLifecycle", () => {
  it("starts, observes, and joins all managed fan-out children", async () => {
    const managedInvocation = createManagedInvocation();
    const orchestrationRequest = request(2);
    const admissions: string[] = [];
    const terminals: string[] = [];

    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest,
      managedInvocation,
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      lifecycleObserver: {
        onAdmissionResolved: ({ request, decision }) => {
          admissions.push(`${request.invocationId}:${decision.status}`);
        },
        onTerminal: ({ request, record }) => {
          terminals.push(`${request.invocationId}:${record.lifecycleState}`);
        },
      },
    });

    expect(result.orchestrationResult.status).toBe("completed");
    expect(result.orchestrationResult.childResults.map((child) => child.lifecycleState)).toEqual([
      "completed",
      "completed",
    ]);
    expect(result.orchestrationResult.childResults[0]).toMatchObject({
      invocationId: "fan-out-test:child:1",
      routeId: "test-write",
      providerId: "codex",
      authorityProfileId: "authority:test-write:foundation-apply-approved-writes",
      contextMode: "isolated",
      coordinationUsage: {
        version: "managed-agent-coordination-usage-v1",
        workerId: "fan-out-test:child:1",
      },
      replayEvidenceUris: [],
    });
    expect(managedInvocation.invocationService?.list().map((snapshot) => snapshot.lifecycleState)).toEqual([
      "completed",
      "completed",
    ]);
    expect(result.childRecords[0]?.record?.parentSessionId).toBe("parent-session");
    expect(result.childRecords[0]?.record?.authority.workingDirectory.path).toContain("fan-out-test:child:1");
    expect(result.childRecords[0]?.record?.capabilitySnapshot.authorityEvidence.requested.source).toBe("managed-invocation-request");
    expect(result.childRecords[0]?.record?.capabilitySnapshot.authorityEvidence.classification).toBe("current-verified");
    expect(admissions).toEqual([
      "fan-out-test:child:1:admitted",
      "fan-out-test:child:2:admitted",
    ]);
    expect(terminals).toEqual([
      "fan-out-test:child:1:completed",
      "fan-out-test:child:2:completed",
    ]);
  });

  it("executes decomposition through the same governed lifecycle", async () => {
    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: buildManagedAgentDecompositionOrchestrationRequest({
        orchestrationId: "decomposition-test",
        parentSessionId: "parent-session",
        parentTurnId: "parent-turn",
        requestedBy: "operator",
        requestSource: "runtime-test",
        task: "Inspect and verify the implementation",
        childPlans: [
          { roleIntent: "scout", task: "Inspect the implementation." },
          { roleIntent: "verifier", task: "Verify the implementation." },
        ],
        maxConcurrentChildren: 1,
        workingDirectoryMode: "isolated-worktree",
      }),
      managedInvocation: createManagedInvocation(),
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    });

    expect(result.orchestrationResult).toMatchObject({
      mode: "decomposition",
      status: "completed",
      succeededCount: 2,
    });
    expect(result.childRecords.map((child) => child.childId)).toEqual([
      "decomposition-test:child:1",
      "decomposition-test:child:2",
    ]);
  });

  it("propagates agent-profile communication authority into orchestration children", async () => {
    const observedRequests: ManagedAgentRuntimeInvocationInput["request"][] = [];
    const base = createManagedInvocation({
      requestObserver: (request) => observedRequests.push(request),
    });
    const managedInvocation: ManagedInvocationToolOptions = {
      ...base,
      agentCatalog: [{
        name: "concise-reviewer",
        role: "Reviewer",
        goal: "Review concisely and retain findings.",
        tier: "reasoning",
        authorityProfileId: "authority:test-write:foundation-apply-approved-writes",
        admissionProfile: "foundation-apply-approved-writes",
        routeId: "test-write",
        communication: {
          responseDetail: "concise",
          requiredContent: ["finding"],
        },
      }],
    };

    await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: buildManagedAgentDecompositionOrchestrationRequest({
        orchestrationId: "communication-test",
        parentSessionId: "parent-session",
        parentTurnId: "parent-turn",
        requestedBy: "operator",
        requestSource: "runtime-test",
        task: "Review the implementation",
        childPlans: [
          {
            roleIntent: "reviewer",
            task: "Report findings.",
            agentProfile: "concise-reviewer",
          },
          {
            roleIntent: "verifier",
            task: "Verify the reported findings.",
            agentProfile: "concise-reviewer",
          },
        ],
        maxConcurrentChildren: 1,
        workingDirectoryMode: "isolated-worktree",
      }),
      managedInvocation,
      profile: "foundation-apply-approved-writes",
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "test",
        attachmentId: "attachment:test",
        parentEffectiveRequestedAuthority: "destructive",
      },
      requestedAuthority: "audited",
    });

    expect(observedRequests[0]?.providerRoute.communicationIntent).toMatchObject({
      intent: {
        responseDetail: "concise",
        requiredContent: ["finding"],
      },
      authority: {
        responseDetail: "agent-profile",
        requiredContent: { finding: ["agent-profile"] },
      },
    });
  });

  it("routes each team member independently and propagates completed dependency handoffs", async () => {
    const observedRequests: ManagedAgentRuntimeInvocationInput["request"][] = [];
    const managedInvocation = createManagedInvocation({
      requestObserver: (request) => observedRequests.push(request),
    });
    const primaryRoute = managedInvocation.routes[0]!;
    const secondaryRoute = {
      ...primaryRoute,
      routeId: "test-write-secondary",
      providerId: "codex",
      model: "kimi-k2.7",
      capability: {
        ...primaryRoute.capability,
        identity: { ...primaryRoute.capability.identity, routeId: "test-write-secondary" },
        target: { providerId: "codex", modelId: "kimi-k2.7" },
      },
    };

    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: buildManagedAgentDecompositionOrchestrationRequest({
        orchestrationId: "team-test",
        parentSessionId: "parent-session",
        parentTurnId: "parent-turn",
        requestedBy: "operator",
        requestSource: "runtime-test",
        task: "Produce and integrate a frontend change.",
        childPlans: [
          {
            key: "visual-producer",
            roleIntent: "visual-producer",
            task: "Produce the visual specification.",
            routeId: primaryRoute.routeId,
          },
          {
            key: "repository-integrator",
            roleIntent: "repository-integrator",
            task: "Integrate the approved specification.",
            routeId: secondaryRoute.routeId,
            dependsOn: ["visual-producer"],
          },
        ],
        maxConcurrentChildren: 2,
        workingDirectoryMode: "isolated-worktree",
      }),
      managedInvocation: {
        ...managedInvocation,
        routes: [primaryRoute, secondaryRoute],
      },
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    });

    expect(result.orchestrationResult.childResults.map((child) => child.routeId)).toEqual([
      "test-write",
      "test-write-secondary",
    ]);
    expect(observedRequests[1]?.input.prompt).toContain("## Dependency handoffs");
    expect(observedRequests[1]?.input.prompt).toContain("Worker 1 completed");
    expect(observedRequests[1]?.input.resourceUris).toEqual([
      "kiln://managed-agents/invocations/team-test%3Achild%3A1/handoff",
    ]);
  });

  it("blocks dependent team members when a required producer fails", async () => {
    const observedInvocations: string[] = [];
    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: buildManagedAgentDecompositionOrchestrationRequest({
        orchestrationId: "blocked-team-test",
        parentSessionId: "parent-session",
        parentTurnId: "parent-turn",
        requestedBy: "operator",
        requestSource: "runtime-test",
        task: "Produce and integrate a frontend change.",
        childPlans: [
          { key: "producer", roleIntent: "producer", task: "Produce.", routeId: "test-write" },
          {
            key: "integrator",
            roleIntent: "integrator",
            task: "Integrate.",
            routeId: "test-write",
            dependsOn: ["producer"],
          },
        ],
        maxConcurrentChildren: 2,
        workingDirectoryMode: "isolated-worktree",
      }),
      managedInvocation: createManagedInvocation({
        failOrdinals: new Set([1]),
        requestObserver: (request) => observedInvocations.push(request.invocationId),
      }),
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    });

    expect(observedInvocations).toEqual(["blocked-team-test:child:1"]);
    expect(result.orchestrationResult.failedCount).toBe(2);
    expect(result.childRecords[1]?.error).toContain("Blocked by failed dependencies: producer");
  });

  it("rejects unknown agent identities at the lifecycle boundary", async () => {
    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: buildManagedAgentDecompositionOrchestrationRequest({
        orchestrationId: "unknown-agent-test",
        parentSessionId: "parent-session",
        parentTurnId: "parent-turn",
        requestedBy: "operator",
        requestSource: "runtime-test",
        task: "Inspect with a configured specialist.",
        childPlans: [{
          key: "unknown",
          roleIntent: "reviewer",
          task: "Review.",
          agentProfile: "invented-agent",
          routeId: "test-write",
        }, {
          key: "known",
          roleIntent: "verifier",
          task: "Verify.",
          routeId: "test-write",
        }],
        maxConcurrentChildren: 1,
        workingDirectoryMode: "isolated-worktree",
      }),
      managedInvocation: createManagedInvocation(),
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    })).rejects.toThrow("unknown agent profile 'invented-agent'");
  });

  it("executes non-mutating review through a read-only route without a worktree lease", async () => {
    const managedInvocation = createReadOnlyManagedInvocation();
    const primaryRoute = managedInvocation.routes[0]!;
    const secondaryRoute = {
      ...primaryRoute,
      routeId: "test-read-only-secondary",
      model: "gpt-5.6-terra",
      capability: {
        ...primaryRoute.capability,
        identity: { ...primaryRoute.capability.identity, routeId: "test-read-only-secondary" },
        target: { ...primaryRoute.capability.target, modelId: "gpt-5.6-terra" },
      },
    };
    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: buildManagedAgentReviewSwarmOrchestrationRequest({
        orchestrationId: "review-read-only-test",
        parentSessionId: "parent-session",
        parentTurnId: "parent-turn",
        requestedBy: "operator",
        requestSource: "runtime-test",
        task: "Review the implementation without modifying the workspace.",
        childPlans: [
          { roleIntent: "correctness-review", task: "Review correctness.", routeId: primaryRoute.routeId },
          { roleIntent: "boundary-review", task: "Review architecture boundaries.", routeId: secondaryRoute.routeId },
        ],
        maxConcurrentChildren: 2,
        workingDirectoryMode: "read-only",
      }),
      managedInvocation: { ...managedInvocation, routes: [primaryRoute, secondaryRoute] },
      profile: "foundation-readonly-plan",
    });

    expect(result.orchestrationResult).toMatchObject({
      mode: "review-swarm",
      status: "completed",
      succeededCount: 2,
    });
    expect(result.childRecords.every((child) => child.record?.authority.workingDirectory.mode === "read-only")).toBe(true);
  });

  it("rejects independent review when all reviewers resolve to the same provider and model", async () => {
    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: buildManagedAgentReviewSwarmOrchestrationRequest({
        orchestrationId: "review-identity-test",
        parentSessionId: "parent-session",
        parentTurnId: "parent-turn",
        requestedBy: "operator",
        requestSource: "runtime-test",
        task: "Review independently.",
        childPlans: [
          { roleIntent: "correctness-review", task: "Review correctness." },
          { roleIntent: "boundary-review", task: "Review architecture boundaries." },
        ],
        maxConcurrentChildren: 2,
        workingDirectoryMode: "read-only",
      }),
      managedInvocation: createReadOnlyManagedInvocation(),
      profile: "foundation-readonly-plan",
    })).rejects.toThrow("requires at least two distinct provider/model identities");
  });

  it("maps failed joined children into orchestration evidence", async () => {
    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: createManagedInvocation({ failOrdinals: new Set([2]) }),
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    });

    expect(result.orchestrationResult.status).toBe("partial");
    expect(result.orchestrationResult.succeededCount).toBe(1);
    expect(result.orchestrationResult.failedCount).toBe(1);
    expect(result.orchestrationResult.childResults[1]?.diagnosticUris).toEqual(
      expect.arrayContaining(["kiln://artifacts/fan-out-test:child:2/worktree-release"]),
    );
  });

  it("treats recovered terminal children as successful fan-out evidence", async () => {
    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: createManagedInvocation({ recoveredOrdinals: new Set([2]) }),
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    });

    expect(result.orchestrationResult.status).toBe("completed");
    expect(result.orchestrationResult.succeededCount).toBe(2);
    expect(result.orchestrationResult.childResults[1]).toMatchObject({
      lifecycleState: "recovered",
      success: true,
    });
  });

  it("fails closed before starting children when economic commitment is denied", async () => {
    const managedInvocation = createEconomicManagedInvocation({ status: "denied" });
    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: economicRequest(2),
      managedInvocation: managedInvocation.options,
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      authorityAdmission: managedEconomicAdmissionBundle({
        sessionId: "parent-session",
        turnId: "parent-turn",
      }),
      economicAdoptedDecisionAt: "2026-08-01T00:00:00.000Z",
    })).rejects.toThrow("durable economic commitment");

    expect(managedInvocation.prepare).toHaveBeenCalledOnce();
    expect(managedInvocation.invoked).not.toHaveBeenCalled();
  });

  it("cancels already-started children when a later child start fails", async () => {
    const managedInvocation = createManagedInvocation({
      failAcquireOrdinals: new Set([2]),
      holdOrdinals: new Set([1]),
    });
    const terminalStates: string[] = [];

    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation,
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      lifecycleObserver: {
        onAdmissionResolved: () => undefined,
        onTerminal: ({ request, record }) => {
          terminalStates.push(`${request.invocationId}:${record.lifecycleState}`);
        },
      },
    })).rejects.toThrow("Managed orchestration child start failed");

    const lifecycleStates = managedInvocation.invocationService?.list().map((snapshot) => snapshot.lifecycleState);
    expect(lifecycleStates).toContain("cancelled");
    expect(lifecycleStates).not.toContain("running");
    expect(terminalStates).toContain("fan-out-test:child:1:cancelled");
  });

  it("joins started children when cleanup cancel races with terminal completion", async () => {
    let startCount = 0;
    let joined = false;
    const managedInvocation = createManagedInvocation();
    const fakeService = {
      start: async () => {
        startCount += 1;
        if (startCount === 2) {
          throw new Error("second start failed");
        }
        return {
          status: "started",
          decision: {},
          snapshot: {
            invocationId: "fan-out-test:child:1",
          },
        };
      },
      status: () => ({
        lifecycleState: "running",
      }),
      cancel: async () => {
        throw new Error("already terminal");
      },
      join: async () => {
        joined = true;
        return {
          status: "completed",
          decision: {},
          record: {},
        };
      },
    };

    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: {
        ...managedInvocation,
        invocationService: fakeService as unknown as RuntimeManagedAgentInvocationService,
      },
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    })).rejects.toThrow("Managed orchestration child start failed");

    expect(joined).toBe(true);
  });

  it("rebases mixed-case Windows write scopes onto the isolated child worktree", async () => {
    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: createManagedInvocation({
        sourcePath: "C:\\Repo",
        rootPath: "C:\\Repo\\.kiln\\worktrees",
        allowedPaths: ["c:\\repo\\packages"],
        deniedPaths: ["c:\\repo\\.git"],
      }),
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    });

    expect(result.childRecords[0]?.record?.authority.writeAuthority?.scope.workspace.allowedPaths).toEqual([
      "C:/Repo/.kiln/worktrees/fan-out-test:child:1/packages",
    ]);
    expect(result.childRecords[0]?.record?.authority.writeAuthority?.scope.workspace.deniedPaths).toEqual([
      "C:/Repo/.kiln/worktrees/fan-out-test:child:1/.git",
    ]);
  });

  it("fails closed when the selected route declares an external-runtime attachment (Roadmap 01 Slice 3.1, F3)", async () => {
    // managed_agent.orchestrate has no input surface to request an
    // externalRuntimeAttachment yet (that is deliberately out of scope for
    // this slice). This proves the single core admission gate
    // (evaluateManagedAgentAdmission) still fails closed for the orchestrate
    // dispatch path when the selected route is attached to a specific
    // external-runtime instance: the route's declared attachment surfaces
    // through runOrchestrationBatch's capabilitySnapshotInput, the built
    // request never carries a requested attachment, and admission denies
    // with externalRuntimeAttachment.missing before any child starts.
    const observedRequests: ManagedAgentRuntimeInvocationInput["request"][] = [];
    const managedInvocation = createManagedInvocation({
      requestObserver: (request) => observedRequests.push(request),
    });
    const primaryRoute = managedInvocation.routes[0]!;
    const decisions: ManagedAgentAdmissionDecision[] = [];

    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: {
        ...managedInvocation,
        routes: [{
          ...primaryRoute,
          externalRuntimeAttachment: { kind: "external-runtime", runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
        }],
      },
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      lifecycleObserver: {
        onAdmissionResolved: ({ decision }) => {
          decisions.push(decision);
        },
      },
    })).rejects.toThrow("external-runtime-attachment-unsupported-route");

    expect(decisions).toEqual([]);
    expect(observedRequests).toEqual([]);
    expect(managedInvocation.invocationService?.list()).toEqual([]);
  });

  it("fails closed when no isolated lifecycle route is available", async () => {
    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: {
        invocationService: new RuntimeManagedAgentInvocationService(),
        routes: [],
      },
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
    })).rejects.toThrow("Managed orchestration requires an isolated-worktree");
  });

  it("commits, fences, invokes, and settles every economic orchestration child", async () => {
    const managedInvocation = createManagedInvocation();
    const primaryRoute = managedInvocation.routes[0]!;
    const orchestrationRequest = request(2);
    const events: string[] = [];
    const preparation = vi.fn(async (input) => ({
      status: "prepared" as const,
      commitment: {
        reservation: {
          selectedIdentity: {
            route: {
              routeId: primaryRoute.routeId,
              providerId: primaryRoute.providerId,
              modelId: primaryRoute.model,
              accountPolicyId: null,
            },
            account: { kind: "accountless" },
          },
        },
      } as never,
      adapter: {
        ...primaryRoute.adapter!,
        invoke: async (invocation) => {
          invocation.registerAdapterCompletion(Promise.resolve());
          invocation.registerEconomicSettlement?.(Promise.resolve({} as never));
          return await primaryRoute.adapter!.invoke(invocation);
        },
      },
      recordExecutionSettlementPending: () => { events.push(`pending:${input.jobId}`); },
      createExecutionSettlement: () => ({} as never),
      registerEconomicSettlement: (settlement) => {
        events.push(`settlement:${input.jobId}`);
        void Promise.resolve(settlement).then(() => events.push(`settled:${input.jobId}`));
      },
    }));

    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: {
        ...orchestrationRequest,
        childRequests: orchestrationRequest.childRequests.map((child) => ({
          ...child,
          agentProfile: "economic-worker",
        })),
      },
      managedInvocation: {
        ...managedInvocation,
        routes: [{
          ...primaryRoute,
          adapter: undefined,
          economicPolicyIds: ["economy-policy"],
          economicCapability: {
            status: "verified",
            adapterCapabilityId: "codex-direct",
            adapterCapabilityVersion: "1",
          },
        }],
        agentCatalog: [{
          name: "economic-worker",
          role: "Economic worker",
          goal: "Execute only after durable commitment.",
          tier: "reasoning",
          authorityProfileId: "authority:test-write:foundation-apply-approved-writes",
          admissionProfile: "foundation-apply-approved-writes",
          economicPolicyId: "economy-policy",
          economicPolicyRevision: "revision-001",
          economicPolicyCandidateRouteIds: [primaryRoute.routeId],
        }],
        economicDispatch: { prepare: preparation },
      },
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      authorityAdmission: managedEconomicAdmissionBundle({
        sessionId: "parent-session",
        turnId: "parent-turn",
      }),
      economicAdoptedDecisionAt: "2026-08-01T00:00:00.000Z",
    });

    expect(result.orchestrationResult.status).toBe("completed");
    expect(preparation).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.startsWith("settlement:"))).toHaveLength(2);
    await vi.waitFor(() => expect(events.filter((event) => event.startsWith("settled:"))).toHaveLength(2));
    expect(events.some((event) => event.startsWith("pending:"))).toBe(false);
  });

  it("does not invoke an economic child whose commitment is already dispatch-fenced", async () => {
    const managedInvocation = createEconomicManagedInvocation({ status: "already-dispatched" });
    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: economicRequest(2),
      managedInvocation: managedInvocation.options,
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      authorityAdmission: managedInvocation.authorityAdmission,
      economicAdoptedDecisionAt: "2026-08-01T00:00:00.000Z",
    })).rejects.toThrow("already dispatch-fenced");

    expect(managedInvocation.invoked).not.toHaveBeenCalled();
  });

  it("binds the agent deliberation envelope into the economic commitment fingerprint", async () => {
    const low = createEconomicManagedInvocation({ deliberationLevel: "low" });
    const high = createEconomicManagedInvocation({ deliberationLevel: "high" });
    const run = async (managedInvocation: ReturnType<typeof createEconomicManagedInvocation>) =>
      runManagedAgentOrchestrationLifecycle({
        orchestrationRequest: economicRequest(2),
        managedInvocation: managedInvocation.options,
        profile: "foundation-apply-approved-writes",
        callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
        requestedAuthority: "audited",
        authorityAdmission: managedInvocation.authorityAdmission,
        economicAdoptedDecisionAt: "2026-08-01T00:00:00.000Z",
      });

    await run(low);
    await run(high);

    const lowInput = low.prepare.mock.calls[0]?.[0];
    const highInput = high.prepare.mock.calls[0]?.[0];
    expect(lowInput?.intentFingerprint).not.toBe(highInput?.intentFingerprint);
    expect(low.invoked.mock.calls[0]?.[0]?.providerRoute.deliberationIntent).toMatchObject({
      mode: "fixed",
      preferredLevel: "low",
    });
    expect(low.invoked.mock.calls[0]?.[0]?.providerRoute.deliberationResolution).toMatchObject({
      status: "exact",
      selectedLevel: "low",
      capabilityEvidence: {
        sourceIdentity: "test:economic-route",
        sourceRevision: "revision-1",
      },
    });
  });

  it("marks every fenced commitment pending when a later child cannot be prepared", async () => {
    const managedInvocation = createEconomicManagedInvocation();
    const successfulPreparation = managedInvocation.prepare.getMockImplementation();
    if (!successfulPreparation) throw new Error("fixture");
    managedInvocation.prepare
      .mockImplementationOnce(successfulPreparation)
      .mockRejectedValueOnce(new Error("synthetic second preparation failure"));

    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: economicRequest(2),
      managedInvocation: managedInvocation.options,
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      authorityAdmission: managedInvocation.authorityAdmission,
      economicAdoptedDecisionAt: "2026-08-01T00:00:00.000Z",
    })).rejects.toThrow("synthetic second preparation failure");

    expect(managedInvocation.recordExecutionSettlementPending).toHaveBeenCalledOnce();
    expect(managedInvocation.invoked).not.toHaveBeenCalled();
  });

  it("does not prepare an economic commitment for a dependency-blocked child", async () => {
    const managedInvocation = createEconomicManagedInvocation({ failOrdinals: new Set([1]) });

    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: buildManagedAgentDecompositionOrchestrationRequest({
        orchestrationId: "economic-blocked-team",
        parentSessionId: "parent-session",
        parentTurnId: "parent-turn",
        requestedBy: "operator",
        requestSource: "runtime-test",
        task: "Produce and integrate through committed routes.",
        childPlans: [{
          key: "producer",
          roleIntent: "producer",
          task: "Produce.",
          agentProfile: "economic-worker",
        }, {
          key: "integrator",
          roleIntent: "integrator",
          task: "Integrate.",
          agentProfile: "economic-worker",
          dependsOn: ["producer"],
        }],
        maxConcurrentChildren: 2,
        workingDirectoryMode: "isolated-worktree",
      }),
      managedInvocation: managedInvocation.options,
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      authorityAdmission: managedInvocation.authorityAdmission,
      economicAdoptedDecisionAt: "2026-08-01T00:00:00.000Z",
    });

    expect(managedInvocation.prepare).toHaveBeenCalledOnce();
    expect(result.childRecords[1]?.error).toContain("Blocked by failed dependencies: producer");
  });

  it("does not redispatch an economic child whose durable commitment is already fenced", async () => {
    const managedInvocation = createEconomicManagedInvocation({ status: "already-dispatched" });

    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: economicRequest(2),
      managedInvocation: managedInvocation.options,
      profile: "foundation-apply-approved-writes",
      callerIdentity: { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:test", parentEffectiveRequestedAuthority: "destructive" },
      requestedAuthority: "audited",
      authorityAdmission: managedInvocation.authorityAdmission,
      economicAdoptedDecisionAt: "2026-08-01T00:00:00.000Z",
    })).rejects.toThrow("already dispatch-fenced");

    expect(managedInvocation.prepare).toHaveBeenCalledOnce();
    expect(managedInvocation.invoked).not.toHaveBeenCalled();
  });

  it("fails closed when lifecycle route selection is ambiguous", async () => {
    const managedInvocation = createManagedInvocation();
    const primaryRoute = managedInvocation.routes[0]!;

    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: {
        ...managedInvocation,
        routes: [
          primaryRoute,
          {
            ...primaryRoute,
            routeId: "test-write-secondary",
          },
        ],
      },
      profile: "foundation-apply-approved-writes",
    })).rejects.toThrow("Managed orchestration route selection is ambiguous");
  });
});

function request(childCount: number) {
  return buildManagedAgentFanOutOrchestrationRequest({
    orchestrationId: "fan-out-test",
    parentSessionId: "parent-session",
    parentTurnId: "parent-turn",
    requestedBy: "operator",
    requestSource: "runtime-test",
    task: "Implement the test task",
    childCount,
    maxConcurrentChildren: childCount,
    workingDirectoryMode: "isolated-worktree",
  });
}

function createManagedInvocation(input: {
  readonly failOrdinals?: ReadonlySet<number>;
  readonly recoveredOrdinals?: ReadonlySet<number>;
  readonly holdOrdinals?: ReadonlySet<number>;
  readonly failAcquireOrdinals?: ReadonlySet<number>;
  readonly sourcePath?: string;
  readonly rootPath?: string;
  readonly allowedPaths?: readonly string[];
  readonly deniedPaths?: readonly string[];
  readonly requestObserver?: (request: ManagedAgentRuntimeInvocationInput["request"]) => void;
} = {}): ManagedInvocationToolOptions {
  const sourcePath = input.sourcePath ?? "C:\\repo";
  const rootPath = input.rootPath ?? "C:\\repo\\.kiln\\worktrees";
  return {
    requestedBy: "operator",
    requestSource: "runtime-test",
    invocationService: new RuntimeManagedAgentInvocationService({
      worktreeLeaseManager: createWorktreeLeaseManager(input.failAcquireOrdinals ?? new Set()),
      authorityObserver: {
        observe: async () => ({
          approval: "on-request" as const,
          sandbox: "workspace-write" as const,
          source: "runtime-observation" as const,
          proof: "proven" as const,
          observedAt: "2026-07-02T08:00:00.000Z",
          validUntil: "2099-01-01T00:00:00.000Z",
        }),
      },
    }),
    routes: [{
      routeId: "test-write",
      routeSource: "explicit-managed-route",
      providerId: "codex",
      model: "gpt-5.5",
      surface: "cli-harness",
      capability: {
        identity: { routeId: "test-write", revision: "test-v1" },
        target: { providerId: "codex", modelId: "gpt-5.5" },
        adapter: { kind: "cli-harness", capabilityId: "codex-cli", capabilityVersion: "1" },
        authorityCeiling: "destructive", toolNames: ["read", "grep", "apply-patch"], supportsRecursion: true, supportsAttachments: false, supportsWrite: true,
        proof: { status: "configured", source: "test", provenProfiles: ["foundation-apply-approved-writes"] }, capacity: { kind: "accountless" }, settlement: { kind: "not-required" },
      },
      adapter: createAdapter({
        failOrdinals: input.failOrdinals ?? new Set(),
        recoveredOrdinals: input.recoveredOrdinals ?? new Set(),
        holdOrdinals: input.holdOrdinals ?? new Set(),
        ...(input.requestObserver ? { requestObserver: input.requestObserver } : {}),
      }),
      createAdapter: async () => createAdapter({
        failOrdinals: input.failOrdinals ?? new Set(),
        recoveredOrdinals: input.recoveredOrdinals ?? new Set(),
        holdOrdinals: input.holdOrdinals ?? new Set(),
        ...(input.requestObserver ? { requestObserver: input.requestObserver } : {}),
      }),
      profiles: [{
          authorityProfileId: "authority:test-write:foundation-apply-approved-writes",
          admissionProfile: "foundation-apply-approved-writes",
          permissionProfile: "apply-approved-writes",
          allowedToolNames: ["read", "grep", "apply-patch"],
          writeAllowed: true,
          networkAllowed: false,
          workingDirectory: {
            path: rootPath,
            mode: "isolated-worktree",
          },
          workingDirectoryLease: {
            mode: "git-worktree",
            sourcePath,
            rootPath,
          },
          timeoutMs: 1000,
          credentialRoute: { mode: "credentialless" },
          memoryScope: {
            scope: { kind: "project", id: "kiln-test" },
            access: "none",
          },
          writeAuthority: {
            profile: "foundation-apply-approved-writes",
            scope: {
              workspace: {
                mode: "apply-approved",
                allowedPaths: input.allowedPaths ?? [sourcePath],
                deniedPaths: input.deniedPaths ?? [`${sourcePath}\\.git`],
              },
              memory: {
                mode: "none",
                operations: [],
              },
              artifacts: {
                mode: "none",
                resourceUris: [],
                retention: "none",
              },
              tools: {
                allowedToolNames: ["apply-patch"],
                deniedToolNames: [],
              },
            },
            approval: {
              mode: "policy-approved",
              evidenceRequired: true,
            },
          },
        }],
    }],
  };
}

function economicRequest(childCount: number) {
  const orchestrationRequest = request(childCount);
  return {
    ...orchestrationRequest,
    childRequests: orchestrationRequest.childRequests.map((child) => ({
      ...child,
      agentProfile: "economic-worker",
    })),
  };
}

function createEconomicManagedInvocation(input: {
  readonly status?: "prepared" | "already-dispatched" | "denied";
  readonly failOrdinals?: ReadonlySet<number>;
  readonly deliberationLevel?: "low" | "high";
} = {}) {
  const base = createManagedInvocation({
    ...(input.failOrdinals ? { failOrdinals: input.failOrdinals } : {}),
  });
  const route = base.routes[0]!;
  const invoked = vi.fn();
  const adapter = {
    ...route.adapter!,
    invoke: async (invocation: ManagedAgentRuntimeInvocationInput) => {
      invoked(invocation.request);
      invocation.registerEconomicSettlement?.(Promise.resolve({} as never));
      return await route.adapter!.invoke(invocation);
    },
  };
  const recordExecutionSettlementPending = vi.fn();
  const prepare = vi.fn(async () => {
    if (input.status === "already-dispatched") {
      return { status: "already-dispatched" as const, record: {} as never };
    }
    if (input.status === "denied") {
      return { status: "denied" as const, decision: {} as never };
    }
    return {
      status: "prepared" as const,
      commitment: {
        reservation: {
          selectedIdentity: {
            route: { routeId: route.routeId, providerId: route.providerId, modelId: route.model, accountPolicyId: null },
            account: { kind: "accountless" },
          },
        },
      } as never,
      adapter,
      recordExecutionSettlementPending,
      createExecutionSettlement: () => ({} as never),
      registerEconomicSettlement: () => undefined,
    };
  });
  return {
    options: {
      ...base,
      routes: [{
        ...route,
        adapter: undefined,
        ...(input.deliberationLevel ? {
          deliberationCapabilities: {
            provider: route.providerId,
            model: route.model,
            levels: ["low", "high"].map((level) => ({ id: defineDeliberationLevelId(level) })),
            defaultLevel: defineDeliberationLevelId("low"),
            supportsAdaptive: false,
            evidence: {
              sourceIdentity: "test:economic-route",
              sourceRevision: "revision-1",
              observedAt: "2026-08-02T00:00:00.000Z",
            },
          },
        } : {}),
        economicPolicyIds: ["economy-policy"],
        economicCapability: {
          status: "verified" as const,
          adapterCapabilityId: "codex-direct",
          adapterCapabilityVersion: "1",
        },
      }],
      agentCatalog: [{
        name: "economic-worker",
        role: "Economic worker",
        goal: "Execute only after durable commitment.",
        tier: "reasoning",
        authorityProfileId: "authority:test-write:foundation-apply-approved-writes",
        admissionProfile: "foundation-apply-approved-writes" as const,
        economicPolicyId: "economy-policy",
        economicPolicyRevision: "revision-001",
        economicPolicyCandidateRouteIds: [route.routeId],
        ...(input.deliberationLevel ? {
          providerRoute: {
            providerId: route.providerId,
            model: route.model,
            deliberationIntent: {
              mode: "fixed" as const,
              preferredLevel: input.deliberationLevel,
              onUnsupported: "deny" as const,
            },
          },
        } : {}),
      }],
      economicDispatch: { prepare },
    } satisfies ManagedInvocationToolOptions,
    prepare,
    recordExecutionSettlementPending,
    invoked,
    authorityAdmission: managedEconomicAdmissionBundle({
      sessionId: "parent-session",
      turnId: "parent-turn",
    }),
  };
}

function createReadOnlyManagedInvocation(): ManagedInvocationToolOptions {
  return {
    requestedBy: "operator",
    requestSource: "runtime-test",
    invocationService: new RuntimeManagedAgentInvocationService({
      authorityObserver: {
        observe: async () => ({
          approval: "on-request" as const,
          sandbox: "read-only" as const,
          source: "runtime-observation" as const,
          proof: "proven" as const,
          observedAt: "2026-07-02T08:00:00.000Z",
          validUntil: "2099-01-01T00:00:00.000Z",
        }),
      },
    }),
    routes: [{
      routeId: "test-read-only",
      routeSource: "explicit-managed-route",
      providerId: "codex",
      model: "gpt-5.5",
      surface: "cli-harness",
      capability: {
        identity: { routeId: "test-read-only", revision: "test-v1" },
        target: { providerId: "codex", modelId: "gpt-5.5" },
        adapter: { kind: "cli-harness", capabilityId: "codex-cli", capabilityVersion: "1" },
        authorityCeiling: "audited", toolNames: ["read", "grep"], supportsRecursion: true, supportsAttachments: false, supportsWrite: false,
        proof: { status: "configured", source: "test", provenProfiles: ["foundation-readonly-plan"] }, capacity: { kind: "accountless" }, settlement: { kind: "not-required" },
      },
      adapter: createAdapter({
        failOrdinals: new Set(),
        recoveredOrdinals: new Set(),
        holdOrdinals: new Set(),
      }),
      createAdapter: async () => createAdapter({
        failOrdinals: new Set(), recoveredOrdinals: new Set(), holdOrdinals: new Set(),
      }),
      profiles: [{
          authorityProfileId: "authority:test-read-only:foundation-readonly-plan",
          admissionProfile: "foundation-readonly-plan",
          permissionProfile: "read-only",
          allowedToolNames: ["read", "grep"],
          workingDirectory: {
            path: "C:/repo",
            mode: "read-only",
          },
          timeoutMs: 1000,
          credentialRoute: { mode: "credentialless" },
          memoryScope: {
            scope: { kind: "project", id: "kiln-test" },
            access: "read-only",
          },
        }],
    }],
  };
}

function createAdapter(input: {
  readonly failOrdinals: ReadonlySet<number>;
  readonly recoveredOrdinals: ReadonlySet<number>;
  readonly holdOrdinals: ReadonlySet<number>;
  readonly requestObserver?: (request: ManagedAgentRuntimeInvocationInput["request"]) => void;
}): ManagedAgentRuntimeAdapter {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:codex:harness",
      providerId: "codex",
      adapterKind: "harness",
      supportedProfiles: ["foundation-readonly-plan", "foundation-apply-approved-writes"],
      supportedExecutionModes: ["cli-harness"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: { supported: true, diagnosticArtifactOnTimeout: true },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
        tokenClasses: ["input", "output", "cache_read"],
        semanticSourceGranularity: "unknown",
        evidenceBasis: "adapter",
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      writeAuthority: WRITE_AUTHORITY_DESCRIPTOR,
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    }),
    invoke: async ({ request, admission, abortSignal }: ManagedAgentRuntimeInvocationInput) => {
      input.requestObserver?.(request);
      expect(request.executionIntent).toEqual({
        attendance: "unattended",
        lifecycle: "background",
      });
      const ordinal = Number(request.invocationId.split(":").at(-1));
      if (input.holdOrdinals.has(ordinal) && !abortSignal.aborted) {
        await new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      if (input.failOrdinals.has(ordinal)) {
        throw new Error(`Worker ${ordinal} failed`);
      }
      const handoffUri = `kiln://managed-invocations/${request.invocationId}/handoff`;
      return defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        profile: request.profile,
        lifecycleState: input.recoveredOrdinals.has(ordinal) ? "recovered" : "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: admission.capabilitySnapshot,
        resultHandoff: {
          provenance: {
            delivery: "runtime-generated",
            configuredModelId: request.providerRoute.model ?? "provider-default",
            observedModelIds: [],
          },
          summary: `Worker ${ordinal} completed`,
          resourceUris: [handoffUri],
          memoryWriteProposalUris: [],
          structuredResult: {
            version: "structured-execution-result-v1",
            status: "completed",
            summary: `Worker ${ordinal} completed`,
            uncertainty: 0,
            limitations: [],
            operatorDecisions: [],
            evidence: [{ uri: handoffUri, kind: "artifact" }],
            citations: [],
            warnings: [],
            failures: [],
            approvalRequirements: [],
            residualRisks: ["The synthetic child adapter does not exercise a live provider."],
            verificationResults: [{
              requirementId: "fan-out-handoff",
              method: "deterministic",
              status: "passed",
              summary: "The bounded child handoff is present.",
              evidenceUris: [handoffUri],
            }],
          },
        },
      });
    },
  };
}

function createWorktreeLeaseManager(failAcquireOrdinals: ReadonlySet<number>): ManagedAgentWorktreeLeaseManager {
  return {
    acquire: async (input: ManagedAgentWorktreeLeaseManagerInput) => {
      const ordinal = Number(input.request.invocationId.split(":").at(-1));
      if (failAcquireOrdinals.has(ordinal)) {
        throw new Error(`Worktree acquire ${ordinal} failed`);
      }
      return {
        ...input.lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: [`kiln://artifacts/${input.request.invocationId}/worktree-lease`],
      };
    },
    release: async (input: ManagedAgentWorktreeLeaseReleaseInput) => ({
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: [`kiln://artifacts/${input.request.invocationId}/worktree-release`],
    }),
  };
}

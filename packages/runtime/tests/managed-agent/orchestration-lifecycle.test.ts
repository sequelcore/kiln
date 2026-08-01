import { describe, expect, it, vi } from "vitest";
import {
  buildManagedAgentDecompositionOrchestrationRequest,
  buildManagedAgentFanOutOrchestrationRequest,
  buildManagedAgentReviewSwarmOrchestrationRequest,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
} from "@kilnai/core";
import type { ManagedAgentAdmissionDecision } from "@kilnai/core";
import {
  RuntimeManagedAgentInvocationService,
  runManagedAgentOrchestrationLifecycle,
  type ManagedAgentRuntimeInvocationInput,
  type ManagedAgentRuntimeAdapter,
  type ManagedAgentWorktreeLeaseManager,
  type ManagedAgentWorktreeLeaseManagerInput,
  type ManagedAgentWorktreeLeaseReleaseInput,
} from "../../src/agents/managed-invocation/index.js";
import type { ManagedInvocationToolOptions } from "../../src/agents/managed-invocation/runtime-tool.js";

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
    })).rejects.toThrow("unknown agent profile 'invented-agent'");
  });

  it("executes non-mutating review through a read-only route without a worktree lease", async () => {
    const managedInvocation = createReadOnlyManagedInvocation();
    const primaryRoute = managedInvocation.routes[0]!;
    const secondaryRoute = { ...primaryRoute, routeId: "test-read-only-secondary", model: "gpt-5.6-terra" };
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
    });

    expect(result.orchestrationResult.status).toBe("completed");
    expect(result.orchestrationResult.succeededCount).toBe(2);
    expect(result.orchestrationResult.childResults[1]).toMatchObject({
      lifecycleState: "recovered",
      success: true,
    });
  });

  it("fails closed before starting children when runtime budget admission denies fan-out", async () => {
    const managedInvocation = createManagedInvocation();
    const usageRequests: string[] = [];

    await expect(runManagedAgentOrchestrationLifecycle({
      orchestrationRequest: request(2),
      managedInvocation,
      profile: "foundation-apply-approved-writes",
      budgetAdmission: {
        policy: {
          enabled: true,
          routeBudgets: [{
            providerId: "codex",
            dailyTokenCeiling: 10,
          }],
        },
        usageReader: async ({ providerId }) => {
          usageRequests.push(providerId);
          return {
            providerId,
            tokensUsed: 11,
            source: "test-meter",
          };
        },
      },
    })).rejects.toThrow("Managed orchestration budget admission denied");

    expect(usageRequests).toEqual(["codex"]);
    expect(managedInvocation.invocationService?.list()).toEqual([]);
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
      lifecycleObserver: {
        onAdmissionResolved: ({ decision }) => {
          decisions.push(decision);
        },
      },
    })).rejects.toThrow(/externalRuntimeAttachment\.missing/);

    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      expect(decision).toMatchObject({
        status: "denied",
        missingCapabilities: ["externalRuntimeAttachment.missing"],
      });
    }
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
    })).rejects.toThrow("Managed orchestration requires an isolated-worktree");
  });

  it("candidate-admits a policy child without selecting or starting a route", async () => {
    const managedInvocation = createManagedInvocation();
    const primaryRoute = managedInvocation.routes[0]!;
    const start = vi.spyOn(managedInvocation.invocationService!, "start");
    const orchestrationRequest = request(2);

    await expect(runManagedAgentOrchestrationLifecycle({
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
          authorityProfile: "foundation-apply-approved-writes",
          economicPolicyId: "economy-policy",
          economicPolicyRevision: "revision-001",
          economicPolicyCandidateRouteIds: [primaryRoute.routeId],
        }],
      },
      profile: "foundation-apply-approved-writes",
    })).rejects.toMatchObject({
      code: "economic_commitment_unavailable",
      candidateSet: {
        candidates: [{ routeId: primaryRoute.routeId }],
      },
    });
    expect(start).not.toHaveBeenCalled();
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
      adapter: createAdapter({
        failOrdinals: input.failOrdinals ?? new Set(),
        recoveredOrdinals: input.recoveredOrdinals ?? new Set(),
        holdOrdinals: input.holdOrdinals ?? new Set(),
        ...(input.requestObserver ? { requestObserver: input.requestObserver } : {}),
      }),
      profiles: {
        "foundation-apply-approved-writes": {
          authorityProfileId: "authority:test-write:foundation-apply-approved-writes",
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
        },
      },
    }],
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
      adapter: createAdapter({
        failOrdinals: new Set(),
        recoveredOrdinals: new Set(),
        holdOrdinals: new Set(),
      }),
      profiles: {
        "foundation-readonly-plan": {
          authorityProfileId: "authority:test-read-only:foundation-readonly-plan",
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
        },
      },
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

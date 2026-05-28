import { describe, expect, it } from "vitest";
import {
  buildManagedAgentFanOutOrchestrationRequest,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
} from "@kilnai/core";
import {
  RuntimeManagedAgentInvocationService,
  runManagedAgentFanOutLifecycle,
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

describe("runManagedAgentFanOutLifecycle", () => {
  it("starts, observes, and joins all managed fan-out children", async () => {
    const managedInvocation = createManagedInvocation();
    const orchestrationRequest = request(2);

    const result = await runManagedAgentFanOutLifecycle({
      orchestrationRequest,
      managedInvocation,
    });

    expect(result.orchestrationResult.status).toBe("completed");
    expect(result.orchestrationResult.childResults.map((child) => child.lifecycleState)).toEqual([
      "completed",
      "completed",
    ]);
    expect(managedInvocation.invocationService?.list().map((snapshot) => snapshot.lifecycleState)).toEqual([
      "completed",
      "completed",
    ]);
    expect(result.childRecords[0]?.record?.parentSessionId).toBe("parent-session");
    expect(result.childRecords[0]?.record?.authority.workingDirectory.path).toContain("fan-out-test:child:1");
  });

  it("maps failed joined children into orchestration evidence", async () => {
    const result = await runManagedAgentFanOutLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: createManagedInvocation({ failOrdinals: new Set([2]) }),
    });

    expect(result.orchestrationResult.status).toBe("partial");
    expect(result.orchestrationResult.succeededCount).toBe(1);
    expect(result.orchestrationResult.failedCount).toBe(1);
    expect(result.orchestrationResult.childResults[1]?.diagnosticUris).toEqual(
      expect.arrayContaining(["kiln://artifacts/fan-out-test:child:2/worktree-release"]),
    );
  });

  it("treats recovered terminal children as successful fan-out evidence", async () => {
    const result = await runManagedAgentFanOutLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: createManagedInvocation({ recoveredOrdinals: new Set([2]) }),
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

    await expect(runManagedAgentFanOutLifecycle({
      orchestrationRequest: request(2),
      managedInvocation,
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
    })).rejects.toThrow("Managed fan-out budget admission denied");

    expect(usageRequests).toEqual(["codex"]);
    expect(managedInvocation.invocationService?.list()).toEqual([]);
  });

  it("cancels already-started children when a later child start fails", async () => {
    const managedInvocation = createManagedInvocation({
      failAcquireOrdinals: new Set([2]),
      holdOrdinals: new Set([1]),
    });

    await expect(runManagedAgentFanOutLifecycle({
      orchestrationRequest: request(2),
      managedInvocation,
    })).rejects.toThrow("Managed fan-out child start failed");

    const lifecycleStates = managedInvocation.invocationService?.list().map((snapshot) => snapshot.lifecycleState);
    expect(lifecycleStates).toContain("cancelled");
    expect(lifecycleStates).not.toContain("running");
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

    await expect(runManagedAgentFanOutLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: {
        ...managedInvocation,
        invocationService: fakeService as unknown as RuntimeManagedAgentInvocationService,
      },
    })).rejects.toThrow("Managed fan-out child start failed");

    expect(joined).toBe(true);
  });

  it("rebases mixed-case Windows write scopes onto the isolated child worktree", async () => {
    const result = await runManagedAgentFanOutLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: createManagedInvocation({
        sourcePath: "C:\\Repo",
        rootPath: "C:\\Repo\\.kiln\\worktrees",
        allowedPaths: ["c:\\repo\\packages"],
        deniedPaths: ["c:\\repo\\.git"],
      }),
    });

    expect(result.childRecords[0]?.record?.authority.writeAuthority?.scope.workspace.allowedPaths).toEqual([
      "C:/Repo/.kiln/worktrees/fan-out-test:child:1/packages",
    ]);
    expect(result.childRecords[0]?.record?.authority.writeAuthority?.scope.workspace.deniedPaths).toEqual([
      "C:/Repo/.kiln/worktrees/fan-out-test:child:1/.git",
    ]);
  });

  it("fails closed when no isolated lifecycle route is available", async () => {
    await expect(runManagedAgentFanOutLifecycle({
      orchestrationRequest: request(2),
      managedInvocation: {
        invocationService: new RuntimeManagedAgentInvocationService(),
        routes: [],
      },
    })).rejects.toThrow("Managed lifecycle fan-out requires an isolated-worktree");
  });

  it("fails closed when lifecycle route selection is ambiguous", async () => {
    const managedInvocation = createManagedInvocation();
    const primaryRoute = managedInvocation.routes[0]!;

    await expect(runManagedAgentFanOutLifecycle({
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
    })).rejects.toThrow("Managed lifecycle fan-out route selection is ambiguous");
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
} = {}): ManagedInvocationToolOptions {
  const sourcePath = input.sourcePath ?? "C:\\repo";
  const rootPath = input.rootPath ?? "C:\\repo\\.kiln\\worktrees";
  return {
    requestedBy: "operator",
    requestSource: "runtime-test",
    invocationService: new RuntimeManagedAgentInvocationService({
      worktreeLeaseManager: createWorktreeLeaseManager(input.failAcquireOrdinals ?? new Set()),
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

function createAdapter(input: {
  readonly failOrdinals: ReadonlySet<number>;
  readonly recoveredOrdinals: ReadonlySet<number>;
  readonly holdOrdinals: ReadonlySet<number>;
}): ManagedAgentRuntimeAdapter {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:codex:harness",
      providerId: "codex",
      adapterKind: "harness",
      supportedProfiles: ["foundation-apply-approved-writes"],
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
      const ordinal = Number(request.invocationId.split(":").at(-1));
      if (input.holdOrdinals.has(ordinal) && !abortSignal.aborted) {
        await new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      if (input.failOrdinals.has(ordinal)) {
        throw new Error(`Worker ${ordinal} failed`);
      }
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
          summary: `Worker ${ordinal} completed`,
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/handoff`],
          memoryWriteProposalUris: [],
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

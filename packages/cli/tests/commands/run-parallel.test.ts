import { describe, it, expect, vi, afterEach } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
} from "@kilnai/core";
import {
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeInvocationInput,
  type ManagedAgentRuntimeAdapter,
  type ManagedAgentWorktreeLeaseManager,
  type ManagedAgentWorktreeLeaseManagerInput,
  type ManagedAgentWorktreeLeaseReleaseInput,
  type ManagedInvocationToolOptions,
} from "@kilnai/runtime";
import { runCommand, runParallelWorkers } from "../../src/commands/run.js";
import type { KilnAppConfig } from "../../src/config.js";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "test",
  createRegistry: () => {
    throw new Error("not called");
  },
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

const LIVE_PROVEN_WRITE_AUTHORITY = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;

describe("runParallelWorkers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts managed lifecycle children and prints successful fan-out evidence", async () => {
    const managedInvocation = createManagedInvocation();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await runParallelWorkers(MOCK_APP_CONFIG, "test task", {}, 2, managedInvocation);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Orchestration:");
    expect(output).toContain("(fan-out)");
    expect(output).not.toContain("cli-run-workers");
    expect(output).toContain("Status: completed");
    expect(output).toContain("2/2 workers succeeded");
    expect(exitSpy).not.toHaveBeenCalled();
    expect(managedInvocation.invocationService?.list().map((snapshot) => snapshot.lifecycleState)).toEqual([
      "completed",
      "completed",
    ]);
  });

  it("normalizes raw managed invocation options before fan-out service execution", async () => {
    const managedInvocation = createManagedInvocation();
    const { invocationService: _omitted, ...rawManagedInvocation } = managedInvocation;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers(
      MOCK_APP_CONFIG,
      "test task",
      {},
      2,
      rawManagedInvocation,
      { exitOnFailure: false },
    )).rejects.toMatchObject({
      code: 1,
    });

    const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).not.toContain("requires an invocation service");
    expect(errorOutput).toContain("isolated worktree lease manager is required");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("uses distinct session-scoped lineage for standalone fan-out invocations", async () => {
    const firstManagedInvocation = createManagedInvocation();
    const secondManagedInvocation = createManagedInvocation();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runParallelWorkers(
      MOCK_APP_CONFIG,
      "first task",
      {},
      2,
      firstManagedInvocation,
      { exitOnFailure: false },
    );
    await runParallelWorkers(
      MOCK_APP_CONFIG,
      "second task",
      {},
      2,
      secondManagedInvocation,
      { exitOnFailure: false },
    );

    const firstParentSessionId = firstManagedInvocation.invocationService?.list()[0]?.parentSessionId;
    const secondParentSessionId = secondManagedInvocation.invocationService?.list()[0]?.parentSessionId;

    expect(firstParentSessionId).toBeDefined();
    expect(secondParentSessionId).toBeDefined();
    expect(firstParentSessionId).not.toBe("cli-run");
    expect(secondParentSessionId).not.toBe("cli-run");
    expect(firstParentSessionId).not.toBe(secondParentSessionId);
  });

  it("fails closed before launching children when no managed lifecycle route is configured", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers(MOCK_APP_CONFIG, "test task", {}, 2, undefined)).rejects.toThrow(
      "process.exit called",
    );

    expect(errorSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("Managed lifecycle fan-out");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("denies worker fan-out before launching children when configured parallel worker limits are exceeded", async () => {
    const managedInvocation = createManagedInvocation();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers({
      ...MOCK_APP_CONFIG,
      kilnYaml: {
        parallelWorkers: 1,
      },
    }, "test task", {}, 2, managedInvocation)).rejects.toThrow("process.exit called");

    expect(managedInvocation.invocationService?.list()).toEqual([]);
    expect(errorSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("orchestration.maxChildren");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("denies worker fan-out before launching children when budget-aware routing has no live usage source", async () => {
    const managedInvocation = createManagedInvocation();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers(
      MOCK_APP_CONFIG,
      "test task",
      {},
      2,
      managedInvocation,
      {
        globalConfig: budgetAwareGlobalConfig(),
      },
    )).rejects.toThrow("process.exit called");

    expect(managedInvocation.invocationService?.list()).toEqual([]);
    expect(errorSpy.mock.calls.map((c) => c[0]).join("\n")).toContain(
      "Managed fan-out budget admission denied: Budget admission requires a live usage reader.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("denies worker fan-out before launching children when every eligible route is over budget", async () => {
    const managedInvocation = createManagedInvocation();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers(
      MOCK_APP_CONFIG,
      "test task",
      {},
      2,
      managedInvocation,
      {
        globalConfig: budgetAwareGlobalConfig(),
        budgetUsageReader: async ({ providerId }) => ({
          providerId,
          tokensUsed: 11,
          source: "test-meter",
        }),
      },
    )).rejects.toThrow("process.exit called");

    expect(managedInvocation.invocationService?.list()).toEqual([]);
    expect(errorSpy.mock.calls.map((c) => c[0]).join("\n")).toContain(
      "Managed fan-out budget admission denied: All route candidates are over their configured budget ceilings.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("admits worker fan-out through runtime budget admission when an eligible route is within budget", async () => {
    const managedInvocation = createManagedInvocation();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runParallelWorkers(
      MOCK_APP_CONFIG,
      "test task",
      {},
      2,
      managedInvocation,
      {
        globalConfig: budgetAwareGlobalConfig(),
        exitOnFailure: false,
        budgetUsageReader: async ({ providerId }) => ({
          providerId,
          tokensUsed: 1,
          source: "test-meter",
        }),
      },
    );

    expect(managedInvocation.invocationService?.list()).toHaveLength(2);
  });

  it("denies worker fan-out before launching children when managed lifecycle route selection is ambiguous", async () => {
    const managedInvocation = createManagedInvocation();
    const firstRoute = managedInvocation.routes[0]!;
    const ambiguousManagedInvocation: ManagedInvocationToolOptions = {
      ...managedInvocation,
      routes: [
        firstRoute,
        {
          ...firstRoute,
          routeId: "codex-write-secondary",
        },
      ],
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers(
      MOCK_APP_CONFIG,
      "test task",
      {},
      2,
      ambiguousManagedInvocation,
    )).rejects.toThrow("process.exit called");

    expect(managedInvocation.invocationService?.list()).toEqual([]);
    expect(errorSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("orchestration.routeHealth.available");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("can convert parallel parent admission failure into a rejected exit error for embedded callers", async () => {
    const managedInvocation = createManagedInvocation();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers({
      ...MOCK_APP_CONFIG,
      kilnYaml: {
        parallelWorkers: 1,
      },
    }, "test task", {}, 2, managedInvocation, { exitOnFailure: false })).rejects.toMatchObject({
      code: 1,
    });

    expect(managedInvocation.invocationService?.list()).toEqual([]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("reports partial lifecycle results without exiting when at least one child succeeds", async () => {
    const managedInvocation = createManagedInvocation({ failOrdinals: new Set([2]) });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await runParallelWorkers(MOCK_APP_CONFIG, "test task", {}, 2, managedInvocation);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Status: partial");
    expect(output).toContain("1/2 workers succeeded");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("counts recovered managed lifecycle children as successful CLI workers", async () => {
    const managedInvocation = createManagedInvocation({ recoveredOrdinals: new Set([2]) });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await runParallelWorkers(MOCK_APP_CONFIG, "test task", {}, 2, managedInvocation);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Status: completed");
    expect(output).toContain("2/2 workers succeeded");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("passes explicit requested authority into managed lifecycle children", async () => {
    const managedInvocation = createManagedInvocation();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runParallelWorkers(MOCK_APP_CONFIG, "test task", {
      requestedAuthority: "auto",
    }, 2, managedInvocation);

    expect(managedInvocation.invocationService?.list().map((snapshot) => snapshot.request.requestedAuthority)).toEqual([
      "auto",
      "auto",
    ]);
  });

  it("exits when every managed lifecycle child fails", async () => {
    const managedInvocation = createManagedInvocation({ failOrdinals: new Set([1, 2]) });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers(MOCK_APP_CONFIG, "test task", {}, 2, managedInvocation)).rejects.toThrow(
      "process.exit called",
    );

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Status: failed");
    expect(output).toContain("0/2 workers succeeded");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("can convert all-child parallel failure into a rejected exit error for embedded callers", async () => {
    const managedInvocation = createManagedInvocation({ failOrdinals: new Set([1, 2]) });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers(
      MOCK_APP_CONFIG,
      "test task",
      {},
      2,
      managedInvocation,
      { exitOnFailure: false },
    )).rejects.toMatchObject({
      code: 1,
    });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("can convert child runCommand exit paths into rejected worker results instead of exiting the parent", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runCommand(MOCK_APP_CONFIG, " ", {}, { exitOnFailure: false })).rejects.toMatchObject({
      code: 1,
    });

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

function createManagedInvocation(input: {
  readonly failOrdinals?: ReadonlySet<number>;
  readonly recoveredOrdinals?: ReadonlySet<number>;
} = {}): ManagedInvocationToolOptions {
  return {
    requestedBy: "operator",
    requestSource: "cli:run-workers",
    invocationService: new RuntimeManagedAgentInvocationService({
      worktreeLeaseManager: createWorktreeLeaseManager(),
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
      }),
      profiles: {
        "foundation-apply-approved-writes": {
          authorityProfileId: "authority:test-write:foundation-apply-approved-writes",
          permissionProfile: "apply-approved-writes",
          allowedToolNames: ["read", "grep", "apply-patch"],
          writeAllowed: true,
          networkAllowed: false,
          workingDirectory: {
            path: "C:\\repo\\.kiln\\worktrees",
            mode: "isolated-worktree",
          },
          workingDirectoryLease: {
            mode: "git-worktree",
            sourcePath: "C:\\repo",
            rootPath: "C:\\repo\\.kiln\\worktrees",
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
                allowedPaths: ["C:\\repo"],
                deniedPaths: ["C:\\repo\\.git"],
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

function budgetAwareGlobalConfig() {
  return {
    version: "1",
    engines: {
      codex: {
        enabled: true,
      },
    },
    routing: {
      budgetAware: true,
      budget: {
        codex: {
          dailyTokenCeiling: 10,
          onCeiling: "stop",
        },
      },
    },
  } as const;
}

function createWorktreeLeaseManager(): ManagedAgentWorktreeLeaseManager {
  return {
    acquire: async (input: ManagedAgentWorktreeLeaseManagerInput) => ({
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: [`kiln://artifacts/${input.request.invocationId}/worktree-lease`],
    }),
    release: async (input: ManagedAgentWorktreeLeaseReleaseInput) => ({
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: [`kiln://artifacts/${input.request.invocationId}/worktree-release`],
    }),
  };
}

function createAdapter(input: {
  readonly failOrdinals: ReadonlySet<number>;
  readonly recoveredOrdinals: ReadonlySet<number>;
}): ManagedAgentRuntimeAdapter {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:codex:cli-harness",
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
      writeAuthority: LIVE_PROVEN_WRITE_AUTHORITY,
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    }),
    invoke: async ({ request, admission }: ManagedAgentRuntimeInvocationInput) => {
      const ordinal = Number(request.invocationId.split(":").at(-1));
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

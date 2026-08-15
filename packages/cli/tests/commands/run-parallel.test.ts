import { describe, it, expect, vi, afterEach } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
} from "@kilnai/core";
import {
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeAdapter,
  type ManagedAgentRuntimeAuthorityObserver,
  type ManagedAgentRuntimeInvocationInput,
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
    const invocationService = managedInvocation.invocationService;
    const records = await Promise.all(
      invocationService?.list().map((snapshot) => invocationService.join(snapshot.invocationId)) ?? [],
    );
    expect(records.map((result) => result.record.capabilitySnapshot.authorityEvidence.classification)).toEqual([
      "current-verified",
      "current-verified",
    ]);
  });

  it("fails closed for raw managed invocation options without runtime authority proof", async () => {
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
    expect(errorOutput).toContain("authorityEvidence.effective-policy-unproven");
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

  it("does not use session token observation as managed worker route authority", async () => {
    const managedInvocation = createManagedInvocation();
    const sessionTokenUsageReader = vi.fn(async () => ({
      observedTokens: 11,
      source: "test-meter",
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runParallelWorkers(
      MOCK_APP_CONFIG,
      "test task",
      {},
      2,
      managedInvocation,
      {
        globalConfig: sessionTurnBudgetGlobalConfig(),
        exitOnFailure: false,
        sessionTokenUsageReader,
      },
    );

    expect(managedInvocation.invocationService?.list()).toHaveLength(2);
    expect(sessionTokenUsageReader).not.toHaveBeenCalled();
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
      authorityObserver: createRuntimeAuthorityObserver(),
      worktreeLeaseManager: createWorktreeLeaseManager(),
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
        authorityCeiling: "destructive",
        toolNames: ["read", "grep", "apply-patch"],
        supportsRecursion: true,
        supportsAttachments: false,
        supportsWrite: true,
        proof: {
          status: "configured",
          source: "run-parallel-test",
          provenProfiles: ["foundation-apply-approved-writes"],
        },
        capacity: { kind: "accountless" },
        settlement: { kind: "not-required" },
      },
      createAdapter: async () => createAdapter({
        failOrdinals: input.failOrdinals ?? new Set(),
        recoveredOrdinals: input.recoveredOrdinals ?? new Set(),
      }),
      profiles: [{
          authorityProfileId: "authority:test-write:foundation-apply-approved-writes",
          admissionProfile: "foundation-apply-approved-writes",
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
      }],
    }],
  };
}

function sessionTurnBudgetGlobalConfig() {
  return {
    version: "1",
    engines: {
      codex: {
        enabled: true,
      },
    },
    sessionTurnBudget: { tokenLimit: 10, action: "stop" },
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

function createRuntimeAuthorityObserver(): ManagedAgentRuntimeAuthorityObserver {
  return {
    observe: vi.fn(async ({ request }) => ({
      approval: "on-request",
      sandbox: request.authority.toolAuthority.writeAllowed === true && request.authority.workingDirectory.mode !== "read-only"
        ? "workspace-write"
        : "read-only",
      source: "runtime-observation",
      proof: "proven",
      observedAt: "2026-07-02T08:00:00.000Z",
      validUntil: "2099-01-01T00:00:00.000Z",
      reason: "Test route has explicit runtime authority proof.",
    })),
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
      writeAuthority: LIVE_PROVEN_WRITE_AUTHORITY,
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    }),
    invoke: async ({ request, admission }: ManagedAgentRuntimeInvocationInput) => {
      const ordinal = Number(request.invocationId.split(":").at(-1));
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
            configuredModelId: request.providerRoute.model ?? "test-model",
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
            residualRisks: ["The synthetic CLI child adapter does not exercise a live provider."],
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

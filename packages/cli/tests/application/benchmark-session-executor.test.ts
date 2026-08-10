import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBenchmarkSessionExecutor } from "../../src/application/benchmark-session-executor.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";
import { createManagedDirectProviderAdapterFactory } from "../../src/config/managed-agent-direct-adapters.js";

const benchmarkExecutorMocks = vi.hoisted(() => ({
  cleanupWorktree: vi.fn(),
  closeMemoryRepository: vi.fn(),
  createDefaultRegistry: vi.fn(),
  createSessionBuiltinToolOptions: vi.fn(),
  discoverManagedAgentProviderModels: vi.fn(),
  discoverClaudeCliModelDiscovery: vi.fn(),
  discoverCodexCliModelDiscovery: vi.fn(),
  discoverGuiDirectProviderModelDiscovery: vi.fn(),
  discoverOpencodeCliModelDiscovery: vi.fn(),
  getProjectContextArtifactCache: vi.fn(),
  isDirectApiProvider: vi.fn(() => false),
  loadBuiltinToolSurfaceOptions: vi.fn(),
  loadKilnConfig: vi.fn(),
  prepare: vi.fn(),
  readGlobalConfig: vi.fn(),
  readKilnYaml: vi.fn(),
  recordRouteHealth: vi.fn(),
  resolveEffectiveModel: vi.fn(),
  resolveEngineAvailabilityMap: vi.fn(),
  resolveGlobalDefaultModel: vi.fn(),
  resolveManagedInvocationToolOptions: vi.fn(),
  resolveProviderRouteCandidates: vi.fn(),
  resolveInstructionProfileContextCandidates: vi.fn(),
  runCleanup: vi.fn(),
  runSession: vi.fn(),
  withGlobalIdentityContext: vi.fn(),
  withWorkGovernanceContext: vi.fn(),
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    GoalRunStore: class GoalRunStore {},
    WorkItemStore: class WorkItemStore {},
    createSessionBuiltinToolOptions: benchmarkExecutorMocks.createSessionBuiltinToolOptions,
    mapProviderModelRouteErrorToOutcome: vi.fn(() => ({ type: "unavailable" })),
  };
});

vi.mock("@kilnai/runtime", () => ({
  discoverClaudeCliModelDiscovery: benchmarkExecutorMocks.discoverClaudeCliModelDiscovery,
  discoverCodexCliModelDiscovery: benchmarkExecutorMocks.discoverCodexCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery: benchmarkExecutorMocks.discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery: benchmarkExecutorMocks.discoverOpencodeCliModelDiscovery,
  getProjectContextArtifactCache: benchmarkExecutorMocks.getProjectContextArtifactCache,
  ProviderModelRouteHealthStore: class ProviderModelRouteHealthStore {
    recordOutcome = benchmarkExecutorMocks.recordRouteHealth;
  },
  withManagedAgentInvocationResourceProvider: vi.fn((options) => options),
  withManagedInvocationService: vi.fn((options) => options),
}));

vi.mock("../../src/config/operator-identity-context.js", () => ({
  withGlobalIdentityContext: benchmarkExecutorMocks.withGlobalIdentityContext,
}));

vi.mock("../../src/application/work-governance-context.js", () => ({
  withWorkGovernanceContext: benchmarkExecutorMocks.withWorkGovernanceContext,
}));

vi.mock("../../src/application/agent-skill-context.js", () => ({
  withContextCandidates: vi.fn((config) => config),
}));

vi.mock("../../src/application/instruction-profile-context.js", () => ({
  resolveInstructionProfileContextCandidates: benchmarkExecutorMocks.resolveInstructionProfileContextCandidates,
}));

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: benchmarkExecutorMocks.readGlobalConfig,
  resolveGlobalDefaultModel: benchmarkExecutorMocks.resolveGlobalDefaultModel,
}));

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: benchmarkExecutorMocks.loadKilnConfig,
}));

vi.mock("../../src/config/env-config.js", () => ({
  resolveEffectiveModel: benchmarkExecutorMocks.resolveEffectiveModel,
}));

vi.mock("../../src/config/provider-route-candidates.js", () => ({
  resolveProviderRouteCandidates: benchmarkExecutorMocks.resolveProviderRouteCandidates,
}));

vi.mock("../../src/config/builtin-tool-surface-config.js", () => ({
  loadConfiguredBuiltinToolSurfaceOptions: benchmarkExecutorMocks.loadBuiltinToolSurfaceOptions,
  withProgressiveRuntimeToolProjection: vi.fn((options, profile) => ({
    ...options,
    toolProjection: {
      mode: "deferred",
      alwaysOnTools: profile === "read-only" ? [
        "read",
        "read_many",
        "grep",
        "glob",
        "tree",
        "stat",
        "git",
        "json_query",
        "code_intelligence",
        "web_search",
        "web_fetch",
        "web_extract",
        "kiln_config.read",
        "work_governance.assess",
        "work_profile.list",
        "work_item.list",
      ] : [],
    },
  })),
}));

vi.mock("../../src/config/managed-agent-provider-models.js", () => ({
  discoverManagedAgentProviderModels: benchmarkExecutorMocks.discoverManagedAgentProviderModels,
}));

vi.mock("../../src/config/managed-agent-direct-adapters.js", () => ({
  createManagedDirectProviderAdapterFactory: vi.fn(() => () => ({})),
}));

vi.mock("../../src/config/managed-agent-routes.js", () => ({
  resolveManagedInvocationToolOptions: benchmarkExecutorMocks.resolveManagedInvocationToolOptions,
}));

vi.mock("../../src/engines/engine-registry.js", () => ({
  resolveEngineAvailabilityMap: benchmarkExecutorMocks.resolveEngineAvailabilityMap,
}));

vi.mock("../../src/kiln-yaml.js", () => ({
  readKilnYaml: benchmarkExecutorMocks.readKilnYaml,
}));

vi.mock("../../src/application/config-tools.js", () => ({
  createKilnConfigTools: vi.fn(() => []),
}));

vi.mock("../../src/application/work-governance-tool.js", () => ({
  createWorkGovernanceTools: vi.fn(() => []),
}));

vi.mock("../../src/application/session-hooks.js", () => ({
  SessionHooks: class SessionHooks {},
}));

vi.mock("../../src/wrapper/cleanup-registry.js", () => ({
  CleanupRegistry: class CleanupRegistry {
    register = vi.fn();
    runAll = benchmarkExecutorMocks.runCleanup;
  },
}));

vi.mock("../../src/wrapper/session-manager.js", () => ({
  SessionManager: class SessionManager {
    prepare = benchmarkExecutorMocks.prepare;
    cleanupWorktree = benchmarkExecutorMocks.cleanupWorktree;
    trackCostUpdate = vi.fn();
  },
}));

vi.mock("../../src/wrapper/session-registry.js", () => ({
  createDefaultRegistry: benchmarkExecutorMocks.createDefaultRegistry,
  isDirectApiProvider: benchmarkExecutorMocks.isDirectApiProvider,
}));

vi.mock("../../src/wrapper/index.js", () => ({
  ApprovalMemoryStore: class ApprovalMemoryStore {},
}));

vi.mock("../../src/application/run-session.js", () => ({
  runSession: benchmarkExecutorMocks.runSession,
}));

const MOCK_APP_CONFIG = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Test",
  createRegistry: () => {
    throw new Error("createRegistry not called in benchmark session executor tests");
  },
  mcpServerName: "kiln",
};

function makeBenchmarkContext(item: {
  readonly id: string;
  readonly input: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}, profile: {
  readonly id?: string;
  readonly authorityProfile?: string;
} = {}) {
  return {
    profile: {
      id: profile.id ?? "kiln-tool-agent",
      version: "1",
      displayName: "Kiln Tool Agent",
      surface: "tool-calling",
      purpose: "Tool calling.",
      authorityProfile: profile.authorityProfile ?? "foundation-readonly-plan",
      requiredScorers: [],
      minimumPassAtK: 1,
      minimumK: 1,
      reproducibilityRequirements: [],
      externalTrackCandidates: [],
    },
    datasetName: "exact-format",
    datasetVersion: "1",
    runIndex: 0,
    item,
  } as never;
}

describe("createBenchmarkSessionExecutor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    benchmarkExecutorMocks.isDirectApiProvider.mockImplementation(() => false);
    benchmarkExecutorMocks.cleanupWorktree.mockResolvedValue(undefined);
    benchmarkExecutorMocks.closeMemoryRepository.mockReturnValue(undefined);
    benchmarkExecutorMocks.createDefaultRegistry.mockReturnValue({
      registry: {},
      worktreeManager: {},
    });
    benchmarkExecutorMocks.createSessionBuiltinToolOptions.mockImplementation((options) => ({
      ...options,
      artifactResources: { store: {} },
    }));
    benchmarkExecutorMocks.discoverManagedAgentProviderModels.mockResolvedValue({});
    benchmarkExecutorMocks.discoverClaudeCliModelDiscovery.mockResolvedValue({
      models: ["claude-sonnet-5"],
      modelCapabilities: {
        "claude-sonnet-5": {
          deliberation: {
            provider: "claude",
            model: "claude-sonnet-5",
            levels: [{ id: "low" }, { id: "high" }],
            supportsAdaptive: true,
            evidence: {
              sourceIdentity: "claude-code-model-catalog",
              sourceRevision: "2.1.226",
              observedAt: "2026-08-10T00:00:00.000Z",
            },
          },
        },
      },
      status: "available",
      reason: "test",
      authState: "authenticated",
    });
    benchmarkExecutorMocks.discoverCodexCliModelDiscovery.mockResolvedValue({
      models: ["benchmark-model"],
      modelCapabilities: {
        "benchmark-model": {
          deliberation: {
            levels: ["low", "medium", "high"].map((id) => ({ id })),
            defaultLevel: "medium",
            supportsAdaptive: false,
            evidence: {
              sourceIdentity: "synthetic-codex-catalog",
              sourceRevision: "revision-1",
              observedAt: "2026-08-02T00:00:00.000Z",
            },
          },
        },
      },
      status: "available",
      reason: "test",
      authState: "authenticated",
    });
    benchmarkExecutorMocks.discoverGuiDirectProviderModelDiscovery.mockResolvedValue({});
    benchmarkExecutorMocks.discoverOpencodeCliModelDiscovery.mockResolvedValue({
      models: [],
      status: "unavailable",
      reason: "test",
      authState: "unknown",
    });
    benchmarkExecutorMocks.getProjectContextArtifactCache.mockResolvedValue({});
    benchmarkExecutorMocks.loadBuiltinToolSurfaceOptions.mockResolvedValue({
      memoryResources: {
        repository: { close: benchmarkExecutorMocks.closeMemoryRepository },
      },
    });
    benchmarkExecutorMocks.loadKilnConfig.mockResolvedValue({});
    benchmarkExecutorMocks.prepare.mockResolvedValue({
      systemPrompt: "system",
      projectedContext: { blocks: [], estimatedTokens: 0 },
      memorySnapshot: undefined,
      mcpServerEntryPath: "mcp-server",
      workingDirectory: process.cwd(),
      task: "Return exact output.",
      domain: {
        name: "generic",
        displayName: "Generic",
        detectPatterns: [],
        toolTags: new Set(),
        qualityGates: [],
        multishotExamples: "",
        phaseExamples: "",
      },
    });
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue({});
    benchmarkExecutorMocks.readKilnYaml.mockReturnValue({});
    benchmarkExecutorMocks.recordRouteHealth.mockResolvedValue(undefined);
    benchmarkExecutorMocks.resolveEffectiveModel.mockReturnValue("benchmark-model");
    benchmarkExecutorMocks.resolveEngineAvailabilityMap.mockReturnValue(new Map());
    benchmarkExecutorMocks.resolveGlobalDefaultModel.mockReturnValue("benchmark-model");
    benchmarkExecutorMocks.resolveManagedInvocationToolOptions.mockResolvedValue({});
    benchmarkExecutorMocks.resolveProviderRouteCandidates.mockReturnValue([]);
    benchmarkExecutorMocks.resolveInstructionProfileContextCandidates.mockReturnValue([]);
    benchmarkExecutorMocks.runCleanup.mockResolvedValue(undefined);
    benchmarkExecutorMocks.withGlobalIdentityContext.mockImplementation((config) => config);
    benchmarkExecutorMocks.withWorkGovernanceContext.mockImplementation((config) => config);
    benchmarkExecutorMocks.runSession.mockImplementation(async (options: {
      readonly output?: {
        readonly mode: string;
        writeAssistantDelta(content: string): void;
        resetAssistantAnswer(answer: string): void;
        writeToolUse(toolName: string): void;
        writeProviderFallback(providerId: string): void;
      };
    }) => {
      if (options.output) {
        options.output.writeAssistantDelta("Only one sentence.");
        options.output.writeToolUse("status");
      } else {
        process.stdout.write("Only one sentence.");
        console.log("[tool] status");
      }
      return {
        accumulatedText: "Only one sentence.",
        attempts: [],
        exactArtifacts: [],
        finalCostEvidence: {
          kind: "subscription",
          currency: "USD",
          amountUsd: 0,
          comparable: false,
          reason: "subscription billing does not expose per-call metered charges",
        },
        finalCostUsd: 0,
        inputTokens: 4,
        lastError: null,
        outputTokens: 3,
        providerRequests: [{
          requestIndex: 0,
          inputTokens: 4,
          outputTokens: 3,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cumulativeInputTokens: 4,
          cumulativeOutputTokens: 3,
          cumulativeCacheReadTokens: 0,
          cumulativeCacheWriteTokens: 0,
          systemBytes: 100,
          messageBytes: 50,
          toolSchemaBytes: 25,
          systemHash: "sha256:system",
          messageHash: "sha256:message",
          toolSchemaHash: "sha256:tools",
          stablePrefixHash: "sha256:prefix",
          toolCount: 2,
          stopReason: "end_turn",
        }],
        sessionSucceeded: true,
        successfulModelId: "benchmark-model",
        successfulProviderId: "codex",
        transcript: [],
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes benchmark item sessions through a non-human output sink without writing assistant or tool text to stdout", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    const result = await executor("Return exactly one sentence.", {
      ...makeBenchmarkContext({
        id: "exact-one-sentence",
        input: "Return exactly one sentence.",
      }),
    });

    expect(result.output).toBe("Only one sentence.");
    expect(result.metadata).toMatchObject({
      costEvidence: {
        kind: "subscription",
        currency: "USD",
        amountUsd: 0,
        comparable: false,
      },
      providerRequests: [expect.objectContaining({
        requestIndex: 0,
        cumulativeInputTokens: 4,
        toolSchemaBytes: 25,
        stablePrefixHash: "sha256:prefix",
      })],
    });
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledWith(expect.objectContaining({
      output: expect.objectContaining({ mode: "answer" }),
      sessionConfig: expect.objectContaining({
        executionEnvelope: { toolRounds: { max: 8 } },
        requestedAuthority: "read_only",
      }),
    }));
    expect(createManagedDirectProviderAdapterFactory).toHaveBeenCalledWith(expect.objectContaining({
      executionEnvelope: { toolRounds: { max: 8 } },
    }));
    expect(benchmarkExecutorMocks.createSessionBuiltinToolOptions).toHaveBeenCalledWith(expect.objectContaining({
      toolProjection: {
        mode: "deferred",
        alwaysOnTools: expect.arrayContaining([
          "read",
          "read_many",
          "web_search",
          "work_item.list",
        ]),
      },
    }));
    const projectedTools = benchmarkExecutorMocks.createSessionBuiltinToolOptions.mock.calls[0]?.[0]
      ?.toolProjection?.alwaysOnTools;
    expect(projectedTools).not.toContain("bash");
    expect(projectedTools).not.toContain("write");
    expect(projectedTools).not.toContain("kiln_config.propose_change");
    expect(projectedTools).not.toContain("kiln_config.apply_change");
    expect(projectedTools).not.toContain("work_item.update");
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("[tool] status"));
  });

  it("runs declared synthetic fixtures without loading project context from the repository root", async () => {
    const repositoryRoot = resolveProjectRoot().rootPath;
    const fixturePath = "packages/core/evals/fixtures/model-roster-v1";
    const expectedWorkspace = join(repositoryRoot, ...fixturePath.split("/"));
    const priorManagedResolutionCount = benchmarkExecutorMocks.resolveManagedInvocationToolOptions.mock.calls.length;
    const priorIdentityContextCount = benchmarkExecutorMocks.withGlobalIdentityContext.mock.calls.length;
    const priorGovernanceContextCount = benchmarkExecutorMocks.withWorkGovernanceContext.mock.calls.length;
    const priorInstructionContextCount = benchmarkExecutorMocks.resolveInstructionProfileContextCandidates.mock.calls.length;
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    const result = await executor("Inspect only the fixture.", makeBenchmarkContext({
      id: "synthetic-fixture",
      input: "Inspect only the fixture.",
      metadata: { workspaceFixture: fixturePath },
    }));

    expect(benchmarkExecutorMocks.getProjectContextArtifactCache).toHaveBeenCalledWith(expectedWorkspace);
    expect(benchmarkExecutorMocks.prepare).toHaveBeenCalledWith(
      expect.stringContaining("Use paths relative to this workspace root"),
      expectedWorkspace,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionConfig: expect.objectContaining({
        cwd: expectedWorkspace,
        task: expect.stringContaining("Do not prepend the fixture declaration"),
      }),
    }));
    expect(result.metadata).toMatchObject({
      benchmarkWorkspaceKind: "synthetic-fixture",
      workspaceFixture: fixturePath,
      workspaceFixtureHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(benchmarkExecutorMocks.resolveManagedInvocationToolOptions).toHaveBeenCalledTimes(priorManagedResolutionCount);
    expect(benchmarkExecutorMocks.withGlobalIdentityContext).toHaveBeenCalledTimes(priorIdentityContextCount);
    expect(benchmarkExecutorMocks.withWorkGovernanceContext).toHaveBeenCalledTimes(priorGovernanceContextCount);
    expect(benchmarkExecutorMocks.resolveInstructionProfileContextCandidates).toHaveBeenCalledTimes(priorInstructionContextCount);
  });

  it("runs write profiles only in a disposable strict direct-provider lease", async () => {
    const fixturePath = "packages/core/evals/fixtures/model-roster-v1";
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.resolveProviderRouteCandidates.mockReturnValue([
      { provider: "opencode-go", model: "glm-5.2" },
    ]);
    benchmarkExecutorMocks.prepare.mockImplementationOnce(async (_task, cwd) => ({
      systemPrompt: "system",
      projectedContext: { blocks: [], estimatedTokens: 0 },
      memorySnapshot: undefined,
      mcpServerEntryPath: "mcp-server",
      workingDirectory: cwd,
      task: "Fix the fixture.",
      domain: {
        name: "generic",
        displayName: "Generic",
        detectPatterns: [],
        toolTags: new Set(),
        qualityGates: [],
        multishotExamples: "",
        phaseExamples: "",
      },
    }));
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation()!;
    let leaseRoot = "";
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (options) => {
      leaseRoot = options.context.workingDirectory;
      writeFileSync(join(leaseRoot, "README.md"), "changed inside disposable lease\n", "utf8");
      return defaultRun(options);
    });
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    const result = await executor("Fix the fixture.", makeBenchmarkContext({
      id: "backend-write",
      input: "Fix the fixture.",
      metadata: { workspaceFixture: fixturePath },
    }, {
      id: "kiln-model-roster-backend-write",
      authorityProfile: "foundation-apply-approved-writes",
    }));

    expect(leaseRoot).toContain("kiln-benchmark-write-");
    expect(existsSync(leaseRoot)).toBe(false);
    expect(benchmarkExecutorMocks.createSessionBuiltinToolOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      toolProjection: {
        mode: "strict",
        alwaysOnTools: ["read", "read_many", "grep", "glob", "tree", "stat", "write", "edit", "patch"],
      },
    }));
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledWith(expect.objectContaining({
      permissionPolicy: { approval: "never", sandbox: "workspace-write" },
      sessionConfig: expect.objectContaining({
        cwd: leaseRoot,
        requestedAuthority: "destructive",
      }),
      toolSandbox: expect.objectContaining({ policy: expect.anything() }),
    }));
    expect(result.metadata?.workspaceChanges).toMatchObject({
      changed: [expect.objectContaining({ path: "README.md" })],
      added: [],
      deleted: [],
    });
  });

  it("rejects native CLI routes for write profiles before execution", async () => {
    const priorRunCount = benchmarkExecutorMocks.runSession.mock.calls.length;
    benchmarkExecutorMocks.resolveProviderRouteCandidates.mockReturnValue([
      { provider: "opencode", model: "glm-5.2" },
    ]);
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    await expect(executor("Fix the fixture.", makeBenchmarkContext({
      id: "backend-write-native",
      input: "Fix the fixture.",
      metadata: { workspaceFixture: "packages/core/evals/fixtures/model-roster-v1" },
    }, {
      id: "kiln-model-roster-backend-write",
      authorityProfile: "foundation-apply-approved-writes",
    }))).rejects.toThrow("require explicit Kiln-executable direct-provider routes");
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledTimes(priorRunCount);
  });

  it("resolves a supported deliberation level and records exact route evidence", async () => {
    benchmarkExecutorMocks.resolveProviderRouteCandidates.mockReturnValue([
      { provider: "codex", model: "benchmark-model" },
    ]);
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        provider: "codex",
        model: "benchmark-model",
        deliberationLevel: "high",
      },
    });

    const result = await executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "deliberation-level",
      input: "Return exactly one sentence.",
    }));

    const expectedResolution = {
      status: "exact",
      requested: { mode: "fixed", preferredLevel: "high", onUnsupported: "deny" },
      selectedLevel: "high",
      source: "operator",
      capabilityEvidence: {
        sourceIdentity: "synthetic-codex-catalog",
        sourceRevision: "revision-1",
        observedAt: "2026-08-02T00:00:00.000Z",
      },
    };
    expect(result.metadata?.deliberationResolution).toEqual(expectedResolution);
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledWith(expect.objectContaining({
      routeCandidates: [{
        provider: "codex",
        model: "benchmark-model",
        deliberationResolution: expectedResolution,
      }],
      sessionConfig: expect.objectContaining({ deliberationResolution: expectedResolution }),
    }));
  });

  it("resolves Claude deliberation from the executable-bound catalog", async () => {
    benchmarkExecutorMocks.resolveProviderRouteCandidates.mockReturnValue([
      { provider: "claude", model: "claude-sonnet-5" },
    ]);
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        provider: "claude",
        model: "claude-sonnet-5",
        deliberationLevel: "low",
      },
    });

    const result = await executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "claude-deliberation-level",
      input: "Return exactly one sentence.",
    }));

    expect(result.metadata?.deliberationResolution).toMatchObject({
      status: "exact",
      selectedLevel: "low",
      capabilityEvidence: {
        sourceIdentity: "claude-code-model-catalog",
        sourceRevision: "2.1.226",
      },
    });
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledWith(expect.objectContaining({
      routeCandidates: [expect.objectContaining({
        provider: "claude",
        model: "claude-sonnet-5",
        deliberationResolution: expect.objectContaining({ selectedLevel: "low" }),
      })],
    }));
  });

  it("fails closed when a requested deliberation level lacks capability evidence", async () => {
    const priorRunCount = benchmarkExecutorMocks.runSession.mock.calls.length;
    benchmarkExecutorMocks.resolveProviderRouteCandidates.mockReturnValue([
      { provider: "codex", model: "unknown-model" },
    ]);
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        provider: "codex",
        model: "unknown-model",
        deliberationLevel: "high",
      },
    });

    await expect(executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "unsupported-deliberation",
      input: "Return exactly one sentence.",
    }))).rejects.toThrow("capability-unknown");
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledTimes(priorRunCount);
  });

  it("keeps abandoned provider partial output and fallback telemetry out of stdout", async () => {
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (options: {
      readonly output?: {
        writeAssistantDelta(content: string): void;
        resetAssistantAnswer(answer: string): void;
        writeProviderFallback(providerId: string): void;
      };
    }) => {
      options.output?.writeAssistantDelta("abandoned partial");
      options.output?.resetAssistantAnswer("");
      options.output?.writeProviderFallback("codex");
      options.output?.writeAssistantDelta("fallback answer");
      return {
        accumulatedText: "fallback answer",
        attempts: [
          { providerId: "codex", succeeded: false, error: "primary failed" },
          { providerId: "opencode", succeeded: true, error: null },
        ],
        exactArtifacts: [],
        finalCostEvidence: {
          kind: "subscription",
          currency: "USD",
          amountUsd: 0,
          comparable: false,
          reason: "subscription billing does not expose per-call metered charges",
        },
        finalCostUsd: 0,
        inputTokens: 4,
        lastError: null,
        outputTokens: 3,
        sessionSucceeded: true,
        successfulModelId: "benchmark-model",
        successfulProviderId: "opencode",
        transcript: [],
      };
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    const result = await executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "fallback",
      input: "Return exactly one sentence.",
    }));

    expect(result.output).toBe("fallback answer");
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("Provider codex failed"));
  });

  it("keeps terminal failure diagnostics in metadata without writing failed partial output to stdout", async () => {
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (options: {
      readonly output?: { writeAssistantDelta(content: string): void };
    }) => {
      options.output?.writeAssistantDelta("failed partial");
      return {
        accumulatedText: "failed partial",
        attempts: [{ providerId: "codex", succeeded: false, error: "Provider failed" }],
        exactArtifacts: ["Provider error: Provider failed"],
        finalCostEvidence: {
          kind: "unknown",
          currency: "unknown",
          amountUsd: 0,
          comparable: false,
          reason: "metered pricing is missing for provider/model",
        },
        finalCostUsd: 0,
        inputTokens: 4,
        lastError: "Provider failed",
        outputTokens: 2,
        sessionSucceeded: false,
        successfulModelId: undefined,
        successfulProviderId: undefined,
        transcript: [],
      };
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    const result = await executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "failure",
      input: "Return exactly one sentence.",
    }));

    expect(result.output).toBe("failed partial");
    expect(result.metadata).toMatchObject({
      sessionSucceeded: false,
      policyViolations: ["Provider failed"],
      routeFailures: ["codex: Provider failed"],
    });
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("keeps timeout-shaped failures out of stdout while preserving the scored session output", async () => {
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (options: {
      readonly output?: { writeAssistantDelta(content: string): void };
    }) => {
      options.output?.writeAssistantDelta("timeout partial");
      return {
        accumulatedText: "timeout partial",
        attempts: [{ providerId: "codex", succeeded: false, error: "Timed out after 1000ms" }],
        exactArtifacts: ["Provider error: Timed out after 1000ms"],
        finalCostEvidence: {
          kind: "unknown",
          currency: "unknown",
          amountUsd: 0,
          comparable: false,
          reason: "metered pricing is missing for provider/model",
        },
        finalCostUsd: 0,
        inputTokens: 4,
        lastError: "Timed out after 1000ms",
        outputTokens: 2,
        sessionSucceeded: false,
        successfulModelId: undefined,
        successfulProviderId: undefined,
        transcript: [],
      };
    });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    const result = await executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "timeout",
      input: "Return exactly one sentence.",
    }));

    expect(result.output).toBe("timeout partial");
    expect(result.metadata).toMatchObject({
      sessionSucceeded: false,
      policyViolations: ["Timed out after 1000ms"],
    });
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });
});

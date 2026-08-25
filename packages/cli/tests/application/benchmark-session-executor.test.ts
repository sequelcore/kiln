import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import type { BenchmarkItemExecutionContext } from "@kilnai/core/eval";
import {
  captureBenchmarkConfigurationAdmission,
  createBenchmarkSessionExecutor,
} from "../../src/application/benchmark-session-executor.js";
import type {
  PrivateFormalScreeningCaseFacts,
  PrivateFormalScreeningPackageFacts,
} from "../../src/application/private-formal-screening-package.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { hashBenchmarkWorkspace, resolveBenchmarkWorkspace } from "../../src/application/benchmark-workspace.js";
import { TranscriptStore } from "../../src/wrapper/session-store.js";
import { createManagedDirectProviderAdapterFactory } from "../../src/config/managed-agent-direct-adapters.js";
import { makeOperatorSurfaceGlobalConfig } from "../commands/operator-surface-config-fixture.js";

const benchmarkExecutorMocks = vi.hoisted(() => ({
  cleanupWorktree: vi.fn(),
  closeManagedAccountRuntimeComposition: vi.fn(),
  closeMemoryRepository: vi.fn(),
  createDefaultRegistry: vi.fn(),
  createBenchmarkAuthorityWorkspaceLease: vi.fn(() => ({
    rootPath: join(tmpdir(), "kiln-test-benchmark-authority"),
    cleanup: vi.fn(),
  })),
  createPrivateFormalScreeningWorkspaceLease: vi.fn(),
  createManagedAccountRuntimeComposition: vi.fn(() => ({
    routing: {},
    authority: {},
    updateCatalog: vi.fn(),
    close: vi.fn(),
  })),
  createProjectBoundedWorkAuthority: vi.fn(() => ({
    surface: { projectRuntimeId: "project:test", authority: {} },
    admitExecutionAttempt: vi.fn(),
    closeoutCandidate: vi.fn(),
    closeoutGoal: vi.fn(),
    close: vi.fn(),
  })),
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
  readGlobalConfigSnapshot: vi.fn(() => ({
    config: benchmarkExecutorMocks.readGlobalConfig(),
    revision: `sha256:${"b".repeat(64)}`,
  })),
  readKilnYamlFile: vi.fn(),
  readRuntimeConfigurationRevision: vi.fn(() => ({
    revisionSetId: `sha256:${"a".repeat(64)}`,
    revisions: {
      global: `sha256:${"b".repeat(64)}`,
      project: `sha256:${"c".repeat(64)}`,
      "project-state": `sha256:${"d".repeat(64)}`,
      adoption: `sha256:${"e".repeat(64)}`,
      "execution-target-evidence": `sha256:${"f".repeat(64)}`,
    },
  })),
  recordRouteHealth: vi.fn(),
  resolveEngineAvailabilityMap: vi.fn(),
  resolveManagedInvocationToolOptions: vi.fn(),
  resolveInstructionProfileContextCandidates: vi.fn(),
  runCleanup: vi.fn(),
  runSession: vi.fn(),
  verifyBackendBenchmarkLease: vi.fn(),
  createCanonicalRunSessionDispatcher: vi.fn(),
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

vi.mock("../../src/config/global-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/global-config.js")>();
  const fixtures = await import("../config/execution-target-evidence-fixture.js");
  return {
    ...actual,
    readGlobalConfig: benchmarkExecutorMocks.readGlobalConfig,
    readGlobalConfigSnapshot: benchmarkExecutorMocks.readGlobalConfigSnapshot,
    readGlobalExecutionCatalog: (config: Parameters<typeof fixtures.syntheticExecutionCatalog>[0] | undefined) =>
      config ? fixtures.syntheticExecutionCatalog(config) ?? undefined : undefined,
  };
});

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: benchmarkExecutorMocks.loadKilnConfig,
}));

vi.mock("../../src/config/builtin-tool-surface-config.js", () => ({
  loadConfiguredBuiltinToolSurfaceOptions: benchmarkExecutorMocks.loadBuiltinToolSurfaceOptions,
  observeFormalVerificationCapability: vi.fn((options) => ({
    metric: "formal_verification",
    status: options.formalVerify === undefined ? "unavailable" : "available",
  })),
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
  closeManagedAccountRuntimeComposition: benchmarkExecutorMocks.closeManagedAccountRuntimeComposition,
  createManagedAccountRuntimeComposition: benchmarkExecutorMocks.createManagedAccountRuntimeComposition,
  resolveManagedInvocationToolOptions: benchmarkExecutorMocks.resolveManagedInvocationToolOptions,
}));

vi.mock("../../src/application/benchmark-authority-workspace.js", () => ({
  createBenchmarkAuthorityWorkspaceLease: benchmarkExecutorMocks.createBenchmarkAuthorityWorkspaceLease,
}));

vi.mock("../../src/application/private-formal-screening-package.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/application/private-formal-screening-package.js")>()),
  createPrivateFormalScreeningWorkspaceLease: benchmarkExecutorMocks.createPrivateFormalScreeningWorkspaceLease,
}));

vi.mock("../../src/application/benchmark-backend-verifier.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/application/benchmark-backend-verifier.js")>()),
  verifyBackendBenchmarkLease: benchmarkExecutorMocks.verifyBackendBenchmarkLease,
}));

vi.mock("../../src/engines/engine-registry.js", () => ({
  resolveEngineAvailabilityMap: benchmarkExecutorMocks.resolveEngineAvailabilityMap,
}));

vi.mock("../../src/kiln-yaml.js", () => ({
  readKilnYamlFile: benchmarkExecutorMocks.readKilnYamlFile,
}));

vi.mock("../../src/application/runtime-configuration-revision.js", () => ({
  readRuntimeConfigurationRevision: benchmarkExecutorMocks.readRuntimeConfigurationRevision,
}));

vi.mock("../../src/application/config-tools.js", () => ({
  createKilnConfigTools: vi.fn(() => []),
}));

vi.mock("../../src/application/work-governance-tool.js", () => ({
  createWorkGovernanceTools: vi.fn(() => []),
}));

vi.mock("../../src/application/bounded-work-authority-composition.js", () => ({
  createProjectBoundedWorkAuthority: benchmarkExecutorMocks.createProjectBoundedWorkAuthority,
}));

vi.mock("../../src/application/canonical-run-session-dispatcher.js", () => ({
  createCanonicalRunSessionDispatcher: benchmarkExecutorMocks.createCanonicalRunSessionDispatcher.mockImplementation((input: {
    readonly catalog: { readonly routes: readonly { readonly id: string; readonly providerId: string; readonly providerModelId: string }[] };
    readonly routeId: string;
    readonly routeEvidence?: object;
  }) => ({
    dispatch: (payload: object) => {
      const route = input.catalog.routes.find((candidate) => candidate.id === input.routeId)!;
      return benchmarkExecutorMocks.runSession({
        ...payload,
        routeCandidates: [{
          routeId: route.id,
          provider: route.providerId,
          model: route.providerModelId,
          ...(input.routeEvidence ?? {}),
        }],
      });
    },
    close: vi.fn(),
  })),
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

const FORMAL_SOURCE_BEFORE = "sha256:" + "a".repeat(64);
const FORMAL_SOURCE_AFTER = "sha256:" + "b".repeat(64);
const FORMAL_HIDDEN_DIGEST = "sha256:" + "c".repeat(64);
const FORMAL_CASES = ["C0", "T"].map((arm) => ({
  id: `formal-pair-1-${arm}`,
  pairId: "pair-1",
  arm,
  prompt: "Implement the private task.",
  visibleFixture: "visible/pair-1",
  visibleFixturePath: "C:/private/formal/visible/pair-1",
  packageRootPath: "C:/private/formal",
  candidatePath: "src/solution.ts",
  allowedChangedPaths: ["src/solution.ts"],
  hiddenTestSource: "test(\"one\", () => {});",
  hiddenTestDigest: FORMAL_HIDDEN_DIGEST,
  hiddenTestCount: 1,
  hiddenOracleExhaustive: true,
  requiredFunctionNames: ["solve"],
})) as unknown as readonly PrivateFormalScreeningCaseFacts[];
const FORMAL_PACKAGE = {
  version: "private-formal-screening-v1",
  rootPath: "C:/private/formal",
  cases: FORMAL_CASES,
} as unknown as PrivateFormalScreeningPackageFacts;
const FORMAL_CONFIG = {
  privatePackagePath: "C:/private/formal",
  lemmaScriptPackageRoot: "C:/tools/lemmascript",
  lscScriptPath: "C:/tools/lemmascript/lsc.js",
  expectedLemmaScriptVersion: "0.6.0",
  dafnyExecutable: "C:/tools/dafny.exe",
  expectedDafnyVersion: "4.11.0",
};

function makeBenchmarkContext(item: {
  readonly id: string;
  readonly input: string;
  readonly metadata?: Record<string, unknown>;
}, profile: {
  readonly id?: string;
  readonly authorityProfile?: string;
} = {}, execution: {
  readonly runIndex?: number;
  readonly repeatIndex?: number;
} = {}): BenchmarkItemExecutionContext {
  return {
    profile: {
      id: profile.id ?? "kiln-tool-agent",
      version: "1",
      displayName: "Kiln Tool Agent",
      surface: "tool-calling",
      purpose: "Tool calling.",
      authorityProfile: profile.authorityProfile ?? "foundation-readonly-plan",
      requiredScorers: [],
      admissionScorers: [],
      minimumDatasetItems: 1,
      minimumPassRate: 0,
      minimumPassAtK: 1,
      minimumK: 1,
      maximumInvalidTrialRate: 1,
      maxInvalidAttempts: 0,
      reproducibilityRequirements: [],
      externalTrackCandidates: [],
    },
    datasetName: "exact-format",
    datasetVersion: "1",
    runIndex: execution.runIndex ?? 0,
    repeatIndex: execution.repeatIndex ?? 0,
    item,
  };
}

describe("createBenchmarkSessionExecutor", () => {
  it("rejects when effective configuration changes while policy is captured", async () => {
    let reads = 0;
    benchmarkExecutorMocks.readRuntimeConfigurationRevision.mockImplementation(() => ({
      revisionSetId: `sha256:${(reads++ % 2 === 0 ? "a" : "9").repeat(64)}`,
      revisions: {
        global: `sha256:${"b".repeat(64)}`,
        project: `sha256:${"c".repeat(64)}`,
        "project-state": `sha256:${"d".repeat(64)}`,
        adoption: `sha256:${"e".repeat(64)}`,
        "execution-target-evidence": `sha256:${"f".repeat(64)}`,
      },
    }));

    await expect(captureBenchmarkConfigurationAdmission({
      repositoryRoot: process.cwd(),
      appConfig: MOCK_APP_CONFIG,
      mode: "write",
    })).rejects.toThrow(/changed during preflight admission/iu);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    benchmarkExecutorMocks.readRuntimeConfigurationRevision.mockImplementation(() => ({
      revisionSetId: `sha256:${"a".repeat(64)}`,
      revisions: {
        global: `sha256:${"b".repeat(64)}`,
        project: `sha256:${"c".repeat(64)}`,
        "project-state": `sha256:${"d".repeat(64)}`,
        adoption: `sha256:${"e".repeat(64)}`,
        "execution-target-evidence": `sha256:${"f".repeat(64)}`,
      },
    }));
    mkdirSync(join(tmpdir(), "kiln-test-benchmark-authority"), { recursive: true });
    benchmarkExecutorMocks.createPrivateFormalScreeningWorkspaceLease.mockImplementation(() => ({
      leaseId: "benchmark-write:test",
      rootPath: "C:/temp/private-formal-lease",
      bridgeRootPath: "C:/temp/private-formal-bridge",
      canonicalHash: "sha256:" + "d".repeat(64),
      initialSnapshot: { files: [] },
      collectChanges: () => ({
        changed: [{ path: "src/solution.ts", beforeHash: FORMAL_SOURCE_BEFORE, afterHash: FORMAL_SOURCE_AFTER }],
        added: [],
        deleted: [],
      }),
      verifyCanonicalUnchanged: vi.fn(),
      cleanup: vi.fn(),
    }));
    benchmarkExecutorMocks.verifyBackendBenchmarkLease.mockImplementation(async (input) => ({
      verifierId: "kiln.backend-write.v2",
      verifierVersion: "2",
      benchmarkCaseId: input.benchmarkCase.id,
      status: "passed",
      testDigest: input.benchmarkCase.hiddenTestDigest,
      runner: {
        kind: "docker",
        image: "kiln/backend-benchmark-verifier:2",
        network: "none",
        rootFilesystem: "read-only",
      },
      changes: input.lease.collectChanges(),
      violations: [],
      tests: { exitCode: 0, passed: 1, failed: 0, timedOut: false, output: "pass 1" },
    }));
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
    benchmarkExecutorMocks.loadKilnConfig.mockResolvedValue({
      version: "1",
      permissions: {
        approval: "never",
        sandbox: "workspace-write",
        safeDefaults: false,
        tools: [
          { tool: "write", action: "allow" },
          { tool: "edit", action: "allow" },
          { tool: "patch", action: "allow" },
        ],
      },
    });
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
    benchmarkExecutorMocks.readKilnYamlFile.mockReturnValue({});
    benchmarkExecutorMocks.recordRouteHealth.mockResolvedValue(undefined);
    benchmarkExecutorMocks.resolveEngineAvailabilityMap.mockReturnValue(new Map());
    benchmarkExecutorMocks.resolveManagedInvocationToolOptions.mockResolvedValue({});
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
        executionBindings: [],
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
      operatorAdoption: expect.objectContaining({
        persist: expect.any(Function),
        replayCanonicalSessionEvents: expect.any(Function),
      }),
      sessionConfig: expect.objectContaining({
        executionEnvelope: { toolRounds: { max: 8 } },
        requestedAuthority: "read_only",
      }),
    }));
    expect(createManagedDirectProviderAdapterFactory).toHaveBeenCalledWith(expect.objectContaining({
      executionEnvelope: { toolRounds: { max: 8 } },
      runtimeToolActionClaims: expect.objectContaining({
        claim: expect.any(Function),
        settle: expect.any(Function),
      }),
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
    expect(projectedTools).not.toContain("goal.create");
    expect(projectedTools).not.toContain("goal.bounded_work_contract.supersede");
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("[tool] status"));
  });

  it("runs declared synthetic fixtures without loading project context from the repository root", async () => {
    const repositoryRoot = resolveProjectRoot().rootPath;
    const projectStateBinding = resolveProjectStateBinding(repositoryRoot);
    const fixturePath = "packages/core/evals/fixtures/model-roster-backend-write-v2/idempotent-reservation";
    const expectedWorkspace = join(repositoryRoot, ...fixturePath.split("/"));
    const priorManagedResolutionCount = benchmarkExecutorMocks.resolveManagedInvocationToolOptions.mock.calls.length;
    const priorIdentityContextCount = benchmarkExecutorMocks.withGlobalIdentityContext.mock.calls.length;
    const priorGovernanceContextCount = benchmarkExecutorMocks.withWorkGovernanceContext.mock.calls.length;
    const priorInstructionContextCount = benchmarkExecutorMocks.resolveInstructionProfileContextCandidates.mock.calls.length;
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    const result = await executor("Inspect only the fixture.", makeBenchmarkContext({
      id: "synthetic-fixture",
      input: "Inspect only the fixture.",
      metadata: { workspaceFixture: fixturePath, benchmarkCaseId: "idempotent-reservation" },
    }));

    const authorityRoot = join(tmpdir(), "kiln-test-benchmark-authority");
    expect(benchmarkExecutorMocks.getProjectContextArtifactCache).toHaveBeenCalledWith(
      join(authorityRoot, "cache", "context-artifacts.json"),
      authorityRoot,
    );
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
        mcpServerEntryPath: undefined,
        boundedWork: expect.anything(),
      }),
    }));
    expect(result.metadata).toMatchObject({
      benchmarkWorkspaceKind: "synthetic-fixture",
      workspaceFixture: fixturePath,
      workspaceFixtureHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(benchmarkExecutorMocks.resolveManagedInvocationToolOptions).toHaveBeenCalledTimes(priorManagedResolutionCount + 1);
    expect(benchmarkExecutorMocks.resolveManagedInvocationToolOptions).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        cwd: expectedWorkspace,
        maxParallelChildren: 1,
        managedAccountComposition: expect.anything(),
      }),
    );
    expect(benchmarkExecutorMocks.createProjectBoundedWorkAuthority).toHaveBeenLastCalledWith(expectedWorkspace, {
      authorityStateRoot: authorityRoot,
      projectIdentityRoot: expectedWorkspace,
      projectStateBinding,
      formalVerificationCapability: {
        metric: "formal_verification",
        status: "unavailable",
      },
    });
    expect(benchmarkExecutorMocks.createManagedAccountRuntimeComposition).toHaveBeenCalledWith(
      expect.anything(),
      expectedWorkspace,
      {
        compositionKey: authorityRoot,
        databasePath: join(authorityRoot, "managed-account-leases.sqlite"),
      },
    );
    expect(benchmarkExecutorMocks.withGlobalIdentityContext).toHaveBeenCalledTimes(priorIdentityContextCount);
    expect(benchmarkExecutorMocks.withWorkGovernanceContext).toHaveBeenCalledTimes(priorGovernanceContextCount);
    expect(benchmarkExecutorMocks.resolveInstructionProfileContextCandidates).toHaveBeenCalledTimes(priorInstructionContextCount);
  });

  it("persists canonical adoption evidence outside the fixture and survives authority lease cleanup", async () => {
    const repositoryRoot = resolveProjectRoot().rootPath;
    const fixturePath = "packages/core/evals/fixtures/model-roster-backend-write-v2/idempotent-reservation";
    const fixture = resolveBenchmarkWorkspace(repositoryRoot, fixturePath);
    if (fixture.kind !== "synthetic-fixture") throw new Error("Expected a synthetic benchmark fixture.");
    const fixtureHashBefore = hashBenchmarkWorkspace(fixture);
    const authorityLeaseRoot = mkdtempSync(join(tmpdir(), "kiln-benchmark-authority-test-"));
    const evidenceRoot = mkdtempSync(join(tmpdir(), "kiln-benchmark-evidence-test-"));
    benchmarkExecutorMocks.createBenchmarkAuthorityWorkspaceLease.mockImplementationOnce(() => ({
      rootPath: authorityLeaseRoot,
      cleanup: vi.fn(() => rmSync(authorityLeaseRoot, { recursive: true, force: true })),
    }));
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation();
    if (!defaultRun) throw new Error("benchmark run mock was not initialized");
    const ownerSessionId = "benchmark-session";
    const operatorTurnId = canonicalTurnId(ownerSessionId, 1);
    const authority = createOperatorAdoptionDecisionAuthority({
      ownerSessionId,
      operatorTurnId,
      actorId: "benchmark",
    });
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (options: {
      readonly operatorAdoption?: { persist(event: unknown): Promise<void> };
    }) => {
      await options.operatorAdoption?.persist({
        eventId: "benchmark-adoption-event",
        kilnSessionId: ownerSessionId,
        sequence: 1,
        kind: "operator_adoption_decision",
        turnId: operatorTurnId,
        ...authority,
        turnOrdinal: 1,
        source: { actor: "runtime", surface: "runtime", component: "operator-adoption" },
        timestamp: new Date("2026-08-22T00:00:00.000Z"),
      });
      return defaultRun(options as never);
    });

    try {
      const executor = createBenchmarkSessionExecutor({
        appConfig: MOCK_APP_CONFIG,
        flags: { benchmarkEvidenceRoot: evidenceRoot },
      });
      await executor("Inspect only the fixture.", makeBenchmarkContext({
        id: "synthetic-evidence",
        input: "Inspect only the fixture.",
        metadata: { workspaceFixture: fixturePath, benchmarkCaseId: "idempotent-reservation" },
      }));

      expect(hashBenchmarkWorkspace(fixture)).toBe(fixtureHashBefore);
      expect(existsSync(authorityLeaseRoot)).toBe(false);
      const transcriptPath = join(
        evidenceRoot,
        "sessions",
        encodeURIComponent(ownerSessionId),
        "transcript.jsonl",
      );
      expect(existsSync(transcriptPath)).toBe(true);
      expect(JSON.parse(readFileSync(transcriptPath, "utf8")).kind).toBe("operator_adoption_decision");
      await expect(new TranscriptStore({ sessionsPath: join(evidenceRoot, "sessions") }).readTranscript(ownerSessionId)).resolves.toEqual([
        expect.objectContaining({ kind: "operator_adoption_decision", turnId: operatorTurnId }),
      ]);
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true });
      rmSync(authorityLeaseRoot, { recursive: true, force: true });
    }
  });

  it("runs write profiles only in a disposable strict direct-provider lease", async () => {
    const fixturePath = "packages/core/evals/fixtures/model-roster-backend-write-v2/idempotent-reservation";
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("opencode-go", "glm-5.2", "benchmark-write"),
    );
    benchmarkExecutorMocks.loadKilnConfig.mockResolvedValue({
      version: "1",
      permissions: {
        approval: "never",
        sandbox: "workspace-write",
        safeDefaults: false,
        tools: [
          { tool: "write", action: "allow" },
          { tool: "edit", action: "allow" },
          { tool: "patch", action: "allow" },
        ],
      },
    });
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
      metadata: { workspaceFixture: fixturePath, benchmarkCaseId: "idempotent-reservation" },
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
      permissionPolicy: expect.objectContaining({
        approval: "never",
        sandbox: "workspace-write",
        tools: [
          { tool: "write", action: "allow" },
          { tool: "edit", action: "allow" },
          { tool: "patch", action: "allow" },
        ],
      }),
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

  it("rejects a write profile before provider execution when configured write authority is absent", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("opencode-go", "glm-5.2", "benchmark-write"),
    );
    benchmarkExecutorMocks.loadKilnConfig.mockResolvedValue({ version: "1" });
    const priorRunCount = benchmarkExecutorMocks.runSession.mock.calls.length;
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    await expect(executor("Fix the fixture.", makeBenchmarkContext({
      id: "backend-write-without-authority",
      input: "Fix the fixture.",
      metadata: { workspaceFixture: "packages/core/evals/fixtures/model-roster-v1" },
    }, {
      id: "kiln-model-roster-backend-write",
      authorityProfile: "foundation-apply-approved-writes",
    }))).rejects.toThrow("requires admitted workspace-write");
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledTimes(priorRunCount);
  });

  it("uses private C0/T projections and never exposes formal_verify", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: { targetId: "benchmark-codex", accountOverrideIds: ["subscription-a"] },
      formalScreeningPackage: FORMAL_PACKAGE,
      formalScreeningConfig: FORMAL_CONFIG,
    });
    const executeArm = (arm: "C0" | "T") => executor(
      "Implement the private task.",
      makeBenchmarkContext({
        id: `formal-pair-1-${arm}`,
        input: "Implement the private task.",
        metadata: {
          formalScreeningArm: arm,
        },
      }, {
        id: "kiln-formal-verification-pilot",
        authorityProfile: "foundation-apply-approved-writes",
      }),
    );

    const control = await executeArm("C0");
    const treatment = await executeArm("T");

    const projections = benchmarkExecutorMocks.createSessionBuiltinToolOptions.mock.calls
      .slice(-2)
      .map(([input]) => input.toolProjection.alwaysOnTools);
    expect(projections[0]).toEqual(["read", "read_many", "grep", "glob", "tree", "stat", "write", "edit", "patch"]);
    expect(projections[1]).toEqual([...projections[0], "lemma_check"]);
    expect(projections.flat()).not.toContain("formal_verify");
    expect(control.metadata).toMatchObject({
      formalScreeningArm: "C0",
      lemmaCheckObservations: [],
      lemmaCheckPassed: false,
      hiddenOracleExhaustive: true,
    });
    expect(treatment.metadata).toMatchObject({
      formalScreeningArm: "T",
      lemmaCheckObservations: [],
      lemmaCheckPassed: false,
      formalScreeningBudget: { toolRounds: 8, maxToolCalls: 24, maxTotalTokens: 64000, wallClockMs: 600000 },
    });
    expect((benchmarkExecutorMocks.createSessionBuiltinToolOptions.mock.calls.at(-2)?.[0].additionalTools ?? [])
      .map((tool: { readonly name?: string }) => tool.name)).not.toContain("lemma_check");
    expect((benchmarkExecutorMocks.createSessionBuiltinToolOptions.mock.calls.at(-1)?.[0].additionalTools ?? [])
      .map((tool: { readonly name?: string }) => tool.name)).toContain("lemma_check");
    expect(treatment.metadata?.toolProjectionHash).toEqual(expect.any(String));
    expect(control.metadata?.toolProjectionHash).not.toBe(treatment.metadata?.toolProjectionHash);
    expect(control.metadata?.verifierHash).toBe(treatment.metadata?.verifierHash);
    expect(benchmarkExecutorMocks.createPrivateFormalScreeningWorkspaceLease).toHaveBeenCalledTimes(2);
  });

  it("requires one account and refuses formal account fallback", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: { targetId: "benchmark-codex", accountOverrideIds: ["subscription-a", "subscription-b"] },
      formalScreeningPackage: FORMAL_PACKAGE,
      formalScreeningConfig: FORMAL_CONFIG,
    });
    const priorRunCount = benchmarkExecutorMocks.runSession.mock.calls.length;

    await expect(executor("Implement the private task.", makeBenchmarkContext({
      id: "formal-pair-1-C0",
      input: "Implement the private task.",
      metadata: { formalScreeningArm: "C0" },
    }, { id: "kiln-formal-verification-pilot" }))).rejects.toThrow(/exactly one accountOverrideId/u);
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledTimes(priorRunCount);
  });

  it("invalidates a formal trial that exceeds its fixed tool budget", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation();
    if (!defaultRun) throw new Error("benchmark run mock was not initialized");
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (input) => ({
      ...await defaultRun(input),
      toolCallCount: 25,
    }));
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: { targetId: "benchmark-codex", accountOverrideIds: ["subscription-a"] },
      formalScreeningPackage: FORMAL_PACKAGE,
      formalScreeningConfig: FORMAL_CONFIG,
    });

    const result = await executor("Implement the private task.", makeBenchmarkContext({
      id: "formal-pair-1-C0",
      input: "Implement the private task.",
      metadata: { formalScreeningArm: "C0" },
    }, { id: "kiln-formal-verification-pilot" }));

    expect(result.trial).toEqual({ status: "invalid", reason: "budget" });
    expect(result.metadata?.formalScreeningBudget).toMatchObject({ maxToolCalls: 24 });
  });

  it("records the scheduled formal protocol slot when an invalid trial does not advance the generic repeat", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation();
    if (!defaultRun) throw new Error("benchmark run mock was not initialized");
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (input) => ({
      ...await defaultRun(input),
      toolCallCount: 25,
    }));
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: { targetId: "benchmark-codex", accountOverrideIds: ["subscription-a"] },
      formalScreeningPackage: FORMAL_PACKAGE,
      formalScreeningConfig: FORMAL_CONFIG,
    });

    const result = await executor("Implement the private task.", makeBenchmarkContext({
      id: "formal-pair-1-C0",
      input: "Implement the private task.",
      metadata: { formalScreeningArm: "C0" },
    }, { id: "kiln-formal-verification-pilot" }, { runIndex: 1, repeatIndex: 0 }));

    expect(result.trial).toEqual({ status: "invalid", reason: "budget" });
    expect(result.metadata).toMatchObject({ runIndex: 1, repeatIndex: 1 });
  });

  it("preserves the scheduled formal protocol slot when routing fails before dispatch", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const unavailable = new Error("sensitive account details must not escape");
    unavailable.name = "OperatorSessionExecutionRoutingError";
    benchmarkExecutorMocks.runSession.mockRejectedValueOnce(unavailable);
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: { targetId: "benchmark-codex", accountOverrideIds: ["subscription-a"] },
      formalScreeningPackage: FORMAL_PACKAGE,
      formalScreeningConfig: FORMAL_CONFIG,
    });

    const result = await executor("Implement the private task.", makeBenchmarkContext({
      id: "formal-pair-1-C0",
      input: "Implement the private task.",
      metadata: { formalScreeningArm: "C0" },
    }, { id: "kiln-formal-verification-pilot" }, { runIndex: 1, repeatIndex: 0 }));

    expect(result.trial).toEqual({ status: "invalid", reason: "account-route-unavailable" });
    expect(result.metadata).toMatchObject({ runIndex: 1, repeatIndex: 1 });
    expect(JSON.stringify(result)).not.toContain("sensitive account details");
  });

  it("invalidates a formal trial without complete route identity binding", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation();
    if (!defaultRun) throw new Error("benchmark run mock was not initialized");
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (input) => ({
      ...await defaultRun(input),
      executionBindings: [],
    }));
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: { targetId: "benchmark-codex", accountOverrideIds: ["subscription-a"] },
      formalScreeningPackage: FORMAL_PACKAGE,
      formalScreeningConfig: FORMAL_CONFIG,
    });

    const result = await executor("Implement the private task.", makeBenchmarkContext({
      id: "formal-pair-1-C0",
      input: "Implement the private task.",
      metadata: { formalScreeningArm: "C0" },
    }, { id: "kiln-formal-verification-pilot" }));

    expect(result.trial).toEqual({ status: "invalid", reason: "execution-identity-mismatch" });
  });

  it("records only a well-formed final-digest lemma observation", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation();
    if (!defaultRun) throw new Error("benchmark run mock was not initialized");
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (input) => ({
      ...await defaultRun(input),
      transcript: [{
        seq: 1,
        ts: "2026-08-20T00:00:00.000Z",
        event: {
          type: "tool_result",
          toolName: "lemma_check",
          toolCallId: "lemma-1",
          toolCallScopeId: "scope-1",
          output: JSON.stringify({
            kind: "pipeline_passed",
            status: "passed",
            stage: "complete",
            versions: {
              lemmaScript: { expected: "0.6.0", observed: "0.6.0" },
              dafny: { expected: "4.11.0", observed: "4.11.0" },
            },
            digests: {
              source: FORMAL_SOURCE_AFTER,
              generated: "sha256:" + "e".repeat(64),
              lemmaScriptExecutable: "sha256:" + "f".repeat(64),
              dafnyExecutable: "sha256:" + "1".repeat(64),
              dependencyBinding: "sha256:" + "2".repeat(64),
            },
            processes: [],
            policyEligible: true,
            diagnosticCodes: [],
            verification: { correctnessChecks: { total: 1, passed: 1, failed: 0, inconclusive: 0 } },
            semanticEquivalence: "unresolved",
            benchmarkReady: false,
          }),
        },
      }],
    }));
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: { targetId: "benchmark-codex", accountOverrideIds: ["subscription-a"] },
      formalScreeningPackage: FORMAL_PACKAGE,
      formalScreeningConfig: FORMAL_CONFIG,
    });

    const result = await executor("Implement the private task.", makeBenchmarkContext({
      id: "formal-pair-1-T",
      input: "Implement the private task.",
      metadata: { formalScreeningArm: "T" },
    }, { id: "kiln-formal-verification-pilot" }));

    expect(result.metadata?.lemmaCheckPassed).toBe(true);
    expect(result.metadata?.treatmentToolchainHash).toBe("sha256:" + "2".repeat(64));
    expect(result.metadata?.lemmaCheckObservations).toEqual([
      expect.objectContaining({
        kind: "pipeline_passed",
        digests: expect.objectContaining({ source: FORMAL_SOURCE_AFTER }),
      }),
    ]);
    expect(JSON.stringify(result.metadata)).not.toContain("private/formal");
    expect(JSON.stringify(result.metadata)).not.toContain("test(\"one\"");
  });

  it("rejects write profiles without a configured direct execution target before execution", async () => {
    const priorRunCount = benchmarkExecutorMocks.runSession.mock.calls.length;
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue({});
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    await expect(executor("Fix the fixture.", makeBenchmarkContext({
      id: "backend-write-native",
      input: "Fix the fixture.",
      metadata: { workspaceFixture: "packages/core/evals/fixtures/model-roster-v1" },
    }, {
      id: "kiln-model-roster-backend-write",
      authorityProfile: "foundation-apply-approved-writes",
    }))).rejects.toThrow("require a configured direct execution target");
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledTimes(priorRunCount);
  });

  it("resolves a supported deliberation level and records exact route evidence", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    benchmarkExecutorMocks.discoverGuiDirectProviderModelDiscovery.mockResolvedValue({
      "codex-oauth": {
        models: ["benchmark-model"],
        modelCapabilities: {
          "benchmark-model": {
            deliberation: {
              provider: "codex-oauth",
              model: "benchmark-model",
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
      },
    });
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        targetId: "benchmark-codex",
        accountOverrideIds: ["subscription-a"],
        benchmarkPairIds: ["deliberation-level"],
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
    expect(benchmarkExecutorMocks.createCanonicalRunSessionDispatcher).toHaveBeenCalledWith(expect.objectContaining({
      routeId: "benchmark-codex",
      accountOverrideId: "subscription-a",
    }));
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledWith(expect.objectContaining({
      routeCandidates: [{
        routeId: "benchmark-codex",
        provider: "codex-oauth",
        model: "benchmark-model",
        deliberationResolution: expectedResolution,
      }],
      sessionConfig: expect.objectContaining({ deliberationResolution: expectedResolution }),
    }));
  });

  it("assigns paired items to the same account, ignores run order, and rotates later repetitions", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        targetId: "benchmark-codex",
        accountOverrideIds: ["subscription-a", "subscription-b", "subscription-c"],
        benchmarkPairIds: ["pair-a", "pair-b"],
      },
    });
    const executePair = (itemId: string, pairId: string, runIndex: number, repeatIndex: number) => executor(
      "Return exactly one sentence.",
      makeBenchmarkContext({
        id: itemId,
        input: "Return exactly one sentence.",
        metadata: { pairId },
      }, {}, { runIndex, repeatIndex }),
    );

    await executePair("pair-a-control", "pair-a", 0, 0);
    await executePair("pair-a-treatment", "pair-a", 1, 0);
    await executePair("pair-b-control", "pair-b", 2, 0);
    await executePair("pair-a-control-retry", "pair-a", 3, 0);
    await executePair("pair-a-control-repeat", "pair-a", 4, 1);

    const assignedAccounts = benchmarkExecutorMocks.createCanonicalRunSessionDispatcher.mock.calls
      .slice(-5)
      .map(([input]) => input.accountOverrideId);
    expect(assignedAccounts).toEqual([
      "subscription-a",
      "subscription-a",
      "subscription-b",
      "subscription-a",
      "subscription-b",
    ]);
  });

  it("retains an account fallback as an invalid trial and records scheduled and observed identity", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const unavailable = new Error("first account unavailable");
    unavailable.name = "OperatorSessionExecutionRoutingError";
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation();
    if (!defaultRun) throw new Error("benchmark run mock was not initialized");
    benchmarkExecutorMocks.createCanonicalRunSessionDispatcher
      .mockImplementationOnce(() => ({ dispatch: vi.fn().mockRejectedValue(unavailable), close: vi.fn() }))
      .mockImplementationOnce(() => ({
        dispatch: async (payload: object) => ({
          ...await defaultRun(payload),
          executionBindings: [{
            status: "bound",
            routeId: "benchmark-codex",
            accountId: "subscription-b",
            credentialId: "credential-b",
            credentialRevision: "revision-b",
          }],
        }),
        close: vi.fn(),
      }));
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        targetId: "benchmark-codex",
        accountOverrideIds: ["subscription-a", "subscription-b"],
        benchmarkPairIds: ["pair-a"],
      },
    });

    const result = await executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "pair-a-control",
      input: "Return exactly one sentence.",
      metadata: { pairId: "pair-a" },
    }));

    const attemptedAccounts = benchmarkExecutorMocks.createCanonicalRunSessionDispatcher.mock.calls
      .slice(-2)
      .map(([input]) => input.accountOverrideId);
    expect(attemptedAccounts).toEqual(["subscription-a", "subscription-b"]);
    expect(result.trial).toEqual({ status: "invalid", reason: "account-fallback" });
    expect(result.metadata).toMatchObject({
      scheduledAccountId: "subscription-a",
      expectedAccountId: "subscription-a",
      accountFallbackCount: 1,
      accountId: "subscription-b",
      expectedRouteId: "benchmark-codex",
      routeId: "benchmark-codex",
    });
  });

  it("records benchmark indices and configured and observed route identity", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation();
    if (!defaultRun) throw new Error("benchmark run mock was not initialized");
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (options: object) => ({
      ...await defaultRun(options),
      executionBindings: [{
        status: "bound",
        routeId: "stale-route",
        accountId: "stale-account",
        credentialId: "credential-stale",
        credentialRevision: "revision-stale",
      }, {
        status: "bound",
        routeId: "benchmark-codex",
        accountId: "subscription-c",
        credentialId: "credential-c",
        credentialRevision: "revision-c",
      }],
    }));
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        targetId: "benchmark-codex",
        accountOverrideIds: ["subscription-a", "subscription-b", "subscription-c"],
        benchmarkPairIds: ["pair-a"],
      },
    });

    const result = await executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "pair-a-control",
      input: "Return exactly one sentence.",
      metadata: { pairId: "pair-a" },
    }, {}, { runIndex: 17, repeatIndex: 2 }));

    expect(result.trial).toEqual({ status: "valid" });
    expect(result.metadata).toMatchObject({
      runIndex: 17,
      repeatIndex: 2,
      expectedRouteId: "benchmark-codex",
      routeId: "benchmark-codex",
      expectedAccountId: "subscription-c",
      scheduledAccountId: "subscription-c",
      accountId: "subscription-c",
      expectedProviderId: "codex-oauth",
      expectedModelId: "benchmark-model",
      providerId: "codex",
      modelId: "benchmark-model",
    });
  });

  it("invalidates a bound execution whose route or scheduled account differs", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "benchmark-model", "benchmark-codex"),
    );
    const defaultRun = benchmarkExecutorMocks.runSession.getMockImplementation();
    if (!defaultRun) throw new Error("benchmark run mock was not initialized");
    benchmarkExecutorMocks.runSession.mockImplementationOnce(async (options: object) => ({
      ...await defaultRun(options),
      executionBindings: [{
        status: "bound",
        routeId: "unexpected-route",
        accountId: "unexpected-account",
        credentialId: "credential-unexpected",
        credentialRevision: "revision-unexpected",
      }],
    }));
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        targetId: "benchmark-codex",
        accountOverrideIds: ["subscription-a"],
        benchmarkPairIds: ["pair-a"],
      },
    });

    const result = await executor("Return exactly one sentence.", makeBenchmarkContext({
      id: "pair-a-control",
      input: "Return exactly one sentence.",
      metadata: { pairId: "pair-a" },
    }, {}, { runIndex: 3, repeatIndex: 1 }));

    expect(result.trial).toEqual({ status: "invalid", reason: "execution-identity-mismatch" });
    expect(result.metadata).toMatchObject({
      runIndex: 3,
      repeatIndex: 1,
      expectedRouteId: "benchmark-codex",
      routeId: "unexpected-route",
      expectedAccountId: "subscription-a",
      scheduledAccountId: "subscription-a",
      accountId: "unexpected-account",
    });
  });

  it("resolves Claude deliberation from the executable-bound catalog", async () => {
    benchmarkExecutorMocks.isDirectApiProvider.mockReturnValue(true);
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("anthropic", "claude-sonnet-5", "benchmark-anthropic"),
    );
    benchmarkExecutorMocks.discoverGuiDirectProviderModelDiscovery.mockResolvedValue({
      anthropic: {
        models: ["claude-sonnet-5"],
        modelCapabilities: {
          "claude-sonnet-5": {
            deliberation: {
              provider: "anthropic",
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
      },
    });
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        targetId: "benchmark-anthropic",
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
        provider: "anthropic",
        model: "claude-sonnet-5",
        deliberationResolution: expect.objectContaining({ selectedLevel: "low" }),
      })],
    }));
  });

  it("fails closed when a requested deliberation level lacks capability evidence", async () => {
    const priorRunCount = benchmarkExecutorMocks.runSession.mock.calls.length;
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("codex-oauth", "unknown-model", "benchmark-unknown"),
    );
    const executor = createBenchmarkSessionExecutor({
      appConfig: MOCK_APP_CONFIG,
      flags: {
        targetId: "benchmark-unknown",
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
        executionBindings: [],
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
    expect(result.trial).toEqual({ status: "valid" });
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
        executionBindings: [],
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
    expect(result.trial).toEqual({ status: "invalid", reason: "route-unavailable" });
    expect(result.metadata).toMatchObject({
      sessionSucceeded: false,
      policyViolations: ["Provider failed"],
      routeFailures: ["codex: Provider failed"],
    });
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("records canonical account-capacity denial as an invalid infrastructure trial", async () => {
    const error = new Error("sensitive account details must not escape");
    error.name = "OperatorSessionExecutionRoutingError";
    benchmarkExecutorMocks.readGlobalConfig.mockReturnValue(
      makeOperatorSurfaceGlobalConfig("opencode-go", "glm-5.2", "benchmark-write"),
    );
    benchmarkExecutorMocks.runSession.mockRejectedValueOnce(error);
    const executor = createBenchmarkSessionExecutor({ appConfig: MOCK_APP_CONFIG });

    const result = await executor("Fix the fixture.", makeBenchmarkContext({
      id: "backend-account-unavailable",
      input: "Fix the fixture.",
      metadata: {
        workspaceFixture: "packages/core/evals/fixtures/model-roster-backend-write-v2/idempotent-reservation",
        benchmarkCaseId: "idempotent-reservation",
      },
    }, {
      id: "kiln-model-roster-backend-write",
      authorityProfile: "foundation-apply-approved-writes",
    }));

    expect(result.trial).toEqual({ status: "invalid", reason: "account-route-unavailable" });
    expect(result.metadata?.diagnostics).toEqual([
      "Canonical execution account route was unavailable before provider dispatch.",
    ]);
    expect(JSON.stringify(result)).not.toContain("sensitive account details");
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
        executionBindings: [],
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

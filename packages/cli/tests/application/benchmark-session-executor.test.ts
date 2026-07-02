import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBenchmarkSessionExecutor } from "../../src/application/benchmark-session-executor.js";
import { createManagedDirectProviderAdapterFactory } from "../../src/config/managed-agent-direct-adapters.js";

const benchmarkExecutorMocks = vi.hoisted(() => ({
  cleanupWorktree: vi.fn(),
  closeMemoryRepository: vi.fn(),
  createDefaultRegistry: vi.fn(),
  createSessionBuiltinToolOptions: vi.fn(),
  discoverManagedAgentProviderModels: vi.fn(),
  getProjectContextArtifactCache: vi.fn(),
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
  runCleanup: vi.fn(),
  runSession: vi.fn(),
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
  getProjectContextArtifactCache: benchmarkExecutorMocks.getProjectContextArtifactCache,
  ProviderModelRouteHealthStore: class ProviderModelRouteHealthStore {
    recordOutcome = benchmarkExecutorMocks.recordRouteHealth;
  },
  withManagedAgentInvocationResourceProvider: vi.fn((options) => options),
  withManagedInvocationService: vi.fn((options) => options),
}));

vi.mock("../../src/config/operator-identity-context.js", () => ({
  withGlobalIdentityContext: vi.fn((config) => config),
}));

vi.mock("../../src/application/work-governance-context.js", () => ({
  withWorkGovernanceContext: vi.fn((config) => config),
}));

vi.mock("../../src/application/agent-skill-context.js", () => ({
  withContextCandidates: vi.fn((config) => config),
}));

vi.mock("../../src/application/instruction-profile-context.js", () => ({
  resolveInstructionProfileContextCandidates: vi.fn(() => []),
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
  isDirectApiProvider: vi.fn(() => false),
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

function makeBenchmarkContext(item: { readonly id: string; readonly input: string }) {
  return {
    profile: {
      id: "kiln-tool-agent",
      version: "1",
      displayName: "Kiln Tool Agent",
      surface: "tool-calling",
      purpose: "Tool calling.",
      authorityProfile: "foundation-readonly-plan",
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
    benchmarkExecutorMocks.runCleanup.mockResolvedValue(undefined);
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
    });
    expect(benchmarkExecutorMocks.runSession).toHaveBeenCalledWith(expect.objectContaining({
      output: expect.objectContaining({ mode: "answer" }),
      sessionConfig: expect.objectContaining({
        executionEnvelope: { toolRounds: { max: 32 } },
      }),
    }));
    expect(createManagedDirectProviderAdapterFactory).toHaveBeenCalledWith(expect.objectContaining({
      executionEnvelope: { toolRounds: { max: 32 } },
    }));
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("[tool] status"));
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

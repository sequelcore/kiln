import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ManagedAgentFanOutLifecycleInput } from "@kilnai/runtime";
import type { KilnAppConfig } from "../../src/config.js";
import { buildRunSessionRequirements, resolveRunProviderModelAdmission, runCommand } from "../../src/commands/run.js";
import { readGlobalConfig } from "../../src/config/global-config.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const runWiringMocks = vi.hoisted(() => {
  const builtinToolSurfaceOptions = { id: "surface-options" };
  const builtinToolOptions = { id: "session-builtin-tool-options" };
  return {
    loadConfiguredWebToolSurfaceOptions: vi.fn().mockResolvedValue(builtinToolSurfaceOptions),
    createSessionBuiltinToolOptions: vi.fn(() => builtinToolOptions),
    runSession: vi.fn().mockResolvedValue({
      finalCostUsd: 0,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "",
      toolCallCount: 0,
      turnDepth: 0,
      successfulProviderId: "openai",
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    }),
    summarizeContextGovernance: vi.fn(() => ({ preview: true })),
    printContextGovernancePreview: vi.fn(),
    printReport: vi.fn(),
    computeEvalScore: vi.fn(() => undefined),
    cleanupWorktree: vi.fn().mockResolvedValue(undefined),
    cleanupRegistryRunAll: vi.fn().mockResolvedValue(undefined),
    createManagedAgentInvocationResourceProvider: vi.fn(() => ({ id: "managed-agent-resource-provider" })),
    runManagedAgentFanOutLifecycle: vi.fn(),
    runVerification: vi.fn().mockResolvedValue({ passed: true, checks: [] }),
    transcriptInit: vi.fn().mockResolvedValue(undefined),
    transcriptFinalize: vi.fn().mockResolvedValue(undefined),
    preparedWorkingDirectory: undefined as string | undefined,
    capturedSessionConfigs: [] as unknown[],
    capturedRunSessionInputs: [] as unknown[],
    evaluateRouteHealth: vi.fn().mockResolvedValue({ healthy: true }),
    recordRouteOutcome: vi.fn().mockResolvedValue(undefined),
    discoverGuiCliOperatorModels: vi.fn().mockResolvedValue({
      codexModels: ["gpt-5.3-codex-spark", "gpt-5.4-mini"],
      codexDiscovery: {
        models: ["gpt-5.3-codex-spark", "gpt-5.4-mini"],
        status: "available",
        reason: "Codex models discovered.",
        authState: "authenticated",
      },
      opencodeModels: ["opencode/minimax-m2.5-free"],
      opencodeDiscovery: {
        models: ["opencode/minimax-m2.5-free"],
        status: "available",
        reason: "OpenCode models discovered.",
        authState: "authenticated",
      },
    }),
    probeCodexCliModelReadiness: vi.fn().mockResolvedValue({
      provider: "codex",
      model: "gpt-5.5",
      runnable: true,
      status: "available",
      reason: "Codex CLI model 'gpt-5.5' passed live readiness probe.",
      authState: "authenticated",
    }),
  };
});

vi.mock("@kilnai/runtime", () => ({
  attachManagedInvocationSessionEventSink: vi.fn((attachment: Record<string, unknown> | undefined, sessionEventSink: unknown) => {
    if (!attachment) {
      return undefined;
    }
    return {
      ...attachment,
      sessionEventSink,
    };
  }),
  getProjectContextArtifactCache: vi.fn().mockResolvedValue({
    set: vi.fn(),
  }),
  createAttachedRuntimeBuiltinToolSurface: vi.fn(() => ({
    toolDefinitions: [],
    callBuiltinTools: new Map(),
    capabilities: new Map(),
    toolAuthority: new Map(),
  })),
  RuntimeBudgetAdmissionService: class MockRuntimeBudgetAdmissionService {
    constructor(private readonly options: {
      readonly policy: { readonly enabled: boolean };
      readonly usageReader?: (input: {
        readonly providerId: string;
        readonly subject: "runtime-session-turn" | "managed-orchestration";
        readonly sessionId: string;
      }) => Promise<unknown>;
    }) {}

    async admit(request: {
      readonly subject: "runtime-session-turn" | "managed-orchestration";
      readonly sessionId: string;
      readonly routeCandidates: readonly { readonly providerId: string }[];
    }) {
      return {
        status: this.options.policy.enabled ? "admitted" : "admitted",
        reason: this.options.policy.enabled ? "route-within-budget" : "budget-disabled",
        admittedRoutes: request.routeCandidates,
        usageSnapshots: this.options.usageReader
          ? [await this.options.usageReader({
              providerId: request.routeCandidates[0]?.providerId ?? "unknown",
              subject: request.subject,
              sessionId: request.sessionId,
            })]
          : [],
      };
    }
  },
  discoverGuiDirectProviderModelDiscovery: vi.fn().mockResolvedValue({
    openai: {
      models: ["gpt-4o"],
      status: "available",
      reason: "OpenAI models discovered.",
      authState: "authenticated",
    },
    openrouter: {
      models: ["openrouter/free", "qwen/qwen3-coder:free"],
      status: "available",
      reason: "OpenRouter models discovered.",
      authState: "authenticated",
    },
  }),
  discoverGuiCliOperatorModels: runWiringMocks.discoverGuiCliOperatorModels,
  probeCodexCliModelReadiness: runWiringMocks.probeCodexCliModelReadiness,
  discoverCodexCliModelDiscovery: vi.fn().mockResolvedValue({
    models: ["gpt-5.3-codex-spark", "gpt-5.4-mini"],
    status: "available",
    reason: "Codex models discovered.",
    authState: "authenticated",
  }),
  discoverOpencodeCliModelDiscovery: vi.fn().mockResolvedValue({
    models: ["opencode/minimax-m2.5-free"],
    status: "available",
    reason: "OpenCode models discovered.",
    authState: "authenticated",
  }),
  ManagedRuntimeCredentialRouteLeaseManager: class MockManagedRuntimeCredentialRouteLeaseManager {},
  ManagedGitWorktreeLeaseManager: class MockManagedGitWorktreeLeaseManager {},
  RuntimeManagedAgentInvocationService: class MockRuntimeManagedAgentInvocationService {},
  createManagedAgentInvocationResourceProvider: runWiringMocks.createManagedAgentInvocationResourceProvider,
  withManagedAgentInvocationResourceProvider: (options: Record<string, unknown> | undefined, input: Record<string, unknown> | undefined) => {
    if (!input) {
      return options;
    }
    const provider = runWiringMocks.createManagedAgentInvocationResourceProvider({
      ...input,
      artifactStore: (options?.artifactResources as { store?: unknown } | undefined)?.store,
    });
    return runWiringMocks.createSessionBuiltinToolOptions({
      ...options,
      resourceProviders: [
        ...((options?.resourceProviders as readonly unknown[] | undefined) ?? []),
        provider,
      ],
    });
  },
  withManagedInvocationService: (options: Record<string, unknown>) => ({
    ...options,
    invocationService: options.invocationService ?? {},
  }),
  runManagedAgentFanOutLifecycle: runWiringMocks.runManagedAgentFanOutLifecycle,
  ProviderModelRouteHealthStore: class {
    evaluateRouteHealth(providerId: string, modelId: string) {
      return runWiringMocks.evaluateRouteHealth(providerId, modelId);
    }

    recordOutcome(input: unknown) {
      return runWiringMocks.recordRouteOutcome(input);
    }
  },
  ManagedCliHarnessAdapter: class MockManagedCliHarnessAdapter {
    readonly descriptor = {
      adapterKind: "harness",
      supportedExecutionModes: ["cli-harness"],
    };
  },
  ManagedDirectProviderRuntimeAdapter: class MockManagedDirectProviderRuntimeAdapter {},
  PlaywrightBrowserCaptureRecorder: class MockPlaywrightBrowserCaptureRecorder {
    constructor(readonly options: unknown) {}
  },
  PlaywrightBrowserUseProvider: class MockPlaywrightBrowserUseProvider {
    constructor(readonly options: unknown) {}
  },
  WindowsComputerUseProvider: class MockWindowsComputerUseProvider {
    constructor(readonly options: unknown) {}
  },
  WindowsUiaComputerUseProvider: class MockWindowsUiaComputerUseProvider {
    constructor(readonly options: unknown) {}
  },
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    createSessionBuiltinToolOptions: runWiringMocks.createSessionBuiltinToolOptions,
    formatProviderModelRouteCooldown: (decision: { reason?: string }) => decision.reason ?? "cooling down",
    mapProviderModelRouteErrorToOutcome: (message: string) => {
      if (message.includes("rate-limited") || message.includes("429")) {
        return { type: "rate-limited" };
      }
      return { type: "unknown-error", message };
    },
  };
});

vi.mock("../../src/config/web-tools-config.js", () => ({
  loadConfiguredWebToolSurfaceOptions: runWiringMocks.loadConfiguredWebToolSurfaceOptions,
}));

vi.mock("../../src/application/run-session.js", () => ({
  runSession: vi.fn(async (input: {
    sessionConfig: unknown;
    routeCandidates?: readonly { provider: string; model?: string }[];
  }) => {
    runWiringMocks.capturedSessionConfigs.push(input.sessionConfig);
    runWiringMocks.capturedRunSessionInputs.push(input);
    const result = await runWiringMocks.runSession();
    if (result.attempts) {
      return result;
    }
    const firstCandidate = input.routeCandidates?.[0];
    return {
      ...result,
      successfulProviderId: result.successfulProviderId ?? firstCandidate?.provider,
      successfulModelId: result.successfulModelId ?? firstCandidate?.model,
      attempts: firstCandidate
        ? [{
            providerId: firstCandidate.provider,
            ...(firstCandidate.model ? { model: firstCandidate.model } : {}),
            succeeded: result.sessionSucceeded,
            error: result.lastError,
          }]
        : [],
    };
  }),
}));

vi.mock("../../src/application/session-report.js", () => ({
  summarizeContextGovernance: runWiringMocks.summarizeContextGovernance,
  printContextGovernancePreview: runWiringMocks.printContextGovernancePreview,
  printReport: runWiringMocks.printReport,
  computeEvalScore: runWiringMocks.computeEvalScore,
}));

vi.mock("../../src/application/session-resume.js", () => ({
  resolveResumeSessionId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/application/resume-strategy-feedback.js", () => ({
  inferResumeStrategyFeedback: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/application/session-metadata.js", () => ({
  deriveSessionMetadata: vi.fn(() => ({
    title: "title",
    summary: "summary",
    tags: ["tag"],
  })),
}));

vi.mock("../../src/application/repo-summary-cache.js", () => ({
  buildModuleSummaryArtifact: vi.fn().mockResolvedValue(undefined),
  extractTouchedFilePaths: vi.fn(() => []),
}));

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: vi.fn(() => undefined),
  resolveGlobalDefaultModel: vi.fn(() => undefined),
  resolveGlobalDefaultProvider: vi.fn(() => undefined),
}));

vi.mock("../../src/config/env-config.js", () => ({
  resolveEffectiveModel: vi.fn((model: string | undefined) => model),
  resolveEnvModel: vi.fn(() => undefined),
  resolveEnvProvider: vi.fn(() => undefined),
}));

vi.mock("../../src/wrapper/session-store.js", () => ({
  TranscriptStore: class {
    async init(...args: unknown[]) {
      await runWiringMocks.transcriptInit(...args);
    }
    async append() {}
    async finalize(...args: unknown[]) {
      await runWiringMocks.transcriptFinalize(...args);
    }
    async readMeta() {
      return null;
    }
    async readTranscript() {
      return [];
    }
    async listSessions() {
      return [];
    }
  },
}));

vi.mock("../../src/wrapper/session-manager.js", () => ({
  SessionManager: class {
    readonly sessionStartTimeMs = Date.now();

    async prepare(task: string, cwd: string) {
      const workingDirectory = runWiringMocks.preparedWorkingDirectory ?? cwd;
      return {
        domain: { displayName: "Kiln" },
        projectedContext: { blocks: [], estimatedTokens: 0 },
        systemPrompt: "System prompt",
        mcpServerEntryPath: "/tmp/mcp-entry.js",
        workingDirectory,
        worktreePath: workingDirectory,
        task,
        resumeStrategy: "none",
      };
    }

    cleanup() {
      return { task: "test", domain: "Kiln", phaseReached: "implement", cost: { total: 0, byRoleModel: {} }, duration: 1 };
    }

    async cleanupWorktree(context: unknown) {
      await runWiringMocks.cleanupWorktree(context);
    }

    async runVerification(gates: unknown, cwd: string) {
      return runWiringMocks.runVerification(gates, cwd);
    }
  },
}));

vi.mock("../../src/wrapper/session-registry.js", () => ({
  createDefaultRegistry: vi.fn(() => ({
    registry: {
      list: () => [
        {
          id: "openrouter",
          isAvailable: () => true,
        },
        {
          id: "codex",
          isAvailable: () => true,
        },
      ],
    },
    worktreeManager: {},
  })),
  getRuntimeProviderAvailability: vi.fn(() => ({
    openai: true,
    openrouter: true,
  })),
  isDirectApiProvider: vi.fn((provider?: string) =>
    provider === "anthropic"
    || provider === "openai"
    || provider === "deepseek"
    || provider === "openrouter"
    || provider === "ollama"
    || provider === "lmstudio"
    || provider === "codex-oauth"
    || provider === "opencode-go"
    || provider === "opencode-zen"
  ),
}));

vi.mock("../../src/wrapper/cleanup-registry.js", () => ({
  cleanupRegistry: { runAll: runWiringMocks.cleanupRegistryRunAll },
}));

vi.mock("../../src/wrapper/index.js", () => ({
  ApprovalMemoryStore: class {
    constructor(_cwd: string) {}
  },
}));

vi.mock("../../src/application/session-hooks.js", () => ({
  SessionHooks: class {
    sessionStart() {}
    sessionEnd() {}
  },
}));

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be called in run builtin tool tests");
  },
  kilnYaml: {
    version: "1",
    skillGeneration: {
      enabled: false,
    },
  },
};

const readGlobalConfigMock = readGlobalConfig as unknown as ReturnType<typeof vi.fn>;

describe("run command builtin tool wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runWiringMocks.capturedSessionConfigs.length = 0;
    runWiringMocks.capturedRunSessionInputs.length = 0;
    runWiringMocks.evaluateRouteHealth.mockResolvedValue({ healthy: true });
    runWiringMocks.recordRouteOutcome.mockResolvedValue(undefined);
    runWiringMocks.discoverGuiCliOperatorModels.mockResolvedValue({
      codexModels: ["gpt-5.3-codex-spark", "gpt-5.4-mini"],
      codexDiscovery: {
        models: ["gpt-5.3-codex-spark", "gpt-5.4-mini"],
        status: "available",
        reason: "Codex models discovered.",
        authState: "authenticated",
      },
      opencodeModels: ["opencode/minimax-m2.5-free"],
      opencodeDiscovery: {
        models: ["opencode/minimax-m2.5-free"],
        status: "available",
        reason: "OpenCode models discovered.",
        authState: "authenticated",
      },
    });
    runWiringMocks.probeCodexCliModelReadiness.mockResolvedValue({
      provider: "codex",
      model: "gpt-5.5",
      runnable: true,
      status: "available",
      reason: "Codex CLI model 'gpt-5.5' passed live readiness probe.",
      authState: "authenticated",
    });
    runWiringMocks.cleanupWorktree.mockResolvedValue(undefined);
    runWiringMocks.cleanupRegistryRunAll.mockResolvedValue(undefined);
    runWiringMocks.createManagedAgentInvocationResourceProvider.mockReturnValue({ id: "managed-agent-resource-provider" });
    runWiringMocks.runManagedAgentFanOutLifecycle.mockImplementation(
      async (input: ManagedAgentFanOutLifecycleInput) => {
        const orchestrationId = input.orchestrationRequest.orchestrationId;
        return {
          orchestrationResult: {
            orchestrationId,
            mode: "fan-out",
            status: "completed",
            childResults: [{
              childId: `${orchestrationId}:child:1`,
              ordinal: 1,
              lifecycleState: "completed",
              success: true,
              resourceUris: [],
              diagnosticUris: [],
            }, {
              childId: `${orchestrationId}:child:2`,
              ordinal: 2,
              lifecycleState: "completed",
              success: true,
              resourceUris: [],
              diagnosticUris: [],
            }],
            completedAt: "2026-05-22T00:00:00.000Z",
          },
          childRecords: [{
            childId: `${orchestrationId}:child:1`,
            ordinal: 1,
            invocationId: `${orchestrationId}:child:1`,
            record: { lifecycleState: "completed" },
          }, {
            childId: `${orchestrationId}:child:2`,
            ordinal: 2,
            invocationId: `${orchestrationId}:child:2`,
            record: { lifecycleState: "completed" },
          }],
        };
      },
    );
    runWiringMocks.runVerification.mockResolvedValue({ passed: true, checks: [] });
    runWiringMocks.transcriptInit.mockResolvedValue(undefined);
    runWiringMocks.transcriptFinalize.mockResolvedValue(undefined);
    runWiringMocks.preparedWorkingDirectory = undefined;
    readGlobalConfigMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds model-facing governed builtin tool options and passes them into sessionConfig", async () => {
    await runCommand(APP_CONFIG, "ship it", { provider: "openai", model: "gpt-4o", apiKey: "sk-test" });

    expect(runWiringMocks.loadConfiguredWebToolSurfaceOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        createRegistry: APP_CONFIG.createRegistry,
        kilnYaml: expect.objectContaining({ version: "1" }),
      }),
      REPO_ROOT,
      {
        memoryAuthority: {
          modelFacingSession: true,
          permissionPolicy: { approval: "never", sandbox: "workspace-write" },
          permissionAgent: undefined,
          caller: { kind: "operator_surface", id: "run" },
        },
      },
    );
    expect(runWiringMocks.createSessionBuiltinToolOptions).toHaveBeenCalledWith(expect.objectContaining({
      id: "surface-options",
      workItemStore: expect.any(Object),
      additionalTools: expect.arrayContaining([
        expect.objectContaining({ name: "kiln_config.read" }),
        expect.objectContaining({ name: "kiln_config.propose_change" }),
        expect.objectContaining({ name: "kiln_config.apply_change" }),
      ]),
    }));
    expect(runWiringMocks.capturedSessionConfigs).toHaveLength(1);
    expect(runWiringMocks.capturedSessionConfigs[0]).toMatchObject({
      builtinToolOptions: { id: "session-builtin-tool-options" },
    });
  });

  it("wires managed invocation resources into model-facing builtin tool options", async () => {
    const managedInvocation = parallelManagedInvocation();

    await runCommand({
      ...APP_CONFIG,
      managedInvocation,
    }, "ship it", { provider: "codex" });

    expect(runWiringMocks.createManagedAgentInvocationResourceProvider).toHaveBeenCalledWith(expect.objectContaining({
      service: managedInvocation.invocationService,
    }));
    expect(runWiringMocks.createManagedAgentInvocationResourceProvider.mock.calls[0]?.[0]).toHaveProperty("artifactStore");
    expect(runWiringMocks.createSessionBuiltinToolOptions).toHaveBeenCalledWith(expect.objectContaining({
      resourceProviders: expect.arrayContaining([{ id: "managed-agent-resource-provider" }]),
    }));
    expect(runWiringMocks.capturedSessionConfigs[0]).toMatchObject({
      builtinToolOptions: { id: "session-builtin-tool-options" },
      managedInvocation: {
        options: managedInvocation,
        callerIdentity: {
          kind: "kiln-runtime",
          surface: "run",
          attachmentId: "kiln-runtime:run",
        },
        sessionEventSink: {
          publish: expect.any(Function),
        },
      },
    });
  });

  it("projects runtime-owned budget admission and session lineage into parallel fan-out", async () => {
    readGlobalConfigMock.mockReturnValue({
      version: "1",
      routing: {
        budgetAware: true,
        budget: {
          codex: {
            dailyTokenCeiling: 100,
            onCeiling: "stop",
          },
        },
      },
    });

    await runCommand({
      ...APP_CONFIG,
      managedInvocation: parallelManagedInvocation(),
    }, "parallel budget", { provider: "codex", workers: 2 });

    const input = runWiringMocks.runManagedAgentFanOutLifecycle.mock.calls[0]?.[0] as
      | ManagedAgentFanOutLifecycleInput
      | undefined;
    if (!input) {
      throw new Error("Expected parallel fan-out lifecycle input.");
    }

    expect(input.budgetAdmission?.policy).toMatchObject({
      enabled: true,
      routeBudgets: [{
        providerId: "codex",
        dailyTokenCeiling: 100,
        onCeiling: "stop",
      }],
    });
    expect(input.budgetAdmission?.usageReader).toEqual(expect.any(Function));
    expect(input.orchestrationRequest.parentSessionId).not.toBe("cli-run");
    expect(input.orchestrationRequest.orchestrationId).toContain(input.orchestrationRequest.parentSessionId);

    const usage = await input.budgetAdmission?.usageReader?.({
      providerId: "codex",
      subject: "managed-orchestration",
      sessionId: input.orchestrationRequest.parentSessionId,
    });
    expect(usage).toMatchObject({
      providerId: "codex",
      tokensUsed: 0,
      source: "cli-transcript-session-usage",
    });
  });

  it("projects runtime-owned budget admission into normal run sessions", async () => {
    readGlobalConfigMock.mockReturnValue({
      version: "1",
      routing: {
        budgetAware: true,
        budget: {
          codex: {
            dailyTokenCeiling: 100,
            onCeiling: "stop",
          },
        },
      },
    });

    await runCommand(APP_CONFIG, "budgeted run", { provider: "codex" });

    const sessionConfig = runWiringMocks.capturedSessionConfigs[0] as {
      readonly budgetAdmission?: {
        admit(input: {
          subject: "runtime-session-turn";
          sessionId: string;
          routeCandidates: readonly { providerId: string }[];
        }): Promise<{ readonly status: string }>;
      };
    };
    expect(sessionConfig.budgetAdmission).toBeDefined();
    await expect(sessionConfig.budgetAdmission?.admit({
      subject: "runtime-session-turn",
      sessionId: "next-session",
      routeCandidates: [{ providerId: "codex" }],
    })).resolves.toMatchObject({
      status: "admitted",
    });
  });

  it("does not require MCP when a harness provider is explicitly selected", async () => {
    await runCommand(APP_CONFIG, "use codex", { provider: "codex" });

    expect(runWiringMocks.capturedRunSessionInputs).toHaveLength(1);
    expect(runWiringMocks.capturedRunSessionInputs[0]).toMatchObject({
      requirements: {
        preferredProvider: "codex",
        requiresMcp: false,
      },
    });
  });

  it("uses the prepared working directory for isolated session execution", async () => {
    runWiringMocks.preparedWorkingDirectory = "C:/repo/.kiln-worktrees/session-1";

    await runCommand(APP_CONFIG, "use isolated cwd", { provider: "codex", isolate: true });

    expect(runWiringMocks.capturedSessionConfigs[0]).toMatchObject({
      cwd: "C:/repo/.kiln-worktrees/session-1",
    });
  });

  it("writes only the assistant answer to stdout in answer output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0.01,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "Only four bullets.\n",
      toolCallCount: 1,
      turnDepth: 1,
      successfulProviderId: "codex",
      successfulModelId: "gpt-5.5",
      attempts: [{
        providerId: "codex",
        model: "gpt-5.5",
        succeeded: true,
        error: null,
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await runCommand(APP_CONFIG, "exact output", { provider: "codex", output: "answer" });

    expect(stdout.text()).toBe("Only four bullets.\n");
    expect(stdout.text()).not.toContain("Kiln session starting");
    expect(stdout.text()).not.toContain("Session Complete");
    expect(runWiringMocks.capturedRunSessionInputs[0]).toMatchObject({
      output: expect.objectContaining({ mode: "answer" }),
    });
  });

  it("writes a structured envelope to stdout in json output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0.02,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "One sentence.",
      inputTokens: 12,
      outputTokens: 3,
      toolCallCount: 2,
      turnDepth: 1,
      successfulProviderId: "codex",
      successfulModelId: "gpt-5.5",
      attempts: [{
        providerId: "codex",
        model: "gpt-5.5",
        succeeded: true,
        error: null,
      }],
      transcript: [],
      exactArtifacts: ["File path touched: README.md"],
      submittedPlan: undefined,
    });

    await runCommand(APP_CONFIG, "structured output", { provider: "codex", output: "json" });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      schemaVersion: "kiln.run.output.v1",
      mode: "json",
      answer: "One sentence.",
      telemetry: {
        task: "structured output",
        domain: "Kiln",
        sessionSucceeded: true,
        provider: "codex",
        model: "gpt-5.5",
        costUsd: 0.02,
        toolCallCount: 2,
        turnDepth: 1,
      },
      diagnostics: {
        lastError: null,
        attempts: [{
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: true,
          error: null,
        }],
      },
      resources: {
        exactArtifacts: ["File path touched: README.md"],
      },
    });
    expect(stdout.text()).not.toContain("Kiln session starting");
    expect(stdout.text()).not.toContain("Session Complete");
  });

  it("writes structured failure diagnostics before exiting in json output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: false,
      lastError: "Provider failed",
      accumulatedText: "partial answer",
      inputTokens: 4,
      outputTokens: 2,
      toolCallCount: 0,
      turnDepth: 1,
      successfulProviderId: undefined,
      successfulModelId: undefined,
      attempts: [{
        providerId: "codex",
        succeeded: false,
        error: "Provider failed",
      }],
      transcript: [],
      exactArtifacts: ["Provider error: Provider failed"],
      submittedPlan: undefined,
    });

    await expect(runCommand(
      APP_CONFIG,
      "structured failure",
      { provider: "codex", output: "json" },
      { exitOnFailure: false },
    )).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "partial answer",
      telemetry: {
        task: "structured failure",
        sessionSucceeded: false,
      },
      diagnostics: {
        lastError: "Provider failed",
        attempts: [{
          providerId: "codex",
          succeeded: false,
          error: "Provider failed",
        }],
      },
    });
  });

  it("writes structured failure diagnostics for early route admission failure in json output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.evaluateRouteHealth.mockResolvedValue({
      healthy: false,
      reason: "configured route is cooling down.",
    });

    await expect(runCommand(
      APP_CONFIG,
      "early route failure",
      { provider: "openrouter", model: "qwen/qwen3-coder:free", output: "json" },
      { exitOnFailure: false },
    )).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      schemaVersion: "kiln.run.output.v1",
      mode: "json",
      answer: "",
      telemetry: {
        task: "early route failure",
        domain: "Kiln",
        sessionSucceeded: false,
        provider: "openrouter",
        model: "qwen/qwen3-coder:free",
      },
      diagnostics: {
        lastError: "No configured provider routes are currently available.",
        attempts: [],
      },
      resources: {
        exactArtifacts: [],
      },
    });
    expect(runWiringMocks.runSession).not.toHaveBeenCalled();
  });

  it("includes cleanup failure in early route admission json diagnostics", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.evaluateRouteHealth.mockResolvedValue({
      healthy: false,
      reason: "configured route is cooling down.",
    });
    runWiringMocks.cleanupWorktree.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(runCommand(
      APP_CONFIG,
      "early route cleanup failure",
      { provider: "openrouter", model: "qwen/qwen3-coder:free", output: "json" },
      { exitOnFailure: false },
    )).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      telemetry: {
        task: "early route cleanup failure",
        sessionSucceeded: false,
      },
      diagnostics: {
        lastError: "No configured provider routes are currently available.; Failed to cleanup worktree. cleanup failed",
      },
    });
  });

  it("writes structured failure diagnostics when runSession throws in json output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runSession.mockRejectedValueOnce(new Error("session exploded"));

    await expect(runCommand(
      APP_CONFIG,
      "thrown session failure",
      { provider: "codex", output: "json" },
      { exitOnFailure: false },
    )).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "",
      telemetry: {
        task: "thrown session failure",
        domain: "Kiln",
        sessionSucceeded: false,
        provider: "codex",
      },
      diagnostics: {
        lastError: "session exploded",
        attempts: [],
      },
    });
    expect(runWiringMocks.cleanupWorktree).toHaveBeenCalledTimes(1);
  });

  it("includes cleanup failure when runSession throws in json diagnostics", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runSession.mockRejectedValueOnce(new Error("session exploded"));
    runWiringMocks.cleanupWorktree.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(runCommand(
      APP_CONFIG,
      "thrown cleanup failure",
      { provider: "codex", output: "json" },
      { exitOnFailure: false },
    )).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      telemetry: {
        task: "thrown cleanup failure",
        sessionSucceeded: false,
      },
      diagnostics: {
        lastError: "session exploded; Failed to cleanup worktree. cleanup failed",
      },
    });
  });

  it("keeps json output deterministic when route health persistence fails", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.recordRouteOutcome.mockRejectedValueOnce(new Error("health store unavailable"));
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "route answer",
      toolCallCount: 0,
      turnDepth: 1,
      successfulProviderId: "openrouter",
      successfulModelId: "qwen/qwen3-coder:free",
      attempts: [{
        providerId: "openrouter",
        model: "qwen/qwen3-coder:free",
        succeeded: true,
        error: null,
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await runCommand(
      APP_CONFIG,
      "route health persistence",
      { provider: "openrouter", model: "qwen/qwen3-coder:free", output: "json" },
    );

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "route answer",
      telemetry: {
        task: "route health persistence",
        sessionSucceeded: true,
        provider: "openrouter",
        model: "qwen/qwen3-coder:free",
      },
      diagnostics: {
        lastError: null,
      },
    });
  });

  it("includes cleanup failure after provider failure in json diagnostics", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.cleanupWorktree.mockRejectedValueOnce(new Error("cleanup failed"));
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: false,
      lastError: "Provider failed",
      accumulatedText: "partial answer",
      toolCallCount: 0,
      turnDepth: 1,
      successfulProviderId: undefined,
      successfulModelId: undefined,
      attempts: [{
        providerId: "codex",
        model: "gpt-5.5",
        succeeded: false,
        error: "Provider failed",
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand(
      APP_CONFIG,
      "provider cleanup failure",
      { provider: "codex", output: "json" },
      { exitOnFailure: false },
    )).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "partial answer",
      telemetry: {
        task: "provider cleanup failure",
        sessionSucceeded: false,
      },
      diagnostics: {
        lastError: "Provider failed; Failed to cleanup worktree. cleanup failed",
      },
    });
  });

  it("writes structured failure diagnostics when final worktree cleanup fails in json output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.cleanupWorktree.mockRejectedValueOnce(new Error("cleanup failed"));
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "cleanup answer",
      toolCallCount: 0,
      turnDepth: 1,
      successfulProviderId: "codex",
      successfulModelId: "gpt-5.5",
      attempts: [{
        providerId: "codex",
        model: "gpt-5.5",
        succeeded: true,
        error: null,
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand(
      APP_CONFIG,
      "cleanup failure",
      { provider: "codex", output: "json" },
      { exitOnFailure: false },
    )).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "cleanup answer",
      telemetry: {
        task: "cleanup failure",
        sessionSucceeded: false,
        provider: "codex",
        model: "gpt-5.5",
      },
      diagnostics: {
        lastError: "Failed to cleanup worktree. cleanup failed",
      },
    });
  });

  it("includes cleanup failure when verification runner throws in json diagnostics", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runVerification.mockRejectedValueOnce(new Error("verify crashed"));
    runWiringMocks.cleanupWorktree.mockRejectedValueOnce(new Error("cleanup failed"));
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "verification throw answer",
      toolCallCount: 0,
      turnDepth: 1,
      successfulProviderId: "codex",
      successfulModelId: "gpt-5.5",
      attempts: [{
        providerId: "codex",
        model: "gpt-5.5",
        succeeded: true,
        error: null,
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand({
      ...APP_CONFIG,
      kilnYaml: {
        ...APP_CONFIG.kilnYaml,
        qualityGates: [{ name: "typecheck", command: "bun run typecheck", required: true }],
      },
    }, "verification throw cleanup failure", { provider: "codex", output: "json" }, { exitOnFailure: false }))
      .rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "verification throw answer",
      telemetry: {
        task: "verification throw cleanup failure",
        sessionSucceeded: false,
      },
      diagnostics: {
        lastError: "Failed to run verification gates. verify crashed; Failed to cleanup worktree. cleanup failed",
      },
    });
  });

  it("writes structured failure diagnostics when verification fails in json output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runVerification.mockResolvedValueOnce({
      passed: false,
      checks: [{ name: "typecheck", passed: false, output: "type error", duration: 10 }],
    });
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "verified answer",
      toolCallCount: 0,
      turnDepth: 1,
      successfulProviderId: "codex",
      successfulModelId: "gpt-5.5",
      attempts: [{
        providerId: "codex",
        model: "gpt-5.5",
        succeeded: true,
        error: null,
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand({
      ...APP_CONFIG,
      kilnYaml: {
        ...APP_CONFIG.kilnYaml,
        qualityGates: [{ name: "typecheck", command: "bun run typecheck", required: true }],
      },
    }, "verification failure", { provider: "codex", output: "json" }, { exitOnFailure: false }))
      .rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "verified answer",
      telemetry: {
        task: "verification failure",
        sessionSucceeded: false,
        provider: "codex",
        model: "gpt-5.5",
        verificationPassed: false,
      },
      diagnostics: {
        lastError: "Verification gates failed.",
        verificationResult: {
          passed: false,
        },
      },
    });
  });

  it("includes cleanup failure when session report rendering throws in json diagnostics", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.printReport.mockImplementationOnce(() => {
      throw new Error("report crashed");
    });
    runWiringMocks.cleanupWorktree.mockRejectedValueOnce(new Error("cleanup failed"));
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "report answer",
      toolCallCount: 0,
      turnDepth: 1,
      successfulProviderId: "codex",
      successfulModelId: "gpt-5.5",
      attempts: [{
        providerId: "codex",
        model: "gpt-5.5",
        succeeded: true,
        error: null,
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand(
      APP_CONFIG,
      "report cleanup failure",
      { provider: "codex", output: "json" },
      { exitOnFailure: false },
    )).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "report answer",
      telemetry: {
        task: "report cleanup failure",
        sessionSucceeded: false,
      },
      diagnostics: {
        lastError: "Failed to build session report. report crashed; Failed to cleanup worktree. cleanup failed",
      },
    });
  });

  it("keeps json output single-envelope when verification and cleanup both fail", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runVerification.mockResolvedValueOnce({
      passed: false,
      checks: [{ name: "typecheck", passed: false, output: "type error", duration: 10 }],
    });
    runWiringMocks.cleanupWorktree.mockRejectedValueOnce(new Error("cleanup failed"));
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "verified answer",
      toolCallCount: 0,
      turnDepth: 1,
      successfulProviderId: "codex",
      successfulModelId: "gpt-5.5",
      attempts: [{
        providerId: "codex",
        model: "gpt-5.5",
        succeeded: true,
        error: null,
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand({
      ...APP_CONFIG,
      kilnYaml: {
        ...APP_CONFIG.kilnYaml,
        qualityGates: [{ name: "typecheck", command: "bun run typecheck", required: true }],
      },
    }, "verification cleanup failure", { provider: "codex", output: "json" }, { exitOnFailure: false }))
      .rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "verified answer",
      telemetry: {
        task: "verification cleanup failure",
        sessionSucceeded: false,
        provider: "codex",
        model: "gpt-5.5",
        verificationPassed: false,
      },
      diagnostics: {
        lastError: "Verification gates failed.; Failed to cleanup worktree. cleanup failed",
        verificationResult: {
          passed: false,
        },
      },
    });
  });

  it("requires MCP only when no provider is explicitly selected", () => {
    expect(buildRunSessionRequirements(undefined)).toEqual({
      preferredProvider: undefined,
      requiresMcp: true,
    });
    expect(buildRunSessionRequirements("codex")).toEqual({
      preferredProvider: "codex",
      requiresMcp: false,
    });
  });

  it("fails direct-provider admission when discovery does not advertise the selected model", () => {
    expect(resolveRunProviderModelAdmission({
      provider: "openrouter",
      model: "qwen/qwen3-coder-480b-a35b-instruct:free",
      discovery: {
        openrouter: {
          models: ["qwen/qwen3-coder:free"],
          status: "available",
          reason: "OpenRouter models discovered.",
        },
      },
    })).toEqual({
      ok: false,
      error: "Provider 'openrouter' does not advertise model 'qwen/qwen3-coder-480b-a35b-instruct:free'",
    });
  });

  it("admits direct provider execution only for discovered model ids", () => {
    expect(resolveRunProviderModelAdmission({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      discovery: {
        openrouter: {
          models: ["qwen/qwen3-coder:free"],
          status: "available",
          reason: "OpenRouter models discovered.",
        },
      },
    })).toEqual({ ok: true });
  });

  it("fails wrapper admission when discovery does not advertise an explicit model", () => {
    expect(resolveRunProviderModelAdmission({
      provider: "codex",
      model: "gpt-5.5",
      discovery: {
        codex: {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex models discovered.",
        },
      },
    })).toEqual({
      ok: false,
      error: "Provider 'codex' does not advertise model 'gpt-5.5'",
    });
  });

  it("allows wrapper admission without an explicit model so the native harness default can run", () => {
    expect(resolveRunProviderModelAdmission({
      provider: "codex",
      model: undefined,
      discovery: {},
    })).toEqual({ ok: true });
  });

  it("admits wrapper execution for discovered explicit model ids", () => {
    expect(resolveRunProviderModelAdmission({
      provider: "codex",
      model: "gpt-5.4-mini",
      discovery: {
        codex: {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex models discovered.",
        },
      },
    })).toEqual({ ok: true });
  });

  it("blocks wrapper execution before runSession when explicit model readiness fails", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    runWiringMocks.probeCodexCliModelReadiness.mockResolvedValueOnce({
      provider: "codex",
      model: "gpt-5.5",
      runnable: false,
      status: "model_version_unsupported",
      reason: "Codex CLI model support is out of date: The 'gpt-5.5' model requires a newer version of Codex.",
      authState: "authenticated",
    });

    await expect(runCommand(APP_CONFIG, "ship it", {
      provider: "codex",
      model: "gpt-5.5",
    })).rejects.toThrow("process.exit");

    expect(runWiringMocks.discoverGuiCliOperatorModels).toHaveBeenCalledWith(expect.objectContaining({
      codex: true,
      opencode: false,
    }));
    expect(runWiringMocks.probeCodexCliModelReadiness).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.5",
    }));
    expect(runWiringMocks.runSession).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("admits wrapper execution when explicit missing model passes live readiness probe", async () => {
    await runCommand(APP_CONFIG, "ship it", {
      provider: "codex",
      model: "gpt-5.5",
    });

    expect(runWiringMocks.probeCodexCliModelReadiness).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.5",
    }));
    expect(runWiringMocks.capturedRunSessionInputs[0]).toMatchObject({
      routeCandidates: [
        { provider: "codex", model: "gpt-5.5" },
      ],
    });
  });

  it("checks route health before direct provider execution and records success", async () => {
    await runCommand(APP_CONFIG, "ship it", { provider: "openrouter", model: "qwen/qwen3-coder:free" });

    expect(runWiringMocks.evaluateRouteHealth).toHaveBeenCalledWith("openrouter", "qwen/qwen3-coder:free");
    expect(runWiringMocks.recordRouteOutcome).toHaveBeenCalledWith({
      providerId: "openrouter",
      modelId: "qwen/qwen3-coder:free",
      outcome: { type: "ok" },
    });
  });

  it("skips cooling configured routes and passes healthy fallback candidates to runSession", async () => {
    readGlobalConfigMock.mockReturnValue({
      version: "1",
      routing: {
        routes: [
          { provider: "openrouter", model: "qwen/qwen3-coder:free" },
          { provider: "openrouter", model: "openrouter/free" },
          { provider: "codex" },
        ],
      },
    });
    runWiringMocks.evaluateRouteHealth.mockImplementation((provider: string, model: string) =>
      provider === "openrouter" && model === "qwen/qwen3-coder:free"
        ? Promise.resolve({
            healthy: false,
            reason: "qwen route is temporarily rate-limited.",
          })
        : Promise.resolve({ healthy: true })
    );

    await runCommand(APP_CONFIG, "ship it", {});

    expect(runWiringMocks.capturedRunSessionInputs[0]).toMatchObject({
      routeCandidates: [
        { provider: "openrouter", model: "openrouter/free" },
        { provider: "codex" },
      ],
    });
  });

  it("cleans up an isolated worktree before exiting when configured routes are unavailable", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    runWiringMocks.preparedWorkingDirectory = "C:/repo/.kiln-worktrees/session-unavailable";
    runWiringMocks.evaluateRouteHealth.mockResolvedValue({
      healthy: false,
      reason: "configured route is cooling down.",
    });

    await expect(runCommand(APP_CONFIG, "ship it", {
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      isolate: true,
    })).rejects.toThrow("process.exit");

    expect(runWiringMocks.runSession).not.toHaveBeenCalled();
    expect(runWiringMocks.cleanupWorktree).toHaveBeenCalledWith(expect.objectContaining({
      worktreePath: "C:/repo/.kiln-worktrees/session-unavailable",
    }));
    exit.mockRestore();
  });

  it("records retryable direct provider failures as route health outcomes", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: false,
      lastError: "All credentials in the pool are exhausted: last outcome rate-limited; last error openrouter API error 429",
      accumulatedText: "",
      toolCallCount: 0,
      turnDepth: 0,
      successfulProviderId: undefined,
      successfulModelId: undefined,
      attempts: [{
        providerId: "openrouter",
        model: "qwen/qwen3-coder:free",
        succeeded: false,
        error: "All credentials in the pool are exhausted: last outcome rate-limited; last error openrouter API error 429",
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand(APP_CONFIG, "ship it", {
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
    })).rejects.toThrow("process.exit");

    expect(runWiringMocks.recordRouteOutcome).toHaveBeenCalledWith({
      providerId: "openrouter",
      modelId: "qwen/qwen3-coder:free",
      outcome: { type: "rate-limited" },
      errorMessage: "All credentials in the pool are exhausted: last outcome rate-limited; last error openrouter API error 429",
    });
    exit.mockRestore();
  });

  it("removes process signal handlers after a completed run", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    await runCommand(APP_CONFIG, "cleanup lifecycle", { provider: "codex" });

    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });

  it("aborts the active run session before signal cleanup exits", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const exitCodes: Array<string | number | null | undefined> = [];
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      exitCodes.push(code);
      return undefined as never;
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    runWiringMocks.runSession.mockImplementationOnce(async () => {
      const input = runWiringMocks.capturedRunSessionInputs[0] as {
        readonly abortSignal?: AbortSignal;
      };
      await waitForCondition(() => input.abortSignal?.aborted === true);
      return {
        finalCostUsd: 0,
        sessionSucceeded: false,
        lastError: "Aborted during execution",
        accumulatedText: "",
        toolCallCount: 0,
        turnDepth: 0,
        successfulProviderId: undefined,
        successfulModelId: undefined,
        attempts: [{
          providerId: "codex",
          succeeded: false,
          error: "Aborted during execution",
        }],
        transcript: [],
        exactArtifacts: [],
        submittedPlan: undefined,
      };
    });

    const run = runCommand(APP_CONFIG, "interrupt active run", { provider: "codex" }, { exitOnFailure: false });
    const runExpectation = expect(run).rejects.toThrow("Kiln run exited with code 1");

    await waitForCondition(() => process.listenerCount("SIGINT") > beforeSigint);
    await waitForCondition(() => runWiringMocks.capturedRunSessionInputs.length > 0);
    const input = runWiringMocks.capturedRunSessionInputs[0] as {
      readonly abortSignal?: AbortSignal;
    };

    expect(input.abortSignal).toBeInstanceOf(AbortSignal);
    expect(input.abortSignal?.aborted).toBe(false);
    process.emit("SIGINT");
    await waitForCondition(() => input.abortSignal?.aborted === true);
    expect(input.abortSignal?.reason).toBe("Parent run interrupted by SIGINT.");
    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.abortSignal?.reason).toBe("Parent run interrupted by SIGINT.");

    await runExpectation;

    expect(exitCodes).toEqual([130]);
    expect(runWiringMocks.cleanupRegistryRunAll).toHaveBeenCalledTimes(1);
    expect(runWiringMocks.cleanupWorktree).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
    exit.mockRestore();
  });

  it("keeps parallel-worker signal cleanup active across transcript initialization", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const transcriptInit = deferred<void>();
    const registryCleanup = deferred<void>();
    const events: string[] = [];
    const exitCodes: Array<string | number | null | undefined> = [];
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      events.push("exit");
      exitCodes.push(code);
      return undefined as never;
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    runWiringMocks.transcriptInit.mockReturnValueOnce(transcriptInit.promise);
    runWiringMocks.transcriptFinalize.mockImplementationOnce(async () => {
      events.push("finalize");
    });
    runWiringMocks.cleanupRegistryRunAll.mockImplementationOnce(async () => {
      events.push("registry-cleanup");
      await registryCleanup.promise;
    });
    runWiringMocks.cleanupWorktree.mockImplementationOnce(async () => {
      events.push("worktree-cleanup");
    });

    const run = runCommand({
      ...APP_CONFIG,
      managedInvocation: parallelManagedInvocation(),
    }, "parallel cleanup", { provider: "codex", workers: 2 }, { exitOnFailure: false });

    await waitForCondition(() => process.listenerCount("SIGINT") > beforeSigint);
    process.emit("SIGINT", "SIGINT");
    expect(process.listenerCount("SIGINT")).toBeGreaterThan(beforeSigint);

    transcriptInit.resolve();

    await waitForCondition(() => events.includes("registry-cleanup"));
    expect(process.listenerCount("SIGINT")).toBeGreaterThan(beforeSigint);
    process.emit("SIGINT", "SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exitCodes).toEqual([]);

    registryCleanup.resolve();

    await waitForCondition(() => exitCodes.length > 0);
    await run;

    expect(exitCodes).toEqual([130]);
    expect(events).toEqual(["finalize", "registry-cleanup", "worktree-cleanup", "exit"]);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
    exit.mockRestore();
  });

  it("continues parallel-worker signal cleanup when transcript finalization fails", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const transcriptInit = deferred<void>();
    const events: string[] = [];
    const exitCodes: Array<string | number | null | undefined> = [];
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      events.push("exit");
      exitCodes.push(code);
      return undefined as never;
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runWiringMocks.transcriptInit.mockReturnValueOnce(transcriptInit.promise);
    runWiringMocks.transcriptFinalize.mockImplementationOnce(async () => {
      events.push("finalize");
      throw new Error("finalize failed");
    });
    runWiringMocks.cleanupRegistryRunAll.mockImplementationOnce(async () => {
      events.push("registry-cleanup");
    });
    runWiringMocks.cleanupWorktree.mockImplementationOnce(async () => {
      events.push("worktree-cleanup");
    });

    const run = runCommand({
      ...APP_CONFIG,
      managedInvocation: parallelManagedInvocation(),
    }, "parallel cleanup", { provider: "codex", workers: 2 }, { exitOnFailure: false });

    await waitForCondition(() => process.listenerCount("SIGINT") > beforeSigint);
    process.emit("SIGINT", "SIGINT");
    transcriptInit.resolve();

    await waitForCondition(() => exitCodes.length > 0);
    await run;

    expect(exitCodes).toEqual([130]);
    expect(events).toEqual(["finalize", "registry-cleanup", "worktree-cleanup", "exit"]);
    expect(errorSpy.mock.calls.map((call) => call[0]).join("\n")).toContain("Parallel worker cleanup failed");
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
    exit.mockRestore();
  });

  it("runs verification gates inside the prepared working directory", async () => {
    runWiringMocks.preparedWorkingDirectory = "C:/repo/.kiln-worktrees/session-verify";

    await runCommand({
      ...APP_CONFIG,
      kilnYaml: {
        ...APP_CONFIG.kilnYaml,
        qualityGates: [{ name: "typecheck", command: "bun run typecheck", required: true }],
      },
    }, "verify isolated cwd", { provider: "codex", isolate: true });

    expect(runWiringMocks.runVerification).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "typecheck" })]),
      "C:/repo/.kiln-worktrees/session-verify",
    );
  });

  it("cleans up an isolated worktree before exiting a failed run", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: false,
      lastError: "Provider failed",
      accumulatedText: "",
      toolCallCount: 0,
      turnDepth: 0,
      successfulProviderId: undefined,
      successfulModelId: undefined,
      attempts: [{
        providerId: "codex",
        succeeded: false,
        error: "Provider failed",
      }],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand(APP_CONFIG, "ship it", { provider: "codex", isolate: true })).rejects.toThrow(
      "process.exit",
    );

    expect(runWiringMocks.cleanupWorktree).toHaveBeenCalledWith(expect.objectContaining({
      worktreePath: REPO_ROOT,
    }));
    exit.mockRestore();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function captureStdout() {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    chunks.push(message === undefined ? "\n" : `${String(message)}\n`);
  });
  return {
    text: () => chunks.join(""),
  };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}

function parallelManagedInvocation() {
  return {
    requestedBy: "operator",
    requestSource: "cli:run-workers",
    invocationService: {},
    routes: [{
      routeId: "codex-isolated",
      providerId: "codex",
      model: "gpt-5.5",
      adapter: {
        descriptor: {
          lifecycle: {
            exposesStart: true,
            exposesTerminal: true,
          },
        },
      },
      profiles: {
        "foundation-apply-approved-writes": {
          workingDirectory: {
            mode: "isolated-worktree",
          },
          workingDirectoryLease: {
            mode: "git-worktree",
          },
        },
      },
    }],
  } as never;
}

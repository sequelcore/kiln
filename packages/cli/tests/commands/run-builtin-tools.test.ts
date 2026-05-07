import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { KilnAppConfig } from "../../src/config.js";
import { buildRunSessionRequirements, resolveRunProviderModelAdmission, runCommand } from "../../src/commands/run.js";
import { readGlobalConfig } from "../../src/config/global-config.js";

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
    capturedSessionConfigs: [] as unknown[],
    capturedRunSessionInputs: [] as unknown[],
    evaluateRouteHealth: vi.fn().mockResolvedValue({ healthy: true }),
    recordRouteOutcome: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@kilnai/runtime", () => ({
  getProjectContextArtifactCache: vi.fn().mockResolvedValue({
    set: vi.fn(),
  }),
  createAttachedRuntimeBuiltinToolSurface: vi.fn(() => ({
    toolDefinitions: [],
    callBuiltinTools: new Map(),
    capabilities: new Map(),
    toolAuthority: new Map(),
  })),
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
    async init() {}
    async append() {}
    async finalize() {}
    async readMeta() {
      return null;
    }
  },
}));

vi.mock("../../src/wrapper/session-manager.js", () => ({
  SessionManager: class {
    readonly sessionStartTimeMs = Date.now();

    async prepare(task: string, cwd: string) {
      return {
        domain: { displayName: "Kiln" },
        projectedContext: { blocks: [], estimatedTokens: 0 },
        systemPrompt: "System prompt",
        mcpServerEntryPath: "/tmp/mcp-entry.js",
        workingDirectory: cwd,
        worktreePath: cwd,
        task,
        resumeStrategy: "none",
      };
    }

    cleanup() {
      return { task: "test", domain: "Kiln", phaseReached: "implement", cost: { total: 0, byRoleModel: {} }, duration: 1 };
    }

    async cleanupWorktree() {}
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
  cleanupRegistry: { runAll: vi.fn() },
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
    readGlobalConfigMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds model-facing governed builtin tool options and passes them into sessionConfig", async () => {
    await runCommand(APP_CONFIG, "ship it", { provider: "openai", model: "gpt-4o", apiKey: "sk-test" });

    expect(runWiringMocks.loadConfiguredWebToolSurfaceOptions).toHaveBeenCalledWith(
      APP_CONFIG,
      process.cwd(),
      {
        memoryAuthority: {
          modelFacingSession: true,
          permissionPolicy: { approval: "never", sandbox: "workspace-write" },
          permissionAgent: undefined,
          caller: { kind: "operator_surface", id: "run" },
        },
      },
    );
    expect(runWiringMocks.createSessionBuiltinToolOptions).toHaveBeenCalledWith({
      id: "surface-options",
      additionalTools: expect.arrayContaining([
        expect.objectContaining({ name: "kiln_config.read" }),
        expect.objectContaining({ name: "kiln_config.propose_change" }),
      ]),
    });
    expect(runWiringMocks.capturedSessionConfigs).toHaveLength(1);
    expect(runWiringMocks.capturedSessionConfigs[0]).toMatchObject({
      builtinToolOptions: { id: "session-builtin-tool-options" },
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
});

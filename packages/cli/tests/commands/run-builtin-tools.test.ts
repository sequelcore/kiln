import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { KilnAppConfig } from "../../src/config.js";
import { buildRunSessionRequirements, runCommand } from "../../src/commands/run.js";

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
  ManagedDirectProviderRuntimeAdapter: class MockManagedDirectProviderRuntimeAdapter {},
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    createSessionBuiltinToolOptions: runWiringMocks.createSessionBuiltinToolOptions,
  };
});

vi.mock("../../src/config/web-tools-config.js", () => ({
  loadConfiguredWebToolSurfaceOptions: runWiringMocks.loadConfiguredWebToolSurfaceOptions,
}));

vi.mock("../../src/application/run-session.js", () => ({
  runSession: vi.fn(async (input: { sessionConfig: unknown }) => {
    runWiringMocks.capturedSessionConfigs.push(input.sessionConfig);
    runWiringMocks.capturedRunSessionInputs.push(input);
    return runWiringMocks.runSession();
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
}));

vi.mock("../../src/config/env-config.js", () => ({
  resolveEffectiveModel: vi.fn((model: string | undefined) => model),
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
    registry: {},
    worktreeManager: {},
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

describe("run command builtin tool wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runWiringMocks.capturedSessionConfigs.length = 0;
    runWiringMocks.capturedRunSessionInputs.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds model-facing governed builtin tool options and passes them into sessionConfig", async () => {
    await runCommand(APP_CONFIG, "ship it", { provider: "openai", apiKey: "sk-test" });

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
    expect(runWiringMocks.createSessionBuiltinToolOptions).toHaveBeenCalledWith({ id: "surface-options" });
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

  it("removes process signal handlers after a completed run", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    await runCommand(APP_CONFIG, "cleanup lifecycle", { provider: "codex" });

    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });
});

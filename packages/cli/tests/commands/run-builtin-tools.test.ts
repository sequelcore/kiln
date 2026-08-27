import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
  type ManagedAgentOrchestrationLifecycleInput,
} from "@kilnai/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import {
  buildRunSessionRequirements,
  createCliAttendedTrustedExecutionLeaseApprovalPort,
  createCliRuntimeApprovalHandler,
  resolveRunProviderModelAdmission,
  runCommand,
} from "../../src/commands/run.js";
import { loadKilnConfig } from "../../src/config/config-merger.js";
import { readGlobalConfig } from "../../src/config/global-config.js";
import type { KilnAppConfig } from "../../src/config.js";
import type { ResolvedKilnConfig } from "../../src/kiln-yaml.js";
import type { PersistedAuthorityAdmissionRecord } from "../../src/wrapper/session-store.js";
import { makeOperatorSurfaceGlobalConfig } from "./operator-surface-config-fixture.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const ADMITTED_PARENT_TURN_AUTHORITY = {
  executionMode: "execute",
  requestedAuthority: "destructive",
  admittedAuthority: "destructive",
  sourcePolicy: "runtime_surface_projection",
  reason: "test parent turn authority is explicitly admitted",
  completeness: "authoritative",
  toolCount: 1,
  deniedToolCount: 0,
} as const;

function defineTestRoutedAdmission(input: {
  readonly routeId: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly accountId: string;
  readonly credentialId: string;
  readonly credentialRevision: string;
}): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "test-runtime-session",
    turnId: "test-turn",
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "sha256:test-session-revision", revisions: { routes: "test" } },
      turnRevision: { revisionSetId: "sha256:test-turn-revision", revisions: { routes: "test" } },
    },
    session: {
      skillCatalog: { catalogId: "test", revision: "test", skillIds: [] },
      authorityCeiling: {
        maximumAuthority: "destructive",
        reason: "test admission",
        subjectId: "test-runtime-session",
      },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "destructive",
        admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection",
        reason: "test admission",
        completeness: "authoritative",
        toolCount: 0,
        deniedToolCount: 0,
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "observe",
        boundaries: ["workspace"],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: ["local-state"],
        idempotency: "idempotent",
      },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: input.routeId,
          providerId: input.providerId,
          providerModelId: input.providerModelId,
          accountSelection: { kind: "operator-override", accountPolicyId: "fixture-policy", accountId: input.accountId },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId: input.routeId,
          accountId: input.accountId,
          credentialId: input.credentialId,
          credentialRevision: input.credentialRevision,
        },
      },
    },
  });
}

vi.setConfig({ testTimeout: 30_000 });

const runWiringMocks = vi.hoisted(() => {
  const builtinToolSurfaceOptions = { id: "surface-options" };
  const builtinToolOptions = { id: "session-builtin-tool-options" };
  const cleanupHandlers: Array<() => Promise<void>> = [];
  const drainCleanupHandlers = async () => {
    const handlers = cleanupHandlers.splice(0);
    await Promise.allSettled(handlers.map((handler) => handler()));
  };
  return {
    loadConfiguredWebToolSurfaceOptions: vi.fn().mockResolvedValue(builtinToolSurfaceOptions),
    createSessionBuiltinToolOptions: vi.fn((_options?: unknown) => builtinToolOptions),
    runSession: vi.fn().mockResolvedValue({
      finalCostUsd: 0,
      sessionSucceeded: true,
      lastError: null,
      accumulatedText: "",
      toolCallCount: 0,
      turnDepth: 0,
      successfulProviderId: "openai",
      providersUsed: ["openai"],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    }),
    summarizeContextGovernance: vi.fn(() => ({ preview: true })),
    printContextGovernancePreview: vi.fn(),
    printReport: vi.fn(),
    computeEvalScore: vi.fn(() => undefined),
    cleanupWorktree: vi.fn().mockResolvedValue(undefined),
    cleanupHandlers,
    drainCleanupHandlers,
    cleanupRegistryRunAll: vi.fn(drainCleanupHandlers),
    cleanupRegistryRegister: vi.fn((handler: () => Promise<void>) => cleanupHandlers.push(handler)),
    createManagedAgentInvocationResourceProvider: vi.fn((_options?: unknown) => ({
      id: "managed-agent-resource-provider",
    })),
    runManagedAgentOrchestrationLifecycle: vi.fn(),
    runVerification: vi.fn().mockResolvedValue({ passed: true, checks: [] }),
    transcriptInit: vi.fn().mockResolvedValue(undefined),
    transcriptFinalize: vi.fn().mockResolvedValue(undefined),
    authorityAdmissions: new Map<string, PersistedAuthorityAdmissionRecord[]>(),
    authorityAdmissionEvidenceStore: undefined as
      | { persist(bundle: EffectiveAuthorityAdmissionBundle): Promise<void> }
      | undefined,
    preparedWorkingDirectory: undefined as string | undefined,
    qualityGates: [] as Array<{ name: string; command: string; required: boolean }>,
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
  };
});

const operatorCompositionMocks = vi.hoisted(() => {
  const state: { dispatchError?: Error } = {};
  const create = vi.fn(
    (input: {
      readonly initialCatalog: {
        readonly accounts: readonly {
          readonly id: string;
          readonly credentialId: string;
        }[];
        readonly accountPolicies: readonly {
          readonly id: string;
          readonly accountIds: readonly string[];
        }[];
        readonly targets: readonly {
          readonly id: string;
          readonly providerId: string;
          readonly providerModelId: string;
          readonly accountPolicyId: string;
        }[];
      };
    }) => {
      let handler: ((input: unknown) => Promise<unknown>) | undefined;
      const bridge = {
        bind(nextHandler: (input: unknown) => Promise<unknown>) {
          if (handler) throw new Error("Test execution bridge is already bound.");
          handler = nextHandler;
        },
        dispatchCommittedTurn(committedTurn: unknown) {
          if (!handler) throw new Error("Test execution bridge is not bound.");
          return handler(committedTurn);
        },
      };
      return {
        accountRuntime: {},
        bridge,
        authorityAdmissionBridge: { bind: vi.fn() },
        dispatcher: {
          dispatchTurn: vi.fn(
            async (request: {
              readonly intent: { readonly targetId: string; readonly accountOverrideId?: string };
              readonly payload: unknown;
            }) => {
              if (state.dispatchError) throw state.dispatchError;
              const target = input.initialCatalog.targets.find((candidate) => candidate.id === request.intent.targetId);
              if (!target) throw new Error("Unknown test execution target '" + request.intent.targetId + "'.");
              const policy = input.initialCatalog.accountPolicies.find((candidate) => candidate.id === target.accountPolicyId);
              const accountId = request.intent.accountOverrideId ?? policy?.accountIds[0];
              if (!accountId) throw new Error("No test account is available for target '" + target.id + "'.");
              const account = input.initialCatalog.accounts.find((candidate) => candidate.id === accountId);
              if (!account) throw new Error("Unknown test account '" + accountId + "'.");
              const admission = {
                targetId: target.id,
                providerId: target.providerId,
                providerModelId: target.providerModelId,
                accountSelection: request.intent.accountOverrideId
                  ? { kind: "operator-override" as const, accountPolicyId: target.accountPolicyId, accountId }
                  : { kind: "policy" as const, accountPolicyId: target.accountPolicyId, eligibleAccountIds: [accountId] },
              };
              const authorityAdmission = defineTestRoutedAdmission({
                routeId: target.id,
                providerId: target.providerId,
                providerModelId: target.providerModelId,
                accountId,
                credentialId: account.credentialId,
                credentialRevision: "sha256:test-revision",
              });
              await runWiringMocks.authorityAdmissionEvidenceStore?.persist(authorityAdmission);
              const result = await bridge.dispatchCommittedTurn({
                admission,
                binding: {
                  status: "bound",
                  routeId: target.id,
                  accountId,
                  credentialId: account.credentialId,
                  credentialRevision: "sha256:test-revision",
                },
                credential: { kind: "test" },
                configurationRevision: {
                  revisionSetId: "fixture",
                  revisions: { "execution-catalog": "fixture" },
                },
                authorityAdmission,
                payload: request.payload,
              });
              return {
                admission,
                accountId,
                leaseId: "test-lease",
                evidence: {
                  routeId: target.id,
                  accountId,
                  credentialId: account.credentialId,
                  credentialRevision: "sha256:test-revision",
                  capacityIdentity: "test-capacity",
                  leaseId: "test-lease",
                  dispatchFenceId: "test-dispatch",
                  status: "completed",
                },
                result,
              };
            },
          ),
        },
        close: vi.fn(),
      };
    },
  );
  return { create, state };
});

vi.mock("@kilnai/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/runtime")>();
  return {
    ...actual,
    attachManagedInvocationSessionEventSink: vi.fn(
      (attachment: Record<string, unknown> | undefined, sessionEventSink: unknown) => {
        if (!attachment) {
          return undefined;
        }
        return {
          ...attachment,
          sessionEventSink,
        };
      },
    ),
    getProjectContextArtifactCache: vi.fn().mockResolvedValue({
      set: vi.fn(),
    }),
    createAttachedRuntimeBuiltinToolSurface: vi.fn(() => ({
      toolDefinitions: [],
      callBuiltinTools: new Map(),
      capabilities: new Map(),
      toolAuthority: new Map(),
    })),
    OperatorAuthorityAdmissionCoordinator: class MockOperatorAuthorityAdmissionCoordinator {
      constructor(options: unknown) {
        runWiringMocks.authorityAdmissionEvidenceStore = (
          options as {
            readonly evidenceStore?: { persist(bundle: EffectiveAuthorityAdmissionBundle): Promise<void> };
          }
        ).evidenceStore;
      }

      consume(_executionId: string, _bundle: unknown) {
        return {
          runtimeSession: { id: "test-runtime-session" },
          builtinToolSurface: { dispose: vi.fn() },
          mcpClients: [],
          mcpCapabilities: [],
          perCallConfig: {},
        };
      }
    },
    RuntimeSessionTurnBudgetService: class MockRuntimeSessionTurnBudgetService {
      constructor(
        _policy: { readonly tokenLimit: number },
        private readonly usageReader: (sessionId: string) => Promise<unknown>,
      ) {}

      async admit(sessionId: string) {
        return {
          status: "admitted",
          reason: "observed-below-limit",
          observation: await this.usageReader(sessionId),
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
    withManagedAgentInvocationResourceProvider: (
      options: Record<string, unknown> | undefined,
      input: Record<string, unknown> | undefined,
    ) => {
      if (!input) {
        return options;
      }
      const provider = runWiringMocks.createManagedAgentInvocationResourceProvider({
        ...input,
        artifactStore: (options?.artifactResources as { store?: unknown } | undefined)?.store,
      });
      return runWiringMocks.createSessionBuiltinToolOptions({
        ...options,
        resourceProviders: [...((options?.resourceProviders as readonly unknown[] | undefined) ?? []), provider],
      });
    },
    withManagedInvocationService: (options: Record<string, unknown>) => ({
      ...options,
      invocationService: options.invocationService ?? {},
    }),
    runManagedAgentOrchestrationLifecycle: runWiringMocks.runManagedAgentOrchestrationLifecycle,
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
  };
});

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
  runSession: vi.fn(
    async (input: { sessionConfig: unknown; routeCandidates?: readonly { provider: string; model?: string }[] }) => {
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
          ? [
              {
                providerId: firstCandidate.provider,
                ...(firstCandidate.model ? { model: firstCandidate.model } : {}),
                succeeded: result.sessionSucceeded,
                error: result.lastError,
              },
            ]
          : [],
      };
    },
  ),
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
  readGlobalExecutionTargetCatalog: vi.fn((config) =>
    config?.targetCatalog
      ? {
          accounts: config.targetCatalog.accounts,
          accountPolicies: config.targetCatalog.accountPolicies,
          targets: config.targetCatalog.targets
            .filter((target: { kind: string }) => target.kind === "direct")
            .map(({ kind: _kind, ...target }: { kind: string }) => target),
        }
      : undefined,
  ),
  projectDirectExecutionTargetCatalog: vi.fn((config) =>
    config?.targetCatalog
      ? {
          accounts: config.targetCatalog.accounts,
          accountPolicies: config.targetCatalog.accountPolicies,
          targets: config.targetCatalog.targets
            .filter((target: { kind: string }) => target.kind === "direct")
            .map(({ kind: _kind, ...target }: { kind: string }) => target),
        }
      : undefined,
  ),
  resolveGlobalConfigPath: vi.fn(() => "C:\\Users\\operator\\.kiln\\config.yaml"),
  resolveGlobalDefaultModel: vi.fn(() => undefined),
  resolveGlobalDefaultProvider: vi.fn(() => undefined),
}));

vi.mock("../../src/application/project-root-resolver.js", () => ({
  resolveProjectRoot: vi.fn(() => ({ rootPath: REPO_ROOT, source: "cwd" })),
}));

vi.mock("../../src/application/operator-turn-dispatch-composition.js", () => ({
  createOperatorTurnDispatchComposition: operatorCompositionMocks.create,
}));

vi.mock("../../src/kiln-yaml.js", () => ({
  readKilnYamlFile: vi.fn(() => ({ version: "1", skillGeneration: { enabled: false } })),
}));

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: vi.fn().mockResolvedValue(undefined),
  loadResolvedKilnMcpConfiguration: vi.fn(() => ({ diagnostics: [], servers: {} })),
}));

vi.mock("../../src/application/agent-skill-context.js", () => ({
  resolveAgentSkillContextCandidates: vi.fn(() => []),
  withContextCandidates: vi.fn((appConfig: unknown) => appConfig),
}));

vi.mock("../../src/application/instruction-profile-context.js", () => ({
  resolveInstructionProfileContextCandidates: vi.fn(() => []),
}));

vi.mock("../../src/application/work-governance-context.js", () => ({
  withWorkGovernanceContext: vi.fn((appConfig: unknown) => appConfig),
}));

vi.mock("../../src/config/operator-identity-context.js", () => ({
  withGlobalIdentityContext: vi.fn((appConfig: unknown) => appConfig),
}));

vi.mock("../../src/config/interactive-use-config.js", () => ({
  loadConfiguredInteractiveUseToolSurfaceOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/config/managed-agent-provider-models.js", () => ({
  discoverManagedAgentProviderModels: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../src/config/managed-agent-routes.js", () => ({
  closeManagedAccountRuntimeComposition: vi.fn().mockResolvedValue(undefined),
  resolveManagedInvocationToolOptions: vi.fn().mockResolvedValue({ routeHealth: [] }),
}));

vi.mock("../../src/wrapper/session-store.js", () => ({
  TranscriptStore: class {
    authorityAdmissionLockPath(_sessionId: string) {
      return resolve(resolveProjectStateBinding(REPO_ROOT).sessionsPath, "test-authority-admission.lock");
    }
    async init(...args: unknown[]) {
      await runWiringMocks.transcriptInit(...args);
    }
    async append() {}
    async appendAuthorityAdmission(record: PersistedAuthorityAdmissionRecord) {
      const records = runWiringMocks.authorityAdmissions.get(record.sessionId) ?? [];
      runWiringMocks.authorityAdmissions.set(record.sessionId, [...records, record]);
    }
    async finalize(...args: unknown[]) {
      await runWiringMocks.transcriptFinalize(...args);
    }
    async readMeta() {
      return null;
    }
    async readTranscript() {
      return [];
    }
    async readAuthorityAdmissions(sessionId: string) {
      return runWiringMocks.authorityAdmissions.get(sessionId) ?? [];
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
        domain: { displayName: "Kiln", qualityGates: runWiringMocks.qualityGates },
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
      return {
        task: "test",
        domain: "Kiln",
        phaseReached: "implement",
        cost: { total: 0, byRoleModel: {} },
        duration: 1,
      };
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
  isDirectApiProvider: vi.fn(
    (provider?: string) =>
      provider === "anthropic" ||
      provider === "openai" ||
      provider === "deepseek" ||
      provider === "openrouter" ||
      provider === "ollama" ||
      provider === "lmstudio" ||
      provider === "codex-oauth" ||
      provider === "opencode-go" ||
      provider === "opencode-zen",
  ),
}));

vi.mock("../../src/wrapper/cleanup-registry.js", () => ({
  cleanupRegistry: {
    register: runWiringMocks.cleanupRegistryRegister,
    runAll: runWiringMocks.cleanupRegistryRunAll,
  },
}));

vi.mock("../../src/application/session-hooks.js", () => ({
  SessionHooks: class {
    sessionStart() {}
    sessionEnd() {}
  },
}));

const APP_KILN_YAML: ResolvedKilnConfig = {
  version: "1",
  skillGeneration: {
    enabled: false,
  },
};

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be called in run builtin tool tests");
  },
  kilnYaml: APP_KILN_YAML,
};

const readGlobalConfigMock = readGlobalConfig as unknown as ReturnType<typeof vi.fn>;
const loadKilnConfigMock = loadKilnConfig as unknown as ReturnType<typeof vi.fn>;

function configureExecutionRoute(providerId = "codex-oauth", providerModelId = "gpt-5.5", routeId = "codex-route") {
  const config = makeOperatorSurfaceGlobalConfig(providerId, providerModelId, routeId);
  readGlobalConfigMock.mockReturnValue(config);
  return config;
}

describe("run command builtin tool wiring", () => {
  it("exposes exact attended trusted-execution approval only on an interactive human CLI surface", async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    const port = createCliAttendedTrustedExecutionLeaseApprovalPort({
      outputMode: "human",
      inputInteractive: true,
      outputInteractive: true,
      prompt,
    });
    const binding = {
      kind: "trusted-execution-lease",
      scope: "session",
      localPrincipalId: "local-operator-session:test",
      operatorSessionId: "operator-session-test",
      invocationTreeId: "managed-invocation-test",
      projectRuntimeId: `krp_${"1".repeat(64)}`,
      compositionRevision: `sha256:${"2".repeat(64)}`,
      harness: "codex",
      routeId: "codex-direct",
      profileCeiling: "trusted-full-access",
      allowedToolNames: ["workspace.read", "workspace.write"],
      effectCeiling: {
        operation: "mutate",
        boundaries: ["workspace"],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: ["local-state"],
        idempotency: "idempotent",
      },
      policyDigest: `sha256:${"3".repeat(64)}`,
      enforcementRevision: "runtime-attended-trusted-execution-v1",
      issuedAt: "2026-08-24T00:00:00.000Z",
      expiresAt: "2026-08-24T01:00:00.000Z",
    } as const;

    await expect(port?.approve(binding)).resolves.toEqual({
      status: "approved",
      authorizedBy: "Interactive CLI operator",
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]?.[0]).toContain("Opaque local session capability: local-operator-session:test");
    expect(prompt.mock.calls[0]?.[0]).toContain("Operator session: operator-session-test");
    expect(prompt.mock.calls[0]?.[0]).toContain("Invocation tree: managed-invocation-test");
    expect(prompt.mock.calls[0]?.[0]).toContain(`Project: ${binding.projectRuntimeId}`);
    expect(prompt.mock.calls[0]?.[0]).toContain(`Composition revision: ${binding.compositionRevision}`);
    expect(prompt.mock.calls[0]?.[0]).toContain("Harness and route: codex / codex-direct");
    expect(prompt.mock.calls[0]?.[0]).toContain("Profile ceiling: trusted-full-access");
    expect(prompt.mock.calls[0]?.[0]).toContain("Allowed tools: workspace.read, workspace.write");
    expect(prompt.mock.calls[0]?.[0]).toContain("Effect ceiling: mutate");
    expect(prompt.mock.calls[0]?.[0]).toContain("consequences=local-state");
    expect(prompt.mock.calls[0]?.[0]).toContain("idempotency=idempotent");
    expect(prompt.mock.calls[0]?.[0]).toContain(`Policy digest: ${binding.policyDigest}`);
    expect(prompt.mock.calls[0]?.[0]).toContain(`Enforcement revision: ${binding.enforcementRevision}`);
    expect(prompt.mock.calls[0]?.[0]).toContain(`Expires at: ${binding.expiresAt}`);

    const denyPrompt = vi.fn().mockResolvedValue(false);
    const denyingPort = createCliAttendedTrustedExecutionLeaseApprovalPort({
      outputMode: "human",
      inputInteractive: true,
      outputInteractive: true,
      prompt: denyPrompt,
    });
    await expect(denyingPort?.approve(binding)).resolves.toEqual({ status: "denied" });

    for (const unavailable of [
      { outputMode: "json" as const, inputInteractive: true, outputInteractive: true },
      { outputMode: "answer" as const, inputInteractive: true, outputInteractive: true },
      { outputMode: "human" as const, inputInteractive: false, outputInteractive: true },
      { outputMode: "human" as const, inputInteractive: true, outputInteractive: false },
    ]) {
      expect(createCliAttendedTrustedExecutionLeaseApprovalPort({ ...unavailable, prompt })).toBeUndefined();
    }
  });

  it("exposes runtime approval only on an interactive human CLI surface", async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    const handler = createCliRuntimeApprovalHandler({
      outputMode: "human",
      inputInteractive: true,
      outputInteractive: true,
      prompt,
    });

    await expect(handler?.("Allow managed orchestration")).resolves.toEqual({
      approved: true,
      reason: "Approved by the interactive CLI operator.",
    });
    expect(prompt).toHaveBeenCalledWith("Allow managed orchestration");
    expect(
      createCliRuntimeApprovalHandler({
        outputMode: "json",
        inputInteractive: true,
        outputInteractive: true,
        prompt,
      }),
    ).toBeUndefined();
    expect(
      createCliRuntimeApprovalHandler({
        outputMode: "human",
        inputInteractive: false,
        outputInteractive: true,
        prompt,
      }),
    ).toBeUndefined();
  });

  beforeEach(() => {
    bootstrapProjectAdoption(resolveProjectStateBinding(REPO_ROOT));
    vi.clearAllMocks();
    runWiringMocks.cleanupHandlers.length = 0;
    loadKilnConfigMock.mockResolvedValue(APP_KILN_YAML);
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
    runWiringMocks.cleanupWorktree.mockResolvedValue(undefined);
    runWiringMocks.cleanupRegistryRunAll.mockImplementation(runWiringMocks.drainCleanupHandlers);
    runWiringMocks.createManagedAgentInvocationResourceProvider.mockReturnValue({
      id: "managed-agent-resource-provider",
    });
    runWiringMocks.runManagedAgentOrchestrationLifecycle.mockImplementation(
      async (input: ManagedAgentOrchestrationLifecycleInput) => {
        const orchestrationId = input.orchestrationRequest.orchestrationId;
        return {
          orchestrationResult: {
            orchestrationId,
            mode: "fan-out",
            status: "completed",
            childResults: [
              {
                childId: `${orchestrationId}:child:1`,
                ordinal: 1,
                lifecycleState: "completed",
                success: true,
                resourceUris: [],
                diagnosticUris: [],
              },
              {
                childId: `${orchestrationId}:child:2`,
                ordinal: 2,
                lifecycleState: "completed",
                success: true,
                resourceUris: [],
                diagnosticUris: [],
              },
            ],
            completedAt: "2026-05-22T00:00:00.000Z",
          },
          childRecords: [
            {
              childId: `${orchestrationId}:child:1`,
              ordinal: 1,
              invocationId: `${orchestrationId}:child:1`,
              record: { lifecycleState: "completed" },
            },
            {
              childId: `${orchestrationId}:child:2`,
              ordinal: 2,
              invocationId: `${orchestrationId}:child:2`,
              record: { lifecycleState: "completed" },
            },
          ],
        };
      },
    );
    runWiringMocks.runVerification.mockResolvedValue({ passed: true, checks: [] });
    runWiringMocks.transcriptInit.mockResolvedValue(undefined);
    runWiringMocks.transcriptFinalize.mockResolvedValue(undefined);
    runWiringMocks.authorityAdmissions.clear();
    runWiringMocks.authorityAdmissionEvidenceStore = undefined;
    runWiringMocks.preparedWorkingDirectory = undefined;
    runWiringMocks.qualityGates = [];
    operatorCompositionMocks.state.dispatchError = undefined;
    configureExecutionRoute();
  });

  afterEach(async () => {
    await runWiringMocks.drainCleanupHandlers();
    vi.restoreAllMocks();
  });

  it("builds model-facing governed builtin tool options and passes them into sessionConfig", async () => {
    await runCommand(APP_CONFIG, "ship it", {});

    expect(runWiringMocks.loadConfiguredWebToolSurfaceOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        createRegistry: APP_CONFIG.createRegistry,
        kilnYaml: expect.objectContaining({ version: "1" }),
      }),
      REPO_ROOT,
      {
        memoryAuthority: {
          modelFacingSession: true,
          permissionPolicy: {
            approval: "on-request",
            sandbox: "read-only",
            safeDefaults: true,
            auditLog: true,
          },
          permissionAgent: undefined,
          caller: { kind: "operator_surface", id: "run" },
        },
      },
    );
    expect(runWiringMocks.createSessionBuiltinToolOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "surface-options",
        toolProjection: expect.objectContaining({
          mode: "deferred",
          alwaysOnTools: expect.arrayContaining([
            "read",
            "write",
            "work_item.update",
            "goal.evidence.record",
            "goal.complete",
          ]),
        }),
        workItemStore: expect.any(Object),
        additionalTools: expect.arrayContaining([
          expect.objectContaining({ name: "kiln_config.read" }),
          expect.objectContaining({ name: "kiln_config.propose_change" }),
          expect.objectContaining({ name: "kiln_config.apply_change" }),
        ]),
      }),
    );
    expect(runWiringMocks.capturedSessionConfigs).toHaveLength(1);
    expect(runWiringMocks.capturedSessionConfigs[0]).toMatchObject({
      builtinToolOptions: { id: "session-builtin-tool-options" },
    });
  });

  it("passes resolved YAML permissions into a normal run session", async () => {
    const permissions = {
      approval: "on-request" as const,
      sandbox: "read-only" as const,
      safeDefaults: true,
      tools: [{ tool: "read", action: "allow" as const, reason: "Configured for this project." }],
    };
    loadKilnConfigMock.mockResolvedValueOnce({
      ...APP_KILN_YAML,
      permissions,
    });

    await runCommand(APP_CONFIG, "use configured permissions", {});

    expect(runWiringMocks.capturedSessionConfigs[0]).toMatchObject({
      permissionPolicy: permissions,
    });
  });

  it("wires managed invocation resources into model-facing builtin tool options", async () => {
    const managedInvocation = parallelManagedInvocation();

    await runCommand(
      {
        ...APP_CONFIG,
        managedInvocation: managedInvocation as never,
      },
      "ship it",
      {},
    );

    expect(runWiringMocks.createManagedAgentInvocationResourceProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        service: managedInvocation.invocationService,
      }),
    );
    expect(runWiringMocks.createManagedAgentInvocationResourceProvider.mock.calls[0]?.[0]).toHaveProperty(
      "artifactStore",
    );
    expect(runWiringMocks.createSessionBuiltinToolOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceProviders: expect.arrayContaining([{ id: "managed-agent-resource-provider" }]),
      }),
    );
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

  it("keeps routing budget admission out of parallel fan-out and preserves session lineage", async () => {
    readGlobalConfigMock.mockReturnValue({
      ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.5", "codex-route"),
      sessionTurnBudget: { tokenLimit: 100, action: "stop" },
    });

    await runCommand(
      {
        ...APP_CONFIG,
        managedInvocation: parallelManagedInvocation() as never,
      },
      "parallel budget",
      { workers: 2 },
      { effectiveTurnAuthority: ADMITTED_PARENT_TURN_AUTHORITY },
    );

    const input = runWiringMocks.runManagedAgentOrchestrationLifecycle.mock.calls[0]?.[0] as
      | ManagedAgentOrchestrationLifecycleInput
      | undefined;
    if (!input) {
      throw new Error("Expected parallel fan-out lifecycle input.");
    }

    expect(input).not.toHaveProperty("sessionTurnBudget");
    expect(input.callerIdentity).toEqual({
      kind: "kiln-runtime",
      surface: "run",
      attachmentId: "kiln-runtime:run",
      parentEffectiveRequestedAuthority: "destructive",
    });
    expect(input.orchestrationRequest.parentSessionId).not.toBe("cli-run");
    expect(input.orchestrationRequest.orchestrationId).toContain(input.orchestrationRequest.parentSessionId);
  });

  it("projects runtime-owned session token observation into normal run sessions", async () => {
    readGlobalConfigMock.mockReturnValue({
      ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.5", "codex-route"),
      sessionTurnBudget: { tokenLimit: 100, action: "stop" },
    });

    await runCommand(APP_CONFIG, "budgeted run", {});

    const sessionConfig = runWiringMocks.capturedSessionConfigs[0] as {
      readonly sessionTurnBudget?: {
        admit(sessionId: string): Promise<{ readonly status: string }>;
      };
    };
    expect(sessionConfig.sessionTurnBudget).toBeDefined();
    await expect(sessionConfig.sessionTurnBudget?.admit("next-session")).resolves.toMatchObject({
      status: "admitted",
    });
  });

  it("does not require MCP when a configured execution target is selected", async () => {
    await runCommand(APP_CONFIG, "use configured route", {});

    expect(runWiringMocks.capturedRunSessionInputs).toHaveLength(1);
    expect(runWiringMocks.capturedRunSessionInputs[0]).toMatchObject({
      requirements: {
        preferredProvider: "codex-oauth",
        requiresMcp: false,
      },
    });
  });

  it("uses the prepared working directory for isolated session execution", async () => {
    runWiringMocks.preparedWorkingDirectory = "C:/private/kiln/worktrees/session-1";

    await runCommand(APP_CONFIG, "use isolated cwd", { isolate: true });

    expect(runWiringMocks.capturedSessionConfigs[0]).toMatchObject({
      cwd: "C:/private/kiln/worktrees/session-1",
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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: true,
          error: null,
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await runCommand(APP_CONFIG, "exact output", { output: "answer" });

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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: true,
          error: null,
        },
      ],
      transcript: [],
      exactArtifacts: ["File path touched: README.md"],
      submittedPlan: undefined,
    });

    await runCommand(APP_CONFIG, "structured output", { output: "json" });

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
        attempts: [
          {
            providerId: "codex",
            model: "gpt-5.5",
            succeeded: true,
            error: null,
          },
        ],
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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          succeeded: false,
          error: "Provider failed",
        },
      ],
      transcript: [],
      exactArtifacts: ["Provider error: Provider failed"],
      submittedPlan: undefined,
    });

    await expect(
      runCommand(APP_CONFIG, "structured failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "partial answer",
      telemetry: {
        task: "structured failure",
        sessionSucceeded: false,
      },
      diagnostics: {
        lastError: "Provider failed",
        attempts: [
          {
            providerId: "codex",
            succeeded: false,
            error: "Provider failed",
          },
        ],
      },
    });
  });

  it("writes structured failure diagnostics for early route admission failure in json output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    configureExecutionRoute("openrouter", "qwen/qwen3-coder:free", "openrouter-qwen");
    operatorCompositionMocks.state.dispatchError = new Error("Execution target 'openrouter-qwen' is unavailable.");

    await expect(
      runCommand(APP_CONFIG, "early route failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

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
        lastError: "Execution target 'openrouter-qwen' is unavailable.",
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
    configureExecutionRoute("openrouter", "qwen/qwen3-coder:free", "openrouter-qwen");
    operatorCompositionMocks.state.dispatchError = new Error("Execution target 'openrouter-qwen' is unavailable.");
    runWiringMocks.cleanupWorktree.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(
      runCommand(APP_CONFIG, "early route cleanup failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      telemetry: {
        task: "early route cleanup failure",
        sessionSucceeded: false,
      },
      diagnostics: {
        lastError: "Execution target 'openrouter-qwen' is unavailable.; Failed to cleanup worktree. cleanup failed",
      },
    });
  });

  it("writes structured failure diagnostics when runSession throws in json output mode", async () => {
    const stdout = captureStdout();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    runWiringMocks.runSession.mockRejectedValueOnce(new Error("session exploded"));

    await expect(
      runCommand(APP_CONFIG, "thrown session failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

    const parsed = JSON.parse(stdout.text()) as Record<string, any>;
    expect(parsed).toMatchObject({
      answer: "",
      telemetry: {
        task: "thrown session failure",
        domain: "Kiln",
        sessionSucceeded: false,
        provider: "codex-oauth",
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

    await expect(
      runCommand(APP_CONFIG, "thrown cleanup failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

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
      providersUsed: ["openrouter"],
      attempts: [
        {
          providerId: "openrouter",
          model: "qwen/qwen3-coder:free",
          succeeded: true,
          error: null,
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });
    configureExecutionRoute("openrouter", "qwen/qwen3-coder:free", "openrouter-qwen");

    await runCommand(APP_CONFIG, "route health persistence", { output: "json" });

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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: false,
          error: "Provider failed",
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(
      runCommand(APP_CONFIG, "provider cleanup failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: true,
          error: null,
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(
      runCommand(APP_CONFIG, "cleanup failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: true,
          error: null,
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    runWiringMocks.qualityGates = [{ name: "typecheck", command: "bun run typecheck", required: true }];
    await expect(
      runCommand(APP_CONFIG, "verification throw cleanup failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: true,
          error: null,
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    runWiringMocks.qualityGates = [{ name: "typecheck", command: "bun run typecheck", required: true }];
    await expect(
      runCommand(APP_CONFIG, "verification failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: true,
          error: null,
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(
      runCommand(APP_CONFIG, "report cleanup failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          model: "gpt-5.5",
          succeeded: true,
          error: null,
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    runWiringMocks.qualityGates = [{ name: "typecheck", command: "bun run typecheck", required: true }];
    await expect(
      runCommand(APP_CONFIG, "verification cleanup failure", { output: "json" }, { exitOnFailure: false }),
    ).rejects.toMatchObject({ code: 1 });

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
    expect(
      resolveRunProviderModelAdmission({
        provider: "openrouter",
        model: "qwen/qwen3-coder-480b-a35b-instruct:free",
        discovery: {
          openrouter: {
            models: ["qwen/qwen3-coder:free"],
            status: "available",
            reason: "OpenRouter models discovered.",
          },
        },
      }),
    ).toEqual({
      ok: false,
      error: "Provider 'openrouter' does not advertise model 'qwen/qwen3-coder-480b-a35b-instruct:free'",
    });
  });

  it("admits direct provider execution only for discovered model ids", () => {
    expect(
      resolveRunProviderModelAdmission({
        provider: "openrouter",
        model: "qwen/qwen3-coder:free",
        discovery: {
          openrouter: {
            models: ["qwen/qwen3-coder:free"],
            status: "available",
            reason: "OpenRouter models discovered.",
          },
        },
      }),
    ).toEqual({ ok: true });
  });

  it("fails wrapper admission when discovery does not advertise an explicit model", () => {
    expect(
      resolveRunProviderModelAdmission({
        provider: "codex",
        model: "gpt-5.5",
        discovery: {
          codex: {
            models: ["gpt-5.4-mini"],
            status: "available",
            reason: "Codex models discovered.",
          },
        },
      }),
    ).toEqual({
      ok: false,
      error: "Provider 'codex' does not advertise model 'gpt-5.5'",
    });
  });

  it("allows wrapper admission without an explicit model so the native harness default can run", () => {
    expect(
      resolveRunProviderModelAdmission({
        provider: "codex",
        model: undefined,
        discovery: {},
      }),
    ).toEqual({ ok: true });
  });

  it("admits wrapper execution for discovered explicit model ids", () => {
    expect(
      resolveRunProviderModelAdmission({
        provider: "codex",
        model: "gpt-5.4-mini",
        discovery: {
          codex: {
            models: ["gpt-5.4-mini"],
            status: "available",
            reason: "Codex models discovered.",
          },
        },
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an unknown explicit execution target before running a session", async () => {
    // A misconfigured target must reach the caller as a failed run in the
    // requested output mode, not as an unhandled throw: a consumer parsing the
    // run output cannot distinguish a stack trace from a session that failed.
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const written: string[] = [];
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as never);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as never);
    const logSpy = vi.spyOn(console, "error").mockImplementation(((...args: unknown[]) => {
      written.push(args.map(String).join(" "));
    }) as never);

    try {
      await expect(
        runCommand(APP_CONFIG, "ship it", {
          target: "missing-route",
        }),
      ).rejects.toThrow("process.exit");

      expect(exit).toHaveBeenCalledWith(1);
      expect(written.join("")).toContain("Execution target 'missing-route' is not configured.");
      expect(runWiringMocks.runSession).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      outSpy.mockRestore();
      exit.mockRestore();
    }
  });

  it("binds the explicit execution target into canonical dispatch", async () => {
    configureExecutionRoute("openrouter", "qwen/qwen3-coder:free", "openrouter-qwen");

    await runCommand(APP_CONFIG, "ship it", {
      target: "openrouter-qwen",
    });

    expect(runWiringMocks.capturedRunSessionInputs[0]).toMatchObject({
      routeCandidates: [
        expect.objectContaining({
          provider: "openrouter",
          model: "qwen/qwen3-coder:free",
          credentialBinding: expect.objectContaining({ routeId: "openrouter-qwen" }),
        }),
      ],
    });
  });

  it("records canonical direct route success as a route health outcome", async () => {
    configureExecutionRoute("openrouter", "qwen/qwen3-coder:free", "openrouter-qwen");
    await runCommand(APP_CONFIG, "ship it", {});

    expect(runWiringMocks.evaluateRouteHealth).not.toHaveBeenCalled();
    expect(runWiringMocks.recordRouteOutcome).toHaveBeenCalledWith({
      providerId: "openrouter",
      modelId: "qwen/qwen3-coder:free",
      outcome: { type: "ok" },
    });
  });

  it("binds only the selected execution target without client-side fallback", async () => {
    configureExecutionRoute("openrouter", "openrouter/free", "openrouter-free");
    await runCommand(APP_CONFIG, "ship it", { target: "openrouter-free" });

    expect(runWiringMocks.capturedRunSessionInputs[0]).toMatchObject({
      routeCandidates: [
        expect.objectContaining({
          provider: "openrouter",
          model: "openrouter/free",
          credentialBinding: expect.objectContaining({ routeId: "openrouter-free" }),
        }),
      ],
    });
  });

  it("cleans up an isolated worktree before exiting when configured routes are unavailable", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    runWiringMocks.preparedWorkingDirectory = "C:/private/kiln/worktrees/session-unavailable";
    configureExecutionRoute("openrouter", "qwen/qwen3-coder:free", "openrouter-qwen");
    operatorCompositionMocks.state.dispatchError = new Error("Execution target 'openrouter-qwen' is unavailable.");

    await expect(
      runCommand(APP_CONFIG, "ship it", {
        isolate: true,
      }),
    ).rejects.toThrow("process.exit");

    expect(runWiringMocks.runSession).not.toHaveBeenCalled();
    expect(runWiringMocks.cleanupWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: "C:/private/kiln/worktrees/session-unavailable",
      }),
    );
    exit.mockRestore();
  });

  it("records retryable direct provider failures as route health outcomes", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    runWiringMocks.runSession.mockResolvedValueOnce({
      finalCostUsd: 0,
      sessionSucceeded: false,
      lastError:
        "All credentials in the pool are exhausted: last outcome rate-limited; last error openrouter API error 429",
      accumulatedText: "",
      toolCallCount: 0,
      turnDepth: 0,
      successfulProviderId: undefined,
      successfulModelId: undefined,
      providersUsed: ["openrouter"],
      attempts: [
        {
          providerId: "openrouter",
          model: "qwen/qwen3-coder:free",
          succeeded: false,
          error:
            "All credentials in the pool are exhausted: last outcome rate-limited; last error openrouter API error 429",
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    configureExecutionRoute("openrouter", "qwen/qwen3-coder:free", "openrouter-qwen");
    await expect(runCommand(APP_CONFIG, "ship it", {})).rejects.toThrow("process.exit");

    expect(runWiringMocks.recordRouteOutcome).toHaveBeenCalledWith({
      providerId: "openrouter",
      modelId: "qwen/qwen3-coder:free",
      outcome: { type: "rate-limited" },
      errorMessage:
        "All credentials in the pool are exhausted: last outcome rate-limited; last error openrouter API error 429",
    });
    exit.mockRestore();
  });

  it("removes process signal handlers after a completed run", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    await runCommand(APP_CONFIG, "cleanup lifecycle", {});

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
        providersUsed: ["codex"],
        attempts: [
          {
            providerId: "codex",
            succeeded: false,
            error: "Aborted during execution",
          },
        ],
        transcript: [],
        exactArtifacts: [],
        submittedPlan: undefined,
      };
    });

    const run = runCommand(APP_CONFIG, "interrupt active run", {}, { exitOnFailure: false });
    const expectedFailure = expect(run).rejects.toThrow("Kiln run exited with code 1");

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

    await expectedFailure;

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

    const run = runCommand(
      {
        ...APP_CONFIG,
        managedInvocation: parallelManagedInvocation() as never,
      },
      "parallel cleanup",
      { workers: 2 },
      {
        exitOnFailure: false,
        effectiveTurnAuthority: ADMITTED_PARENT_TURN_AUTHORITY,
      },
    );

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

    const run = runCommand(
      {
        ...APP_CONFIG,
        managedInvocation: parallelManagedInvocation() as never,
      },
      "parallel cleanup",
      { workers: 2 },
      {
        exitOnFailure: false,
        effectiveTurnAuthority: ADMITTED_PARENT_TURN_AUTHORITY,
      },
    );

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
    runWiringMocks.preparedWorkingDirectory = "C:/private/kiln/worktrees/session-verify";
    runWiringMocks.qualityGates = [{ name: "typecheck", command: "bun run typecheck", required: true }];

    await runCommand(APP_CONFIG, "verify isolated cwd", { isolate: true });

    expect(runWiringMocks.runVerification).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "typecheck" })]),
      "C:/private/kiln/worktrees/session-verify",
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
      providersUsed: ["codex"],
      attempts: [
        {
          providerId: "codex",
          succeeded: false,
          error: "Provider failed",
        },
      ],
      transcript: [],
      exactArtifacts: [],
      submittedPlan: undefined,
    });

    await expect(runCommand(APP_CONFIG, "ship it", { isolate: true })).rejects.toThrow("process.exit");

    expect(runWiringMocks.cleanupWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: REPO_ROOT,
      }),
    );
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
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function parallelManagedInvocation() {
  return {
    requestedBy: "operator",
    requestSource: "cli:run-workers",
    invocationService: {},
    routes: [
      {
        routeId: "codex-isolated",
        providerId: "codex",
        model: "gpt-5.5",
        capability: {
          identity: { routeId: "codex-isolated", revision: "test-v1" },
          target: { providerId: "codex", modelId: "gpt-5.5" },
          adapter: { kind: "cli-harness", capabilityId: "codex-cli", capabilityVersion: "1" },
          authorityCeiling: "destructive",
          toolNames: ["read", "grep", "apply-patch"],
          supportsRecursion: true,
          supportsAttachments: false,
          supportsWrite: true,
          proof: {
            status: "configured",
            source: "run-builtin-tools-test",
            provenProfiles: ["foundation-apply-approved-writes"],
          },
          capacity: { kind: "accountless" },
          settlement: { kind: "not-required" },
        },
        createAdapter: async () => ({
          descriptor: {
            lifecycle: {
              exposesStart: true,
              exposesTerminal: true,
            },
          },
        }),
        profiles: [
          {
            authorityProfileId: "authority:codex-isolated:foundation-apply-approved-writes",
            admissionProfile: "foundation-apply-approved-writes",
            workingDirectory: {
              mode: "isolated-worktree",
            },
            workingDirectoryLease: {
              mode: "git-worktree",
            },
          },
        ],
      },
    ],
  };
}

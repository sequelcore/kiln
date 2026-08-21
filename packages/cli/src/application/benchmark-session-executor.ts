import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  BenchmarkItemExecutor,
  DeliberationResolution,
  ModelDeliberationCapabilities,
} from "@kilnai/core";
import type { BenchmarkItemExecutionContext } from "@kilnai/core/eval";
import {
  GoalRunStore,
  SandboxPolicy,
  WorkItemStore,
  createSessionBuiltinToolOptions,
  defineDeliberationLevelId,
  isFormalVerificationToolResultMetadata,
  mapProviderModelRouteErrorToOutcome,
} from "@kilnai/core";
import {
  getProjectContextArtifactCache,
  ProviderModelRouteHealthStore,
  discoverClaudeCliModelDiscovery,
  discoverCodexCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
  withManagedAgentInvocationResourceProvider,
  withManagedInvocationService,
} from "@kilnai/runtime";
import type { KilnAppConfig } from "../config.js";
import type { GuiModelDeliberationCapabilities } from "@kilnai/gateway-contracts";
import { defaultBuildSystemPrompt } from "../config.js";
import { withGlobalIdentityContext } from "../config/operator-identity-context.js";
import type { SessionMode } from "../wrapper/index.js";
import { SessionManager } from "../wrapper/session-manager.js";
import { CleanupRegistry } from "../wrapper/cleanup-registry.js";
import {
  createDefaultRegistry,
  isDirectApiProvider,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { resolveExecutionRouteCandidates } from "../config/execution-route-resolver.js";
import { readGlobalConfig, readGlobalExecutionCatalog } from "../config/global-config.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { withContextCandidates } from "./agent-skill-context.js";
import { resolveInstructionProfileContextCandidates } from "./instruction-profile-context.js";
import { withWorkGovernanceContext } from "./work-governance-context.js";
import {
  loadConfiguredBuiltinToolSurfaceOptions,
  observeFormalVerificationCapability,
  withProgressiveRuntimeToolProjection,
} from "../config/builtin-tool-surface-config.js";
import { resolveBenchmarkPermissionPolicy } from "../config/model-facing-permission-policy.js";
import { createKilnConfigTools } from "./config-tools.js";
import { createProjectBoundedWorkAuthority } from "./bounded-work-authority-composition.js";
import {
  createKilnRuntimeManagedInvocationAttachment,
} from "./managed-invocation-attachment.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import { discoverManagedAgentProviderModels } from "../config/managed-agent-provider-models.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import {
  closeManagedAccountRuntimeComposition,
  createManagedAccountRuntimeComposition,
  resolveManagedInvocationToolOptions,
} from "../config/managed-agent-routes.js";
import { createOperatorSurfaceEconomicAuthority } from "./operator-surface-economic-authority.js";
import { SessionHooks } from "./session-hooks.js";
import { runSession } from "./run-session.js";
import { createCanonicalRunSessionDispatcher } from "./canonical-run-session-dispatcher.js";
import { createNonHumanRunOutputSink } from "./run-output.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import { resolveConfiguredDeliberation } from "../config/deliberation-policy.js";
import {
  hashBenchmarkWorkspace,
  resolveBenchmarkWorkspace,
  verifyBenchmarkWorkspaceUnchanged,
} from "./benchmark-workspace.js";
import {
  createBenchmarkWriteWorkspaceLease,
  type BenchmarkWriteWorkspaceChanges,
} from "./benchmark-write-workspace.js";
import { createBenchmarkAuthorityWorkspaceLease } from "./benchmark-authority-workspace.js";
import {
  verifyBackendBenchmarkLease,
  type BackendBenchmarkVerification,
} from "./benchmark-backend-verifier.js";
import {
  verifyFrontendBenchmarkLease,
  type FrontendBenchmarkVerification,
} from "./benchmark-frontend-verifier.js";

export const BENCHMARK_EXECUTION_ENVELOPE = { toolRounds: { max: 8 } } as const;
const WRITE_BENCHMARK_PROFILE_IDS = new Set([
  "kiln-model-roster-backend-write",
  "kiln-model-roster-frontend-render",
  "kiln-formal-verification-pilot",
]);
const WRITE_BENCHMARK_TOOLS = ["read", "read_many", "grep", "glob", "tree", "stat", "write", "edit", "patch"] as const;

export interface BenchmarkSessionExecutorFlags {
  readonly targetId?: string;
  readonly accountOverrideIds?: readonly string[];
  /** Stable pair order supplied by the dataset owner for balanced account assignment. */
  readonly benchmarkPairIds?: readonly string[];
  readonly skipGitRepoCheck?: boolean;
  readonly deliberationLevel?: string;
}

export interface BenchmarkSessionExecutorOptions {
  readonly appConfig: KilnAppConfig;
  readonly flags?: BenchmarkSessionExecutorFlags;
}

export function createBenchmarkSessionExecutor(options: BenchmarkSessionExecutorOptions): BenchmarkItemExecutor {
  let deliberationResolutionPromise: Promise<DeliberationResolution> | undefined;
  return async (input, context) => {
    const startedAt = Date.now();
    const accountOverrideCandidates = resolveBenchmarkAccountOverrideCandidates(options.flags, context);
    const scheduledAccountOverrideId = accountOverrideCandidates[0];
    const formalVerificationArm = resolveFormalVerificationPilotArm(context);
    const repositoryRoot = resolveProjectRoot().rootPath;
    const benchmarkWorkspace = resolveBenchmarkWorkspace(
      repositoryRoot,
      context.item.metadata?.workspaceFixture,
    );
    const writeMode = WRITE_BENCHMARK_PROFILE_IDS.has(context.profile.id);
    const writeLease = writeMode
      ? createBenchmarkWriteWorkspaceLease(repositoryRoot, context.item.metadata?.workspaceFixture)
      : undefined;
    const authorityLease = benchmarkWorkspace.kind === "synthetic-fixture"
      ? createBenchmarkAuthorityWorkspaceLease()
      : undefined;
    const cwd = writeLease?.rootPath ?? benchmarkWorkspace.rootPath;
    const authorityStateRoot = authorityLease?.rootPath ?? repositoryRoot;
    let closeAuthorityState = () => authorityLease?.cleanup();
    const workspaceFixtureHash = writeLease?.canonicalHash ?? (benchmarkWorkspace.kind === "synthetic-fixture"
      ? hashBenchmarkWorkspace(benchmarkWorkspace)
      : undefined);
    let workspaceChanges: BenchmarkWriteWorkspaceChanges | undefined;
    let observedVerification: BackendBenchmarkVerification | FrontendBenchmarkVerification | undefined;
    let expectedRouteId: string | undefined;
    try {
    const sessionInput = benchmarkWorkspace.kind === "synthetic-fixture"
      ? [
          "Benchmark workspace isolation: the current workspace root is already the complete synthetic fixture.",
          "Use paths relative to this workspace root. Do not prepend the fixture declaration or inspect parent directories.",
          "",
          input,
        ].join("\n")
      : input;
    const mode: SessionMode = "cli-wrapper";
    const globalConfig = readGlobalConfig();
    const directExecutionCatalog = readGlobalExecutionCatalog(globalConfig);
    const managedRouteConfig = globalConfig
      ? { ...globalConfig, executionCatalog: directExecutionCatalog ?? undefined }
      : undefined;
    const projectConfig = benchmarkWorkspace.kind === "repository"
      ? readKilnYaml(join(repositoryRoot, ".kiln"))
      : undefined;
    const resolvedKilnConfig = await loadKilnConfig(repositoryRoot);
    const configuredRouteCandidates = resolveExecutionRouteCandidates({
      globalConfig,
      executionCatalog: directExecutionCatalog,
      routeId: options.flags?.targetId,
    });
    expectedRouteId = configuredRouteCandidates[0]?.routeId;
    if (writeMode && configuredRouteCandidates.length === 0) {
      throw new Error("Benchmark write profiles require a configured direct execution target.");
    }
    const preferredProvider = configuredRouteCandidates[0]?.provider;
    const effectiveModel = configuredRouteCandidates[0]?.model;
    const permissionPolicy = resolveBenchmarkPermissionPolicy(
      resolvedKilnConfig?.permissions ?? options.appConfig.kilnYaml?.permissions,
      writeMode ? "write" : "read-only",
    );
    const wrapperConfig = {
      mode,
      provider: preferredProvider,
      permissionPolicy,
    };
    let runtimeAppConfig: KilnAppConfig;
    if (benchmarkWorkspace.kind === "synthetic-fixture") {
      runtimeAppConfig = {
        createRegistry: options.appConfig.createRegistry,
        buildSystemPrompt: defaultBuildSystemPrompt,
        contextCandidates: [],
        kilnYaml: { version: "1" },
      };
    } else {
      let identityAppConfig = withWorkGovernanceContext(
        withGlobalIdentityContext(options.appConfig, globalConfig),
        resolvedKilnConfig?.workGovernance,
      );
      identityAppConfig = withContextCandidates(
        identityAppConfig,
        resolveInstructionProfileContextCandidates({
          projectPath: cwd,
          globalConfig,
          projectConfig,
        }),
      );
      runtimeAppConfig = {
        ...identityAppConfig,
        buildSystemPrompt: identityAppConfig.buildSystemPrompt ?? defaultBuildSystemPrompt,
      };
    }
    const { registry, worktreeManager } = createDefaultRegistry({
      runtimePermissionObservationProjectPath: cwd,
    });
    const benchmarkCleanupRegistry = new CleanupRegistry();
    const operatorEconomicAuthority = benchmarkWorkspace.kind === "repository" && !options.appConfig.managedInvocation
      ? createOperatorSurfaceEconomicAuthority("benchmark", cwd)
      : undefined;
    benchmarkCleanupRegistry.register(async () => operatorEconomicAuthority?.close());
    const contextArtifactCache = await getProjectContextArtifactCache(cwd);
    const manager = new SessionManager(wrapperConfig, runtimeAppConfig, contextArtifactCache, worktreeManager);
    const sessionContext = await manager.prepare(
      sessionInput,
      cwd,
      undefined,
      benchmarkWorkspace.kind === "repository",
      undefined,
      undefined,
      preferredProvider,
      undefined,
    );
    const env: Record<string, string> = {};
    deliberationResolutionPromise ??= resolveBenchmarkDeliberation({
      requestedLevel: options.flags?.deliberationLevel,
      provider: preferredProvider,
      model: effectiveModel,
      env,
    });
    const deliberationResolution = await deliberationResolutionPromise;
    if (deliberationResolution.status === "denied") {
      throw new Error(`Benchmark deliberation request denied (${deliberationResolution.reason}).`);
    }
    const executionDeliberation = deliberationResolution.status === "exact"
      || deliberationResolution.status === "clamped"
      ? deliberationResolution
      : undefined;
    const routeCandidates = executionDeliberation
      ? configuredRouteCandidates.map((candidate) => ({
          ...candidate,
          deliberationResolution: executionDeliberation,
        }))
      : configuredRouteCandidates;
    const configuredBuiltinToolOptions = await loadConfiguredBuiltinToolSurfaceOptions(runtimeAppConfig, cwd, {
      globalConfig,
      memoryAuthority: {
        modelFacingSession: true,
        permissionPolicy,
        caller: { kind: "operator_surface", id: "benchmark" },
      },
    });
    if (context.profile.id === "kiln-formal-verification-pilot" && !configuredBuiltinToolOptions.formalVerify) {
      throw new Error("Formal-verification pilot requires the globally configured formal_verify capability.");
    }
    const boundedWork = createProjectBoundedWorkAuthority(cwd, {
      authorityStateRoot,
      projectIdentityRoot: cwd,
      formalVerificationCapability: observeFormalVerificationCapability(configuredBuiltinToolOptions),
    });
    benchmarkCleanupRegistry.register(async () => boundedWork.close());
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    const baseBuiltinToolOptions = {
      ...configuredBuiltinToolOptions,
      workItemStore,
      goalRunStore,
      additionalTools: [
        ...(configuredBuiltinToolOptions.additionalTools ?? []),
        ...(benchmarkWorkspace.kind === "repository" ? createKilnConfigTools(repositoryRoot) : []),
      ],
    };
    let builtinToolOptions = createSessionBuiltinToolOptions(writeMode
      ? {
          ...baseBuiltinToolOptions,
          toolProjection: {
            mode: "strict" as const,
            alwaysOnTools: formalVerificationArm === "treatment"
              ? [...WRITE_BENCHMARK_TOOLS, "formal_verify"]
              : WRITE_BENCHMARK_TOOLS,
          },
        }
      : withProgressiveRuntimeToolProjection(baseBuiltinToolOptions, "read-only"));
    const benchmarkManagedAccountComposition = benchmarkWorkspace.kind === "synthetic-fixture" && globalConfig
      ? createManagedAccountRuntimeComposition(managedRouteConfig!, cwd, {
          compositionKey: authorityStateRoot,
          databasePath: join(authorityStateRoot, "managed-account-leases.sqlite"),
      })
      : undefined;
    closeAuthorityState = () => {
      if (benchmarkWorkspace.kind === "synthetic-fixture") {
        closeManagedAccountRuntimeComposition(authorityStateRoot);
      }
      authorityLease?.cleanup();
    };
    benchmarkCleanupRegistry.register(async () => closeAuthorityState());
    let managedInvocation = benchmarkWorkspace.kind === "repository"
      ? options.appConfig.managedInvocation
      : undefined;
    if (!managedInvocation) {
      const engineAvailability = resolveEngineAvailabilityMap(globalConfig);
      const managedAgentProviderModels = await discoverManagedAgentProviderModels();
      managedInvocation = (await resolveManagedInvocationToolOptions(managedRouteConfig, {
        cwd,
        registry,
        surface: "run",
        maxParallelChildren: benchmarkWorkspace.kind === "repository"
          ? resolvedKilnConfig?.parallelWorkers ?? 1
          : 1,
        isProviderAvailable: (providerId) => engineAvailability.get(providerId),
        providerModelEligibility: managedAgentProviderModels,
        directAdapterFactory: createManagedDirectProviderAdapterFactory({
          builtinToolOptions: () => builtinToolOptions,
          runtimeEnv: env,
          executionEnvelope: BENCHMARK_EXECUTION_ENVELOPE,
        }),
        builtinToolOptions: () => builtinToolOptions,
        artifactStore: builtinToolOptions.artifactResources?.store,
        managedEconomicAuthority: operatorEconomicAuthority?.authority,
        managedAccountComposition: benchmarkManagedAccountComposition,
      })).managedInvocation;
    }
    const managedInvocationWithService = managedInvocation
      ? withManagedInvocationService(managedInvocation)
      : undefined;
    const managedInvocationAttachment = managedInvocationWithService
      ? createKilnRuntimeManagedInvocationAttachment("benchmark", managedInvocationWithService)
      : undefined;
    const sessionId = randomUUID();
    builtinToolOptions = withManagedAgentInvocationResourceProvider(
      builtinToolOptions,
      managedInvocationWithService ? {
        service: managedInvocationWithService.invocationService,
        parentSessionId: sessionId,
      } : undefined,
    );
    const sessionConfig = {
      task: sessionInput,
      mcpServerEntryPath: benchmarkWorkspace.kind === "repository"
        ? sessionContext.mcpServerEntryPath
        : undefined,
      cwd,
      env,
      permissionPolicy,
      continuationSessionId: sessionContext.continuationSessionId,
      ephemeral: true,
      skipGitRepoCheck: options.flags?.skipGitRepoCheck,
      builtinToolOptions,
      managedInvocation: managedInvocationAttachment,
      executionEnvelope: BENCHMARK_EXECUTION_ENVELOPE,
      requestedAuthority: writeMode ? "destructive" as const : "read_only" as const,
      model: effectiveModel,
      deliberationResolution: executionDeliberation,
      boundedWork: boundedWork?.surface,
    };
    const sessionHooks = new SessionHooks(
      benchmarkWorkspace.kind === "repository" ? options.appConfig.kilnYaml?.hooks : undefined,
      {
      sessionId,
      workingDirectory: sessionContext.workingDirectory,
      },
    );
    const runOutput = createNonHumanRunOutputSink();
    const runInput = {
      governedGoalTools: "forbidden" as const,
      registry,
      cleanupRegistry: benchmarkCleanupRegistry,
      manager,
      context: sessionContext,
      requirements: {
        preferredProvider,
        requiresMcp: preferredProvider === undefined,
      },
      sessionConfig,
      permissionPolicy,
      sessionId,
      env,
      sessionHooks,
      ...(writeLease ? {
        toolSandbox: {
          policy: new SandboxPolicy({
            projectPath: writeLease.rootPath,
            config: {
              fsPolicy: "read-write",
              netPolicy: "none",
              allowedPaths: [writeLease.rootPath],
              deniedPaths: [],
              allowedDomains: [],
            },
          }),
        },
      } : {}),
      output: runOutput,
    };
    let accountFallbackCount = 0;
    const result = await (configuredRouteCandidates.length > 0 && directExecutionCatalog
      ? (async () => {
          const candidates = accountOverrideCandidates.length > 0
            ? accountOverrideCandidates
            : [undefined];
          let lastRoutingError: unknown;
          for (let index = 0; index < candidates.length; index += 1) {
            const accountOverrideId = candidates[index];
            const dispatcher = createCanonicalRunSessionDispatcher({
              catalog: directExecutionCatalog,
              cwd,
              authorityStateRoot,
              executionId: `${sessionId}:account:${index}`,
              routeId: configuredRouteCandidates[0]!.routeId,
              ...(accountOverrideId ? { accountOverrideId } : {}),
              ...(executionDeliberation
                ? { routeEvidence: { deliberationResolution: executionDeliberation } }
                : {}),
            });
            try {
              const dispatched = await dispatcher.dispatch(runInput);
              accountFallbackCount = index;
              return dispatched;
            } catch (error) {
              if (!(error instanceof Error) || error.name !== "OperatorSessionExecutionRoutingError") throw error;
              lastRoutingError = error;
            } finally {
              dispatcher.close();
            }
          }
          throw lastRoutingError;
        })()
      : runSession({
          ...runInput,
          routeCandidates: routeCandidates.length > 0 ? routeCandidates : undefined,
        })).finally(async () => {
      await benchmarkCleanupRegistry.runAll();
      await manager.cleanupWorktree(sessionContext);
      closeBuiltinResources(configuredBuiltinToolOptions);
    });
    if (workspaceFixtureHash) {
      verifyBenchmarkWorkspaceUnchanged(repositoryRoot, benchmarkWorkspace, workspaceFixtureHash);
    }
    workspaceChanges = writeLease?.collectChanges();
    if (
      (context.profile.id === "kiln-model-roster-backend-write"
        || context.profile.id === "kiln-formal-verification-pilot")
      && writeLease
    ) {
      observedVerification = await verifyBackendBenchmarkLease({
        lease: writeLease,
        benchmarkCaseId: context.item.metadata?.benchmarkCaseId,
        ...(context.profile.id === "kiln-formal-verification-pilot"
          ? { allowedChangedPaths: ["src/solution.mjs", "proof/model.dfy"] }
          : {}),
      });
      workspaceChanges = observedVerification.changes;
    }
    if (context.profile.id === "kiln-model-roster-frontend-render" && writeLease) {
      observedVerification = await verifyFrontendBenchmarkLease({
        lease: writeLease,
        benchmarkCaseId: context.item.metadata?.benchmarkCaseId,
      });
      workspaceChanges = observedVerification.changes;
    }
    await recordDirectRouteHealth(configuredRouteCandidates, result.attempts, result.lastError);
    const routeFailures = result.attempts.flatMap((attempt) => {
      if (attempt.succeeded || !attempt.error) return [];
      const routeIdentity = attempt.model
        ? `${attempt.providerId}/${attempt.model}`
        : attempt.providerId;
      return [`${routeIdentity}: ${attempt.error}`];
    });
    const boundExecution = [...result.executionBindings].reverse().find((binding) => binding.status === "bound");
    const executionIdentityMismatch = boundExecution !== undefined
      && ((expectedRouteId !== undefined && boundExecution.routeId !== expectedRouteId)
        || (scheduledAccountOverrideId !== undefined && boundExecution.accountId !== scheduledAccountOverrideId));
    const formalVerificationObservations = result.transcript.flatMap((entry) => {
      if (
        entry.event.type !== "tool_result"
        || entry.event.toolName !== "formal_verify"
        || !isFormalVerificationToolResultMetadata(entry.event.metadata)
      ) return [];
      return [entry.event.metadata];
    });

    return {
      output: result.accumulatedText,
      durationMs: Date.now() - startedAt,
      costUsd: result.finalCostUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      trial: accountFallbackCount > 0
        ? { status: "invalid", reason: "account-fallback" }
        : executionIdentityMismatch
          ? { status: "invalid", reason: "execution-identity-mismatch" }
          : result.successfulProviderId
            ? { status: "valid" }
            : { status: "invalid", reason: "route-unavailable" },
      metadata: {
        activeAgentId: context.profile.id,
        runIndex: context.runIndex,
        repeatIndex: context.repeatIndex,
        providerId: result.successfulProviderId,
        modelId: result.successfulModelId,
        // The route the trial asked for, recorded alongside the route it got.
        // A benchmark comparing conditions assumes the model was held fixed, and
        // a silent fallback would otherwise be indistinguishable from a clean run.
        ...(preferredProvider ? { expectedProviderId: preferredProvider } : {}),
        ...(effectiveModel ? { expectedModelId: effectiveModel } : {}),
        ...(boundExecution ? { accountId: boundExecution.accountId } : {}),
        ...(expectedRouteId ? { expectedRouteId } : {}),
        ...(boundExecution ? { routeId: boundExecution.routeId } : {}),
        ...(scheduledAccountOverrideId ? { expectedAccountId: scheduledAccountOverrideId } : {}),
        ...(scheduledAccountOverrideId ? { scheduledAccountId: scheduledAccountOverrideId } : {}),
        ...(accountFallbackCount > 0 ? { accountFallbackCount } : {}),
        costEvidence: result.finalCostEvidence,
        sessionSucceeded: result.sessionSucceeded,
        providerRequests: result.providerRequests,
        deliberationResolution,
        ...(formalVerificationArm ? {
          formalVerificationExpectedVersion: configuredBuiltinToolOptions.formalVerify!.verifierVersion,
        } : {}),
        toolCalls: result.transcript.flatMap((entry) => {
          if (entry.event.type !== "tool_use") return [];
          return [{
            name: entry.event.toolName,
            ...(entry.event.input && typeof entry.event.input === "object" ? {
              args: entry.event.input as Record<string, unknown>,
            } : {}),
          }];
        }),
        exactArtifacts: result.exactArtifacts,
        ...(result.lastError ? { policyViolations: [result.lastError] } : {}),
        ...(routeFailures.length > 0 ? { routeFailures } : {}),
        benchmarkWorkspaceKind: benchmarkWorkspace.kind,
        benchmarkContextKind: benchmarkWorkspace.kind === "synthetic-fixture" ? "sanitized" : "repository",
        ...(benchmarkWorkspace.fixturePath ? { workspaceFixture: benchmarkWorkspace.fixturePath } : {}),
        ...(workspaceFixtureHash ? { workspaceFixtureHash } : {}),
        ...(workspaceChanges ? { workspaceChanges } : {}),
        ...(observedVerification ? { observedVerification } : {}),
        ...(formalVerificationObservations.length > 0 ? { formalVerificationObservations } : {}),
      },
    };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "OperatorSessionExecutionRoutingError") throw error;
      return {
        output: "",
        durationMs: Date.now() - startedAt,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        trial: { status: "invalid", reason: "account-route-unavailable" },
        metadata: {
          activeAgentId: context.profile.id,
          runIndex: context.runIndex,
          repeatIndex: context.repeatIndex,
          sessionSucceeded: false,
          diagnostics: ["Canonical execution account route was unavailable before provider dispatch."],
          ...(expectedRouteId ? { expectedRouteId } : {}),
          ...(scheduledAccountOverrideId ? { expectedAccountId: scheduledAccountOverrideId } : {}),
          ...(scheduledAccountOverrideId ? { scheduledAccountId: scheduledAccountOverrideId } : {}),
          benchmarkWorkspaceKind: benchmarkWorkspace.kind,
          benchmarkContextKind: benchmarkWorkspace.kind === "synthetic-fixture" ? "sanitized" : "repository",
          ...(benchmarkWorkspace.fixturePath ? { workspaceFixture: benchmarkWorkspace.fixturePath } : {}),
          ...(workspaceFixtureHash ? { workspaceFixtureHash } : {}),
        },
      };
    } finally {
      try {
        writeLease?.verifyCanonicalUnchanged();
      } finally {
        try {
          writeLease?.cleanup();
        } finally {
          closeAuthorityState();
        }
      }
    }
  };
}

function resolveFormalVerificationPilotArm(
  context: BenchmarkItemExecutionContext,
): "control" | "treatment" | undefined {
  if (context.profile.id !== "kiln-formal-verification-pilot") return undefined;
  const arm = context.item.metadata?.formalVerificationArm;
  if (arm !== "control" && arm !== "treatment") {
    throw new Error("Formal-verification pilot items require a control or treatment arm.");
  }
  return arm;
}

function resolveBenchmarkAccountOverrideCandidates(
  flags: BenchmarkSessionExecutorFlags | undefined,
  context: BenchmarkItemExecutionContext,
): readonly string[] {
  const accounts = flags?.accountOverrideIds;
  if (!accounts || accounts.length === 0) return [];
  const pairId = typeof context.item.metadata?.pairId === "string"
    && context.item.metadata.pairId.trim().length > 0
    ? context.item.metadata.pairId.trim()
    : context.item.id;
  const pairIds = flags?.benchmarkPairIds ?? [pairId];
  const pairIndex = Math.max(0, pairIds.indexOf(pairId));
  const preferredIndex = (pairIndex + context.repeatIndex) % accounts.length;
  return accounts.map((_, offset) => accounts[(preferredIndex + offset) % accounts.length]!);
}

async function resolveBenchmarkDeliberation(input: {
  readonly requestedLevel?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly env: Readonly<Record<string, string>>;
}): Promise<DeliberationResolution> {
  const requested = input.requestedLevel;
  if (!requested) return resolveConfiguredDeliberation({});
  const provider = input.provider;
  const model = input.model;
  if (!provider || !model) {
    throw new Error("Benchmark deliberation requires explicit provider and model identity.");
  }
  let capabilities: ModelDeliberationCapabilities | undefined;
  if (isDirectApiProvider(provider as ProviderId)) {
    const discovery = await discoverGuiDirectProviderModelDiscovery(
      { [provider]: true },
      { ...process.env, ...input.env },
    );
    capabilities = materializeDeliberationCapabilities(
      provider,
      model,
      discovery[provider]?.modelCapabilities?.[model]?.deliberation,
    );
  } else if (provider === "codex") {
    capabilities = materializeDeliberationCapabilities(
      provider,
      model,
      (await discoverCodexCliModelDiscovery()).modelCapabilities?.[model]?.deliberation,
    );
  } else if (provider === "claude") {
    capabilities = materializeDeliberationCapabilities(
      provider,
      model,
      (await discoverClaudeCliModelDiscovery()).modelCapabilities?.[model]?.deliberation,
    );
  } else if (provider === "opencode") {
    capabilities = materializeDeliberationCapabilities(
      provider,
      model,
      (await discoverOpencodeCliModelDiscovery()).modelCapabilities?.[model]?.deliberation,
    );
  }
  return resolveConfiguredDeliberation({
    explicitLevel: requested,
    provider,
    model,
    capabilities,
  });
}

function materializeDeliberationCapabilities(
  provider: string,
  model: string,
  capabilities: GuiModelDeliberationCapabilities | undefined,
): ModelDeliberationCapabilities | undefined {
  if (!capabilities) return undefined;
  return {
    provider,
    model,
    levels: capabilities.levels.map((level) => ({
      ...level,
      id: defineDeliberationLevelId(level.id),
    })),
    ...(capabilities.defaultLevel
      ? { defaultLevel: defineDeliberationLevelId(capabilities.defaultLevel) }
      : {}),
    supportsAdaptive: capabilities.supportsAdaptive,
    evidence: capabilities.evidence,
  };
}

function closeBuiltinResources(options: {
  readonly memoryResources?: { readonly repository?: { close?: () => void } };
}): void {
  try {
    options.memoryResources?.repository?.close?.();
  } catch {
    // fail-open cleanup
  }
}

async function recordDirectRouteHealth(
  candidates: readonly { readonly provider: ProviderId; readonly model?: string }[],
  attempts: readonly { readonly providerId: ProviderId; readonly model?: string; readonly succeeded: boolean; readonly error: string | null }[],
  lastError: string | null,
): Promise<void> {
  if (!candidates.some((candidate) => isDirectApiProvider(candidate.provider))) {
    return;
  }
  const routeHealthStore = new ProviderModelRouteHealthStore();
  for (const attempt of attempts) {
    if (!isDirectApiProvider(attempt.providerId) || !attempt.model) {
      continue;
    }
    const errorMessage = attempt.error ?? lastError ?? "Provider ended with unknown error";
    await routeHealthStore.recordOutcome({
      providerId: attempt.providerId,
      modelId: attempt.model,
      outcome: attempt.succeeded
        ? { type: "ok" }
        : mapProviderModelRouteErrorToOutcome(errorMessage),
      ...(attempt.succeeded ? {} : { errorMessage }),
    });
  }
}

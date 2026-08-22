import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
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
import type { OperatorAdoptionRuntimeBinding } from "@kilnai/runtime";
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
import { readGlobalConfig, readGlobalConfigSnapshot, readGlobalExecutionCatalog } from "../config/global-config.js";
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
  type BackendVerifierCasePayload,
  type BackendBenchmarkVerification,
} from "./benchmark-backend-verifier.js";
import {
  verifyFrontendBenchmarkLease,
  type FrontendBenchmarkVerification,
} from "./benchmark-frontend-verifier.js";
import {
  createLemmaCheckTool,
} from "./lemma-check-tool.js";
import type {
  PrivateFormalScreeningCaseFacts,
  PrivateFormalScreeningPackageFacts,
} from "./private-formal-screening-package.js";
import { createPrivateFormalScreeningWorkspaceLease } from "./private-formal-screening-package.js";
import type { ResolvedFormalScreeningConfig } from "../config/formal-screening-config.js";
import { BACKEND_BENCHMARK_CASES } from "./benchmark-backend-cases.js";
import { TranscriptAuthorityAdmissionEvidenceStore } from "./authority-admission-evidence-store.js";
import { TranscriptStore } from "../wrapper/session-store.js";
import { readRuntimeConfigurationRevision } from "./runtime-configuration-revision.js";
import { captureOperatorExecutionCatalogSnapshot } from "./operator-turn-dispatch-composition.js";
import { toCanonicalSessionEventPersistedTranscriptEventDraft } from "./operator-transcript-projection.js";
import { canonicalSessionEventsFromTranscript } from "./runtime-session-rehydration.js";

export const BENCHMARK_EXECUTION_ENVELOPE = { toolRounds: { max: 8 } } as const;
export const FORMAL_SCREENING_BUDGET = Object.freeze({
  toolRounds: 8,
  maxToolCalls: 24,
  maxTotalTokens: 64_000,
  wallClockMs: 600_000,
});
export const FORMAL_SCREENING_EXECUTION_ENVELOPE = {
  toolRounds: { max: FORMAL_SCREENING_BUDGET.toolRounds },
} as const;
const FORMAL_SCREENING_PROTOCOL_HASH = digestCanonicalValue({
  id: "kiln-formal-verification-screening-v2",
  candidatePath: "src/solution.ts",
  allowedChangedPaths: ["src/solution.ts"],
  arms: ["C0", "T"],
  toolRounds: FORMAL_SCREENING_BUDGET.toolRounds,
});
const LEMMA_CHECK_TIMEOUT_MS = 30_000;
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
  /** Durable run-owned root for canonical benchmark transcript and authority evidence. */
  readonly benchmarkEvidenceRoot?: string;
  readonly skipGitRepoCheck?: boolean;
  readonly deliberationLevel?: string;
}

export interface BenchmarkSessionExecutorOptions {
  readonly appConfig: KilnAppConfig;
  readonly flags?: BenchmarkSessionExecutorFlags;
  /** Host-owned private formal screening facts supplied by the command. */
  readonly formalScreeningPackage?: PrivateFormalScreeningPackageFacts;
  /** Host-owned resolved formal screening toolchain supplied by the command. */
  readonly formalScreeningConfig?: ResolvedFormalScreeningConfig;
}

export function createBenchmarkSessionExecutor(options: BenchmarkSessionExecutorOptions): BenchmarkItemExecutor {
  let deliberationResolutionPromise: Promise<DeliberationResolution> | undefined;
  return async (input, context) => {
    const startedAt = Date.now();
    const isFormalScreening = context.profile.id === "kiln-formal-verification-pilot";
    const formalScreeningCase = isFormalScreening
      ? resolveFormalScreeningCase(options, context)
      : undefined;
    const accountOverrideCandidates = resolveBenchmarkAccountOverrideCandidates(options.flags, context);
    const scheduledAccountOverrideId = accountOverrideCandidates[0];
    const formalScreeningArm = formalScreeningCase?.arm;
    const repositoryRoot = resolveProjectRoot().rootPath;
    const privateFormalScreeningLease = formalScreeningCase
      ? createPrivateFormalScreeningWorkspaceLease(formalScreeningCase)
      : undefined;
    const benchmarkWorkspace = privateFormalScreeningLease
      ? {
          kind: "synthetic-fixture" as const,
          rootPath: privateFormalScreeningLease.rootPath,
        }
      : resolveBenchmarkWorkspace(
          repositoryRoot,
          context.item.metadata?.workspaceFixture,
        );
    const writeMode = WRITE_BENCHMARK_PROFILE_IDS.has(context.profile.id);
    const writeLease = privateFormalScreeningLease ?? (writeMode
      ? createBenchmarkWriteWorkspaceLease(repositoryRoot, context.item.metadata?.workspaceFixture)
      : undefined);
    const authorityLease = benchmarkWorkspace.kind === "synthetic-fixture"
      ? createBenchmarkAuthorityWorkspaceLease()
      : undefined;
    const cwd = writeLease?.rootPath ?? benchmarkWorkspace.rootPath;
    const authorityStateRoot = authorityLease?.rootPath ?? repositoryRoot;
    // Benchmark transcript/admission evidence belongs to the run artifact owner,
    // never to a synthetic fixture or a disposable workspace lease. The command
    // supplies this root beside its durable output artifacts; the authority lease
    // remains a fallback for direct executor callers that do not own a run output.
    const benchmarkEvidenceRoot = options.flags?.benchmarkEvidenceRoot
      ? resolve(options.flags.benchmarkEvidenceRoot)
      : authorityStateRoot;
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
    const configuredRouteCandidate = configuredRouteCandidates[0];
    expectedRouteId = configuredRouteCandidate?.routeId;
    if (isFormalScreening) {
      if (!options.flags?.targetId || options.flags.targetId.trim().length === 0) {
        throw new Error("Formal screening requires an explicit targetId.");
      }
      if (configuredRouteCandidates.length !== 1) {
        throw new Error("Formal screening requires exactly one configured route candidate.");
      }
      if (!directExecutionCatalog) {
        throw new Error("Formal screening requires a canonical direct execution catalog.");
      }
    }
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
    const sessionBuiltinToolOptions = isFormalScreening
      ? omitFormalVerificationCapability(configuredBuiltinToolOptions)
      : configuredBuiltinToolOptions;
    const boundedWork = createProjectBoundedWorkAuthority(cwd, {
      authorityStateRoot,
      projectIdentityRoot: cwd,
      ...(isFormalScreening ? {} : {
        formalVerificationCapability: observeFormalVerificationCapability(configuredBuiltinToolOptions),
      }),
    });
    benchmarkCleanupRegistry.register(async () => boundedWork.close());
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    const baseBuiltinToolOptions = {
      ...sessionBuiltinToolOptions,
      workItemStore,
      goalRunStore,
      additionalTools: [
        ...(sessionBuiltinToolOptions.additionalTools ?? []),
        ...(benchmarkWorkspace.kind === "repository" ? createKilnConfigTools(repositoryRoot) : []),
        ...(isFormalScreening && formalScreeningArm === "T" && formalScreeningCase && options.formalScreeningConfig
          ? [createLemmaCheckTool(cwd, {
              requiredFunctionNames: formalScreeningCase.requiredFunctionNames,
              toolchain: options.formalScreeningConfig,
              timeoutMs: LEMMA_CHECK_TIMEOUT_MS,
            })]
          : []),
      ],
    };
    const formalToolProjection = isFormalScreening
      ? [
          ...WRITE_BENCHMARK_TOOLS,
          ...(formalScreeningArm === "T" ? ["lemma_check"] : []),
        ]
      : undefined;
    let builtinToolOptions = createSessionBuiltinToolOptions(writeMode
      ? {
          ...baseBuiltinToolOptions,
          toolProjection: {
            mode: "strict" as const,
            alwaysOnTools: formalToolProjection ?? WRITE_BENCHMARK_TOOLS,
          },
        }
      : withProgressiveRuntimeToolProjection(baseBuiltinToolOptions, "read-only"));
    const benchmarkManagedAccountComposition = benchmarkWorkspace.kind === "synthetic-fixture" && managedRouteConfig
      ? createManagedAccountRuntimeComposition(managedRouteConfig, cwd, {
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
          executionEnvelope: isFormalScreening
            ? FORMAL_SCREENING_EXECUTION_ENVELOPE
            : BENCHMARK_EXECUTION_ENVELOPE,
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
    const transcriptStore = new TranscriptStore(benchmarkEvidenceRoot);
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
      executionEnvelope: isFormalScreening
        ? FORMAL_SCREENING_EXECUTION_ENVELOPE
        : BENCHMARK_EXECUTION_ENVELOPE,
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
    const operatorAdoption: OperatorAdoptionRuntimeBinding = {
      persist: async (event) => {
        await transcriptStore.appendManyNext(
          event.kilnSessionId,
          [toCanonicalSessionEventPersistedTranscriptEventDraft(event)],
        );
      },
      replayCanonicalSessionEvents: async (canonicalSessionId) => canonicalSessionEventsFromTranscript(
        await transcriptStore.readTranscript(canonicalSessionId),
        canonicalSessionId,
      ),
    };
    const formalAbortController = isFormalScreening ? new AbortController() : undefined;
    let formalWallClockTimedOut = false;
    const runInput = {
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
      ...(formalAbortController ? { abortSignal: formalAbortController.signal } : {}),
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
      operatorAdoption,
    };
    let accountFallbackCount = 0;
    const formalWallClockTimer = formalAbortController
      ? setTimeout(() => {
          formalWallClockTimedOut = true;
          formalAbortController.abort();
        }, FORMAL_SCREENING_BUDGET.wallClockMs)
      : undefined;
    const result = await (configuredRouteCandidates.length > 0 && directExecutionCatalog
      ? (async () => {
          if (!configuredRouteCandidate) {
            throw new Error("Canonical benchmark dispatch requires one configured route candidate.");
          }
          const candidates = isFormalScreening
            ? [scheduledAccountOverrideId]
            : accountOverrideCandidates.length > 0
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
              routeId: configuredRouteCandidate.routeId,
              configurationRevision: readRuntimeConfigurationRevision(cwd),
              authorityAdmissionEvidenceStore: new TranscriptAuthorityAdmissionEvidenceStore(transcriptStore),
              captureCatalogSnapshot: () => captureOperatorExecutionCatalogSnapshot({
                projectPath: cwd,
                readConfigSnapshot: readGlobalConfigSnapshot,
                readConfigurationRevision: readRuntimeConfigurationRevision,
                readExecutionCatalog: readGlobalExecutionCatalog,
              }),
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
      if (formalWallClockTimer !== undefined) clearTimeout(formalWallClockTimer);
      await benchmarkCleanupRegistry.runAll();
      await manager.cleanupWorktree(sessionContext);
      closeBuiltinResources(configuredBuiltinToolOptions);
    });
    if (workspaceFixtureHash && !isFormalScreening) {
      verifyBenchmarkWorkspaceUnchanged(repositoryRoot, benchmarkWorkspace, workspaceFixtureHash);
    }
    workspaceChanges = writeLease?.collectChanges();
    if (
      (context.profile.id === "kiln-model-roster-backend-write"
        || context.profile.id === "kiln-formal-verification-pilot")
      && writeLease
    ) {
      const verifierCase = formalScreeningCase
        ? toBackendVerifierCasePayload(formalScreeningCase)
        : toPublicBackendVerifierCasePayload(context.item.metadata?.benchmarkCaseId);
      observedVerification = await verifyBackendBenchmarkLease({
        lease: writeLease,
        benchmarkCase: verifierCase,
        ...(formalScreeningCase
          ? { allowedChangedPaths: formalScreeningCase.allowedChangedPaths }
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
    const formalExecutionIdentityMismatch = isFormalScreening && (
      boundExecution === undefined
      || executionIdentityMismatch
      || result.successfulProviderId !== preferredProvider
      || result.successfulModelId !== effectiveModel
    );
    const lemmaCheckObservations = isFormalScreening
      ? result.transcript.flatMap((entry) => parseLemmaCheckObservation(entry.event))
      : [];
    const finalSourceHash = observedVerification?.changes.changed.find(
      (entry) => entry.path === "src/solution.ts",
    )?.afterHash;
    const passedLemmaCheckObservations = lemmaCheckObservations.filter(
      (observation) => isPassedLemmaCheckObservation(observation, finalSourceHash),
    );
    const treatmentToolchainHashes = new Set(
      passedLemmaCheckObservations.flatMap(readLemmaCheckDependencyBinding),
    );
    const lemmaCheckPassed = isFormalScreening
      && formalScreeningArm === "T"
      && passedLemmaCheckObservations.length > 0
      && treatmentToolchainHashes.size === 1;
    const treatmentToolchainHash = lemmaCheckPassed
      ? [...treatmentToolchainHashes][0]
      : undefined;
    const durationMs = Date.now() - startedAt;
    const budgetExceeded = isFormalScreening && (
      result.toolCallCount > FORMAL_SCREENING_BUDGET.maxToolCalls
      || result.inputTokens + result.outputTokens > FORMAL_SCREENING_BUDGET.maxTotalTokens
      || durationMs > FORMAL_SCREENING_BUDGET.wallClockMs
    );
    const formalInfrastructureValid = !isFormalScreening || (
      !formalWallClockTimedOut
      && !budgetExceeded
      && accountFallbackCount === 0
      && !formalExecutionIdentityMismatch
      && result.successfulProviderId !== undefined
    );
    const formalVerifierHash = formalScreeningCase
      ? computeFormalVerifierHash(formalScreeningCase)
      : undefined;

    return {
      output: result.accumulatedText,
      durationMs,
      costUsd: result.finalCostUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      trial: formalWallClockTimedOut
        ? { status: "invalid", reason: "timeout" }
        : budgetExceeded
          ? { status: "invalid", reason: "budget" }
          : accountFallbackCount > 0
          ? { status: "invalid", reason: "account-fallback" }
          : formalExecutionIdentityMismatch || executionIdentityMismatch
            ? { status: "invalid", reason: "execution-identity-mismatch" }
            : formalInfrastructureValid && result.successfulProviderId
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
        ...(isFormalScreening ? {
          formalScreeningArm,
          lemmaCheckObservations,
          lemmaCheckPassed,
          formalScreeningBudget: FORMAL_SCREENING_BUDGET,
          budgetHash: digestCanonicalValue(FORMAL_SCREENING_BUDGET),
          toolProjectionHash: digestCanonicalValue(
            [...(formalToolProjection ?? WRITE_BENCHMARK_TOOLS)].sort(),
          ),
          hiddenOracleExhaustive: formalScreeningCase?.hiddenOracleExhaustive,
          verifierHash: formalVerifierHash,
          ...(treatmentToolchainHash ? { treatmentToolchainHash } : {}),
          protocolHash: FORMAL_SCREENING_PROTOCOL_HASH,
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
          ...(isFormalScreening ? {
            formalScreeningArm,
            lemmaCheckObservations: [],
            lemmaCheckPassed: false,
            formalScreeningBudget: FORMAL_SCREENING_BUDGET,
            budgetHash: digestCanonicalValue(FORMAL_SCREENING_BUDGET),
            toolProjectionHash: digestCanonicalValue(
              [...WRITE_BENCHMARK_TOOLS, ...(formalScreeningArm === "T" ? ["lemma_check"] : [])].sort(),
            ),
            hiddenOracleExhaustive: formalScreeningCase?.hiddenOracleExhaustive,
            verifierHash: formalScreeningCase ? computeFormalVerifierHash(formalScreeningCase) : undefined,
            protocolHash: FORMAL_SCREENING_PROTOCOL_HASH,
          } : {}),
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

function resolveFormalScreeningCase(
  options: BenchmarkSessionExecutorOptions,
  context: BenchmarkItemExecutionContext,
): PrivateFormalScreeningCaseFacts {
  if (!options.formalScreeningPackage || !options.formalScreeningConfig) {
    throw new Error("Formal screening requires formalScreeningPackage and formalScreeningConfig.");
  }
  const screeningCase = options.formalScreeningPackage.cases.find((candidate) => candidate.id === context.item.id);
  if (!screeningCase) {
    throw new Error(`Formal screening case '${context.item.id}' is not present in the private package.`);
  }
  const arm = context.item.metadata?.formalScreeningArm;
  if (arm !== "C0" && arm !== "T") {
    throw new Error("Formal screening items require an exact C0 or T formalScreeningArm.");
  }
  if (arm !== screeningCase.arm) {
    throw new Error(`Formal screening arm '${arm}' does not match private case arm '${screeningCase.arm}'.`);
  }
  return screeningCase;
}

function resolveBenchmarkAccountOverrideCandidates(
  flags: BenchmarkSessionExecutorFlags | undefined,
  context: BenchmarkItemExecutionContext,
): readonly string[] {
  if (context.profile.id === "kiln-formal-verification-pilot") {
    const accounts = flags?.accountOverrideIds;
    if (!accounts || accounts.length !== 1 || typeof accounts[0] !== "string" || accounts[0].trim().length === 0) {
      throw new Error("Formal screening requires exactly one accountOverrideId and forbids account fallback.");
    }
    return [accounts[0]];
  }
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

function omitFormalVerificationCapability<T extends { readonly formalVerify?: unknown }>(
  options: T,
): Omit<T, "formalVerify"> {
  const { formalVerify: _formalVerify, ...withoutFormalVerification } = options;
  return withoutFormalVerification;
}

function toBackendVerifierCasePayload(screeningCase: PrivateFormalScreeningCaseFacts): BackendVerifierCasePayload {
  return {
    id: screeningCase.id,
    hiddenTestSource: screeningCase.hiddenTestSource,
    hiddenTestDigest: screeningCase.hiddenTestDigest,
    hiddenTestCount: screeningCase.hiddenTestCount,
  };
}

function toPublicBackendVerifierCasePayload(value: unknown): BackendVerifierCasePayload {
  if (typeof value !== "string") {
    throw new Error("Backend benchmark verification requires a benchmark case id.");
  }
  const benchmarkCase = BACKEND_BENCHMARK_CASES[value as keyof typeof BACKEND_BENCHMARK_CASES];
  if (!benchmarkCase || benchmarkCase.id !== value) {
    throw new Error(`Backend benchmark case '${value}' is not admitted.`);
  }
  return {
    id: benchmarkCase.id,
    hiddenTestSource: benchmarkCase.hiddenTestSource,
    hiddenTestDigest: benchmarkCase.testDigest,
    hiddenTestCount: benchmarkCase.testCount,
  };
}

function computeFormalVerifierHash(screeningCase: PrivateFormalScreeningCaseFacts): string {
  return digestCanonicalValue({
    verifierId: "kiln.backend-write.v2",
    verifierVersion: "2",
    benchmarkCaseId: screeningCase.id,
    testDigest: screeningCase.hiddenTestDigest,
    hiddenTestCount: screeningCase.hiddenTestCount,
    allowedChangedPaths: screeningCase.allowedChangedPaths,
  });
}

function parseLemmaCheckObservation(event: {
  readonly type: string;
  readonly toolName?: string;
  readonly output?: unknown;
}): readonly [Record<string, unknown>] | readonly [] {
  if (event.type !== "tool_result" || event.toolName !== "lemma_check" || typeof event.output !== "string") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.output);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || typeof parsed.kind !== "string" || typeof parsed.status !== "string"
    || typeof parsed.stage !== "string" || parsed.semanticEquivalence !== "unresolved"
    || parsed.benchmarkReady !== false || !isRecord(parsed.digests)) {
    return [];
  }
  return [parsed];
}

function isPassedLemmaCheckObservation(
  observation: Record<string, unknown>,
  finalSourceHash: string | undefined,
): boolean {
  const digests = isRecord(observation.digests) ? observation.digests : undefined;
  const verification = isRecord(observation.verification) ? observation.verification : undefined;
  const correctnessChecks = verification && isRecord(verification.correctnessChecks)
    ? verification.correctnessChecks
    : undefined;
  return observation.kind === "pipeline_passed"
    && observation.status === "passed"
    && observation.stage === "complete"
    && observation.policyEligible === true
    && typeof finalSourceHash === "string"
    && digests?.source === finalSourceHash
    && isSha256Digest(digests.generated)
    && isSha256Digest(digests.lemmaScriptExecutable)
    && isSha256Digest(digests.dafnyExecutable)
    && isSha256Digest(digests.dependencyBinding)
    && typeof correctnessChecks?.total === "number"
    && correctnessChecks.total > 0
    && correctnessChecks.passed === correctnessChecks.total
    && correctnessChecks.failed === 0
    && correctnessChecks.inconclusive === 0;
}

function readLemmaCheckDependencyBinding(observation: Record<string, unknown>): readonly string[] {
  const digests = isRecord(observation.digests) ? observation.digests : undefined;
  return isSha256Digest(digests?.dependencyBinding) ? [digests.dependencyBinding] : [];
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digestCanonicalValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
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

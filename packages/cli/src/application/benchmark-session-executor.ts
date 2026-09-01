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
  createBoundHostToolSandbox,
  createSessionBuiltinToolOptions,
  defineDeliberationLevelId,
  mapProviderModelRouteErrorToOutcome,
} from "@kilnai/core";
import {
  getProjectContextArtifactCache,
  ProviderModelRouteHealthStore,
  RuntimeProviderTransportBudgetAuthority,
  discoverClaudeCliModelDiscovery,
  discoverCodexCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
  deriveRuntimeConvergencePolicyInput,
  withManagedAgentInvocationResourceProvider,
  withManagedInvocationService,
} from "@kilnai/runtime";
import type { OperatorAdoptionRuntimeBinding } from "@kilnai/runtime";
import type { KilnAppConfig } from "../config.js";
import type { ResolvedKilnConfig } from "../kiln-yaml-types.js";
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
import { resolveExecutionTargetCandidates } from "../config/execution-target-resolver.js";
import {
  readGlobalConfigSnapshot,
  readGlobalExecutionTargetCatalog,
  type KilnGlobalConfig,
} from "../config/global-config.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { readKilnYamlFile } from "../kiln-yaml.js";
import { withContextCandidates } from "./agent-skill-context.js";
import { resolveInstructionProfileContextCandidates } from "./instruction-profile-context.js";
import { withWorkGovernanceContext } from "./work-governance-context.js";
import {
  loadConfiguredBuiltinToolSurfaceOptions,
  observeFormalVerificationCapability,
  withProgressiveRuntimeToolProjection,
} from "../config/builtin-tool-surface-config.js";
import {
  digestKilnPermissionPolicy,
  resolveBenchmarkPermissionPolicy,
} from "../config/model-facing-permission-policy.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import { resolveProjectStateBinding } from "./project-state-root.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "./private-project-state-filesystem.js";
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
import { projectProviderRequestObservations } from "./provider-request-observation-projection.js";
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
} from "./benchmarks/formal-screening/backend-verifier.js";
import {
  verifyFrontendBenchmarkLease,
  type FrontendBenchmarkVerification,
} from "./benchmark-frontend-verifier.js";
import {
  createLemmaCheckTool,
  hasCleanLemmaTrustPolicy,
  isLemmaQualificationInfrastructureFailure,
  isPassedLemmaQualification,
  qualifyLemmaCandidateSealed,
} from "./verification/formal/lemma-check-tool.js";
import type { LemmaCheckOutput } from "./verification/formal/lemma-check-tool.js";
import type { PrivateFormalScreeningPackageFacts } from "./benchmarks/formal-screening/package-loader.js";
import { createPrivateFormalScreeningWorkspaceLease } from "./benchmarks/formal-screening/package-loader.js";
import type { ResolvedFormalScreeningConfig } from "../config/formal-screening-config.js";
import {
  computeFormalVerifierHash,
  omitFormalVerificationCapability,
  parseLemmaCheckObservation,
  readFormalCandidateDigest,
  readFormalContractDigest,
  readLemmaCheckDependencyBinding,
  resolveFormalScreeningCase,
  toBackendVerifierCasePayload,
  toPublicBackendVerifierCasePayload,
} from "./benchmarks/formal-screening/screening-execution.js";
import { TranscriptAuthorityAdmissionEvidenceStore } from "./authority-admission-evidence-store.js";
import { SqliteRuntimeModelRoundActionClaimStore } from "./runtime-model-round-action-claim-store.js";
import { SqliteRuntimeToolActionClaimStore } from "./runtime-tool-action-claim-store.js";
import { TranscriptStore } from "../wrapper/session-store.js";
import { readRuntimeConfigurationRevision } from "./runtime-configuration-revision.js";
import { toCanonicalSessionEventPersistedTranscriptEventDraft } from "./operator-transcript-projection.js";
import { canonicalSessionEventsFromTranscript } from "./runtime-session-rehydration.js";

const BENCHMARK_TOOL_ROUND_LIMIT = 8;
export const BENCHMARK_EXECUTION_ENVELOPE = Object.freeze({
  convergence: deriveRuntimeConvergencePolicyInput({
    policyId: "kiln.benchmark.default",
    toolRounds: BENCHMARK_TOOL_ROUND_LIMIT,
  }),
});
export const FORMAL_SCREENING_BUDGET = Object.freeze({
  toolRounds: BENCHMARK_TOOL_ROUND_LIMIT,
  maxToolCalls: 24,
  maxTotalTokens: 64_000,
  wallClockMs: 600_000,
});
export const FORMAL_SCREENING_EXECUTION_ENVELOPE = Object.freeze({
  convergence: deriveRuntimeConvergencePolicyInput({
    policyId: "kiln.formal-verification-screening",
    toolRounds: FORMAL_SCREENING_BUDGET.toolRounds,
  }),
});
const LEMMA_CHECK_TIMEOUT_MS = 30_000;
const FORMAL_SCREENING_PROTOCOL_HASH = digestCanonicalValue({
  id: "kiln-formal-verification-screening-v2",
  candidatePath: "src/solution.ts",
  allowedChangedPaths: ["src/solution.ts"],
  arms: ["C0", "T"],
  toolRounds: FORMAL_SCREENING_BUDGET.toolRounds,
  sealedQualification: {
    arms: ["C0", "T"],
    exposure: "host-only-post-hoc",
    contractBinding: "exact-at-directive-lines",
    timeoutMs: LEMMA_CHECK_TIMEOUT_MS,
  },
});
const WRITE_BENCHMARK_PROFILE_IDS = new Set([
  "kiln-managed-coding-agent",
  "kiln-model-roster-backend-write",
  "kiln-model-roster-frontend-render",
  "kiln-formal-verification-pilot",
]);

export function isWriteBenchmarkProfile(profileId: string): boolean {
  return WRITE_BENCHMARK_PROFILE_IDS.has(profileId);
}
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
  readonly executionEnvelope?: import("@kilnai/runtime").RuntimeExecutionEnvelope;
}

export interface BenchmarkSessionExecutorOptions {
  readonly appConfig: KilnAppConfig;
  readonly flags?: BenchmarkSessionExecutorFlags;
  /** One immutable effective config used by command preflight and every trial. */
  readonly configurationAdmission?: BenchmarkConfigurationAdmission;
  /** Host-owned private formal screening facts supplied by the command. */
  readonly formalScreeningPackage?: PrivateFormalScreeningPackageFacts;
  /** Host-owned resolved formal screening toolchain supplied by the command. */
  readonly formalScreeningConfig?: ResolvedFormalScreeningConfig;
}

export interface BenchmarkConfigurationAdmission {
  readonly mode: "read-only" | "write";
  readonly configurationRevision: import("@kilnai/runtime").RuntimeConfigurationRevisionSnapshot;
  readonly globalConfig: KilnGlobalConfig | null;
  readonly resolvedKilnConfig: ResolvedKilnConfig | null;
  readonly permissionPolicy: KilnPermissionPolicy;
}

/** Captures effective benchmark policy and Runtime revision as one fail-closed value. */
export async function captureBenchmarkConfigurationAdmission(input: {
  readonly repositoryRoot: string;
  readonly appConfig: KilnAppConfig;
  readonly mode: "read-only" | "write";
}): Promise<BenchmarkConfigurationAdmission> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = readRuntimeConfigurationRevision(input.repositoryRoot);
    const global = readGlobalConfigSnapshot();
    if (before.revisions.global !== global.revision) continue;
    const capturedResolvedKilnConfig = input.appConfig.kilnYaml
      ?? await loadKilnConfig(input.repositoryRoot, { globalConfig: global.config });
    const after = readRuntimeConfigurationRevision(input.repositoryRoot);
    if (before.revisionSetId !== after.revisionSetId || after.revisions.global !== global.revision) continue;
    const globalConfig = cloneAndFreeze(global.config);
    const resolvedKilnConfig = cloneAndFreeze(capturedResolvedKilnConfig);
    return Object.freeze({
      mode: input.mode,
      configurationRevision: cloneAndFreeze(after),
      globalConfig,
      resolvedKilnConfig,
      permissionPolicy: cloneAndFreeze(resolveBenchmarkPermissionPolicy(resolvedKilnConfig?.permissions, input.mode)),
    });
  }
  throw new Error("Canonical benchmark configuration changed during preflight admission.");
}

export function createBenchmarkSessionExecutor(options: BenchmarkSessionExecutorOptions): BenchmarkItemExecutor {
  let deliberationResolutionPromise: Promise<DeliberationResolution> | undefined;
  let configurationAdmissionPromise = options.configurationAdmission
    ? Promise.resolve(options.configurationAdmission)
    : undefined;
  return async (input, context) => {
    const startedAt = Date.now();
    const isFormalScreening = context.profile.id === "kiln-formal-verification-pilot";
    const executionEnvelope: import("@kilnai/runtime").RuntimeExecutionEnvelope = isFormalScreening
      ? FORMAL_SCREENING_EXECUTION_ENVELOPE
      : options.flags?.executionEnvelope ?? BENCHMARK_EXECUTION_ENVELOPE;
    const providerTransportAdmission = executionEnvelope.physicalProviderRequests === undefined
      ? undefined
      : new RuntimeProviderTransportBudgetAuthority(executionEnvelope.physicalProviderRequests);
    const recordedRepeatIndex = isFormalScreening ? context.runIndex : context.repeatIndex;
    const formalScreeningCase = isFormalScreening
      ? resolveFormalScreeningCase(options.formalScreeningPackage, options.formalScreeningConfig, context)
      : undefined;
    const accountOverrideCandidates = resolveBenchmarkAccountOverrideCandidates(options.flags, context);
    const scheduledAccountOverrideId = accountOverrideCandidates[0];
    const formalScreeningArm = formalScreeningCase?.arm;
    const repositoryRoot = resolveProjectRoot().rootPath;
    const projectStateBinding = resolveProjectStateBinding(repositoryRoot);
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
    const writeMode = isWriteBenchmarkProfile(context.profile.id);
    configurationAdmissionPromise ??= captureBenchmarkConfigurationAdmission({
      repositoryRoot,
      appConfig: options.appConfig,
      mode: writeMode ? "write" : "read-only",
    });
    const configurationAdmission = await configurationAdmissionPromise;
    const expectedConfigurationMode = writeMode ? "write" : "read-only";
    if (configurationAdmission.mode !== expectedConfigurationMode) {
      throw new Error(`Benchmark configuration admission mode '${configurationAdmission.mode}' cannot execute '${expectedConfigurationMode}'.`);
    }
    const writeLease = privateFormalScreeningLease ?? (writeMode
      ? createBenchmarkWriteWorkspaceLease(repositoryRoot, context.item.metadata?.workspaceFixture)
      : undefined);
    const authorityLease = benchmarkWorkspace.kind === "synthetic-fixture"
      ? createBenchmarkAuthorityWorkspaceLease()
      : undefined;
    const cwd = writeLease?.rootPath ?? benchmarkWorkspace.rootPath;
    const initialFormalContractDigest = isFormalScreening
      ? readFormalContractDigest(cwd)
      : undefined;
    const authorityStateRoot = authorityLease?.rootPath ?? projectStateBinding.runtimePath;
    // Benchmark transcript/admission evidence belongs to the run artifact owner,
    // never to a synthetic fixture or a disposable workspace lease. The command
    // supplies this root beside its durable output artifacts; the authority lease
    // remains a fallback for direct executor callers that do not own a run output.
    const benchmarkEvidenceRoot = options.flags?.benchmarkEvidenceRoot
      ? resolve(options.flags.benchmarkEvidenceRoot)
      : authorityLease?.rootPath ?? join(projectStateBinding.benchmarksPath, "authority-evidence");
    const usesPrivateBenchmarkEvidence = authorityLease === undefined
      && options.flags?.benchmarkEvidenceRoot === undefined;
    if (usesPrivateBenchmarkEvidence) {
      ensurePrivateStateDirectorySync(projectStateBinding.projectStateRoot, benchmarkEvidenceRoot);
    }
    let closeAuthorityState = () => authorityLease?.cleanup();
    const workspaceFixtureHash = writeLease?.canonicalHash ?? (benchmarkWorkspace.kind === "synthetic-fixture"
      ? hashBenchmarkWorkspace(benchmarkWorkspace)
      : undefined);
    let workspaceChanges: BenchmarkWriteWorkspaceChanges | undefined;
    let observedVerification: BackendBenchmarkVerification | FrontendBenchmarkVerification | undefined;
    let expectedRouteId: string | undefined;
    const sessionId = randomUUID();
    try {
    const sessionInput = benchmarkWorkspace.kind === "synthetic-fixture"
      ? [
          "Benchmark workspace isolation: the current workspace root is already the complete synthetic fixture.",
          "Use paths relative to this workspace root. Do not prepend the fixture declaration or inspect parent directories.",
          ...(isFormalScreening && formalScreeningArm === "T" ? [
            "Treatment protocol: after the final candidate edit, invoke lemma_check before finishing.",
            "If lemma_check does not pass, revise the candidate from its compact feedback and invoke it again; do not report completion without a passed result.",
          ] : []),
          "",
          input,
        ].join("\n")
      : input;
    const mode: SessionMode = "cli-wrapper";
    const globalConfig = configurationAdmission.globalConfig;
    const directExecutionTargetCatalog = readGlobalExecutionTargetCatalog(globalConfig);
    const managedRouteConfig = globalConfig
      ? { ...globalConfig, executionCatalog: directExecutionTargetCatalog ?? undefined }
      : undefined;
    const projectConfig = benchmarkWorkspace.kind === "repository"
      ? readKilnYamlFile(projectStateBinding.configPath)
      : undefined;
    const resolvedKilnConfig = configurationAdmission.resolvedKilnConfig;
    const configuredRouteCandidates = resolveExecutionTargetCandidates({
      globalConfig,
      executionCatalog: directExecutionTargetCatalog,
      targetId: options.flags?.targetId,
    });
    const configuredRouteCandidate = configuredRouteCandidates[0];
    expectedRouteId = configuredRouteCandidate?.targetId;
    if (isFormalScreening) {
      if (!options.flags?.targetId || options.flags.targetId.trim().length === 0) {
        throw new Error("Formal screening requires an explicit targetId.");
      }
      if (configuredRouteCandidates.length !== 1) {
        throw new Error("Formal screening requires exactly one configured route candidate.");
      }
      if (!directExecutionTargetCatalog) {
        throw new Error("Formal screening requires a canonical direct execution catalog.");
      }
    }
    if (writeMode && configuredRouteCandidates.length === 0) {
      throw new Error("Benchmark write profiles require a configured direct execution target.");
    }
    const preferredProvider = configuredRouteCandidates[0]?.provider;
    const effectiveModel = configuredRouteCandidates[0]?.model;
    const permissionPolicy = configurationAdmission.permissionPolicy;
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
      kilnHome: projectStateBinding.kilnHome,
      runtimePermissionObservationProjectPath: cwd,
      worktreeRepoRoot: repositoryRoot,
      worktreeBaseDir: (() => {
        const worktreeBaseDir = join(projectStateBinding.tmpPath, "worktrees");
        ensurePrivateStateDirectorySync(projectStateBinding.projectStateRoot, worktreeBaseDir);
        return worktreeBaseDir;
      })(),
      privateStateRoot: projectStateBinding.projectStateRoot,
    });
    const benchmarkCleanupRegistry = new CleanupRegistry();
    const benchmarkSessionsPath = join(benchmarkEvidenceRoot, "sessions");
    const benchmarkRuntimePath = join(benchmarkEvidenceRoot, "runtime");
    const benchmarkCachePath = join(benchmarkEvidenceRoot, "cache", "context-artifacts.json");
    if (usesPrivateBenchmarkEvidence) {
      ensurePrivateStateDirectorySync(projectStateBinding.projectStateRoot, benchmarkSessionsPath);
      ensurePrivateStateDirectorySync(projectStateBinding.projectStateRoot, benchmarkRuntimePath);
      assertPrivateStateFileTargetSync(projectStateBinding.projectStateRoot, benchmarkCachePath);
    }
    const transcriptStore = new TranscriptStore({
      sessionsPath: benchmarkSessionsPath,
      ...(usesPrivateBenchmarkEvidence ? { privateStateRoot: projectStateBinding.projectStateRoot } : {}),
    });
    const managedDirectAdmissionEvidence = new TranscriptAuthorityAdmissionEvidenceStore(transcriptStore);
    const managedDirectModelRoundActionClaimsPath = join(
      benchmarkRuntimePath,
      `benchmark-${sessionId}-managed-direct-model-round-action-claims.sqlite`,
    );
    const managedDirectToolActionClaimsPath = join(
      benchmarkRuntimePath,
      `benchmark-${sessionId}-managed-direct-tool-action-claims.sqlite`,
    );
    if (usesPrivateBenchmarkEvidence) {
      assertPrivateStateFileTargetSync(projectStateBinding.projectStateRoot, managedDirectModelRoundActionClaimsPath);
      assertPrivateStateFileTargetSync(projectStateBinding.projectStateRoot, managedDirectToolActionClaimsPath);
    }
    const managedDirectModelRoundActionClaims = new SqliteRuntimeModelRoundActionClaimStore({
      path: managedDirectModelRoundActionClaimsPath,
    });
    let managedDirectToolActionClaims: SqliteRuntimeToolActionClaimStore;
    try {
      managedDirectToolActionClaims = new SqliteRuntimeToolActionClaimStore({
        path: managedDirectToolActionClaimsPath,
      });
    } catch (error) {
      managedDirectModelRoundActionClaims.close();
      throw error;
    }
    benchmarkCleanupRegistry.register(async () => managedDirectToolActionClaims.close());
    benchmarkCleanupRegistry.register(async () => managedDirectModelRoundActionClaims.close());
    const operatorEconomicAuthority = benchmarkWorkspace.kind === "repository" && !options.appConfig.managedInvocation
      ? createOperatorSurfaceEconomicAuthority("benchmark", cwd)
      : undefined;
    benchmarkCleanupRegistry.register(async () => operatorEconomicAuthority?.close());
    const contextArtifactCache = await getProjectContextArtifactCache(
      benchmarkCachePath,
      usesPrivateBenchmarkEvidence ? projectStateBinding.projectStateRoot : benchmarkEvidenceRoot,
    );
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
      projectStateBinding,
      ...(isFormalScreening ? {} : {
        formalVerificationCapability: observeFormalVerificationCapability(configuredBuiltinToolOptions),
      }),
    });
    benchmarkCleanupRegistry.register(async () => boundedWork.close());
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    const capturedLemmaCheckObservations: LemmaCheckOutput[] = [];
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
              recordObservation: (observation) => capturedLemmaCheckObservations.push(observation),
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
        projectStateBinding,
        registry,
        surface: "run",
        maxParallelChildren: benchmarkWorkspace.kind === "repository"
          ? resolvedKilnConfig?.parallelWorkers ?? 1
          : 1,
        isProviderAvailable: (providerId) => engineAvailability.get(providerId),
        providerModelEligibility: managedAgentProviderModels,
        directAdapterFactory: createManagedDirectProviderAdapterFactory({
          kilnHome: projectStateBinding.kilnHome,
          builtinToolOptions: () => builtinToolOptions,
          runtimeEnv: env,
          executionEnvelope,
          ...(providerTransportAdmission ? { providerTransportAdmission } : {}),
          runtimeToolActionClaims: managedDirectToolActionClaims,
          runtimeModelRoundActionClaims: managedDirectModelRoundActionClaims,
          readAuthorityAdmission: (request) => managedDirectAdmissionEvidence.readAdmission(request),
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
      executionEnvelope,
      ...(providerTransportAdmission ? { providerTransportAdmission } : {}),
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
      toolSandbox: createBoundHostToolSandbox({
        policy: new SandboxPolicy({
          projectPath: writeLease?.rootPath ?? cwd,
          config: {
            fsPolicy: writeLease ? "read-write" : "read-only",
            netPolicy: "none",
            allowedPaths: [writeLease?.rootPath ?? cwd],
            deniedPaths: [],
            allowedDomains: [],
          },
        }),
        leaseId: writeLease?.leaseId ?? `benchmark-read-only:${sessionId}`,
        configurationRevisionId: configurationAdmission.configurationRevision.revisionSetId as `sha256:${string}`,
        permissionPolicyDigest: digestKilnPermissionPolicy(permissionPolicy),
      }),
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
    const result = await (configuredRouteCandidates.length > 0 && directExecutionTargetCatalog
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
              catalog: directExecutionTargetCatalog,
              cwd,
              authorityStateRoot,
              executionId: `${sessionId}:account:${index}`,
              targetId: configuredRouteCandidate.targetId,
              configurationRevision: configurationAdmission.configurationRevision,
              authorityAdmissionEvidenceStore: managedDirectAdmissionEvidence,
              captureCatalogSnapshot: () => {
                const current = readRuntimeConfigurationRevision(repositoryRoot);
                const global = readGlobalConfigSnapshot();
                if (current.revisionSetId !== configurationAdmission.configurationRevision.revisionSetId
                  || global.revision !== configurationAdmission.configurationRevision.revisions.global) {
                  throw new Error("Canonical benchmark configuration changed after preflight admission.");
                }
                return Object.freeze({
                  catalog: directExecutionTargetCatalog,
                  configurationRevision: configurationAdmission.configurationRevision,
                });
              },
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
    const modelExecutionDurationMs = Date.now() - startedAt;
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
    await recordDirectRouteHealth(
      configuredRouteCandidates,
      result.attempts,
      result.lastError,
      projectStateBinding.kilnHome,
    );
    const routeFailures = result.attempts.flatMap((attempt) => {
      if (attempt.succeeded || !attempt.error) return [];
      const routeIdentity = attempt.model
        ? `${attempt.providerId}/${attempt.model}`
        : attempt.providerId;
      return [`${routeIdentity}: ${attempt.error}`];
    });
    const boundExecution = [...result.executionBindings].reverse().find((binding) => binding.status === "bound");
    const observedRouteId = boundExecution?.routeId ?? expectedRouteId;
    const providerRequestObservations = projectProviderRequestObservations({
      requests: result.providerRequests ?? [],
      ...(observedRouteId ? { routeId: observedRouteId } : {}),
    });
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
      ? capturedLemmaCheckObservations.flatMap(parseLemmaCheckObservation)
      : [];
    const changedFinalSourceHash = observedVerification?.changes.changed.find(
      (entry) => entry.path === "src/solution.ts",
    )?.afterHash;
    const finalSourceHash = changedFinalSourceHash ?? readFormalCandidateDigest(cwd);
    const passedLemmaCheckObservations = lemmaCheckObservations.filter(
      (observation) => isPassedLemmaQualification(observation, finalSourceHash),
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
    const sealedQualificationStartedAt = Date.now();
    const sealedQualificationObservation = isFormalScreening && formalScreeningCase && options.formalScreeningConfig
      ? await qualifyLemmaCandidateSealed(cwd, {
          requiredFunctionNames: formalScreeningCase.requiredFunctionNames,
          toolchain: options.formalScreeningConfig,
          timeoutMs: LEMMA_CHECK_TIMEOUT_MS,
        })
      : undefined;
    const sealedQualificationDurationMs = sealedQualificationObservation === undefined
      ? undefined
      : Date.now() - sealedQualificationStartedAt;
    const sealedDafnyPassed = sealedQualificationObservation !== undefined
      && isPassedLemmaQualification(sealedQualificationObservation, finalSourceHash);
    const sealedToolchainHash = sealedQualificationObservation === undefined
      ? undefined
      : readLemmaCheckDependencyBinding(sealedQualificationObservation)[0];
    const finalFormalContractDigest = isFormalScreening
      ? readFormalContractDigest(cwd)
      : undefined;
    const contractDigestUnchanged = initialFormalContractDigest !== undefined
      && finalFormalContractDigest === initialFormalContractDigest;
    const trustPolicyClean = sealedQualificationObservation !== undefined
      && hasCleanLemmaTrustPolicy(sealedQualificationObservation);
    const sealedQualificationInfrastructureValid = sealedQualificationObservation !== undefined
      && !isLemmaQualificationInfrastructureFailure(sealedQualificationObservation)
      && sealedToolchainHash !== undefined;
    const hiddenVerificationInfrastructureValid = !isFormalScreening || (
      observedVerification !== undefined
      && (!("infrastructureFailure" in observedVerification)
        || observedVerification.infrastructureFailure === false)
    );
    const durationMs = Date.now() - startedAt;
    const budgetExceeded = isFormalScreening && (
      result.toolCallCount > FORMAL_SCREENING_BUDGET.maxToolCalls
      || result.inputTokens + result.outputTokens > FORMAL_SCREENING_BUDGET.maxTotalTokens
      || modelExecutionDurationMs > FORMAL_SCREENING_BUDGET.wallClockMs
    );
    const formalInfrastructureValid = !isFormalScreening || (
      !formalWallClockTimedOut
      && !budgetExceeded
      && accountFallbackCount === 0
      && !formalExecutionIdentityMismatch
      && result.successfulProviderId !== undefined
      && hiddenVerificationInfrastructureValid
      && sealedQualificationInfrastructureValid
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
            : isFormalScreening && !hiddenVerificationInfrastructureValid
              ? { status: "invalid", reason: "hidden-verifier-infrastructure" }
            : isFormalScreening && !sealedQualificationInfrastructureValid
              ? { status: "invalid", reason: "sealed-qualification-infrastructure" }
            : formalInfrastructureValid && result.successfulProviderId
             ? { status: "valid" }
             : { status: "invalid", reason: "route-unavailable" },
      metadata: {
        sessionId,
        activeAgentId: context.profile.id,
        runIndex: context.runIndex,
        repeatIndex: recordedRepeatIndex,
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
        providerRequestObservations,
        deliberationResolution,
        ...(isFormalScreening ? {
          formalScreeningArm,
          lemmaCheckObservations,
          lemmaCheckPassed,
          sealedQualificationObservation,
          modelExecutionDurationMs,
          sealedQualificationDurationMs,
          sealedDafnyPassed,
          sealedToolchainHash,
          contractDigestUnchanged,
          trustPolicyClean,
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
        toolResultDiagnostics: result.transcript.flatMap((entry) => {
          if (entry.event.type !== "tool_result") return [];
          const metadata = entry.event.metadata
            && typeof entry.event.metadata === "object"
            && !Array.isArray(entry.event.metadata)
            ? entry.event.metadata as Record<string, unknown>
            : undefined;
          const errorCode = typeof metadata?.errorCode === "string" ? metadata.errorCode : undefined;
          const status = typeof metadata?.status === "string" ? metadata.status : undefined;
          const kind = typeof metadata?.kind === "string" ? metadata.kind : undefined;
          const lifecycleState = typeof metadata?.lifecycleState === "string" ? metadata.lifecycleState : undefined;
          const diagnosticClassifications = Array.isArray(metadata?.diagnostics)
            ? metadata.diagnostics.flatMap((diagnostic) => {
                if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return [];
                const classification = "classification" in diagnostic && typeof diagnostic.classification === "string"
                  ? diagnostic.classification
                  : undefined;
                const diagnosticKind = "kind" in diagnostic && typeof diagnostic.kind === "string"
                  ? diagnostic.kind
                  : undefined;
                return classification || diagnosticKind
                  ? [{ ...(classification ? { classification } : {}), ...(diagnosticKind ? { kind: diagnosticKind } : {}) }]
                  : [];
              })
            : [];
          if (entry.event.isError !== true && !errorCode && !status) return [];
          return [{
            name: entry.event.toolName,
            isError: entry.event.isError === true,
            ...(errorCode ? { errorCode } : {}),
            ...(status ? { status } : {}),
            ...(kind ? { kind } : {}),
            ...(lifecycleState ? { lifecycleState } : {}),
            ...(diagnosticClassifications.length > 0 ? { diagnosticClassifications } : {}),
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
      const routingFailureCode = readOperatorSessionRoutingFailureCode(error);
      return {
        output: "",
        durationMs: Date.now() - startedAt,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        trial: { status: "invalid", reason: "account-route-unavailable" },
        metadata: {
          sessionId,
          activeAgentId: context.profile.id,
          runIndex: context.runIndex,
          repeatIndex: recordedRepeatIndex,
          sessionSucceeded: false,
          diagnostics: ["Canonical execution account route was unavailable before provider dispatch."],
          ...(routingFailureCode ? { routingFailureCode } : {}),
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

function cloneAndFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
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

const OPERATOR_SESSION_ROUTING_FAILURE_CODES = new Set([
  "safety-ineligible",
  "health-unhealthy",
  "quota-exhausted",
  "quota-unknown",
  "capacity-exhausted",
  "no-account-candidate",
  "multiple-account-rejections",
  "unclassified",
]);

function readOperatorSessionRoutingFailureCode(error: Error): string | undefined {
  const code = (error as Error & { readonly routingFailureCode?: unknown }).routingFailureCode;
  return typeof code === "string" && OPERATOR_SESSION_ROUTING_FAILURE_CODES.has(code) ? code : undefined;
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
  kilnHome?: string,
): Promise<void> {
  if (!candidates.some((candidate) => isDirectApiProvider(candidate.provider))) {
    return;
  }
  const routeHealthStore = new ProviderModelRouteHealthStore({ kilnHome });
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

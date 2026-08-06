import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, posix, resolve, win32 } from "node:path";
import type {
  ArtifactResourceStore,
  DefaultBuiltinToolRegistryOptions,
  ManagedAgentAdmissionProfile,
  ManagedAgentCredentialRoute,
  ManagedAgentExternalRuntimeAttachmentIdentity,
  ManagedAgentMemoryScope,
  ManagedAgentAuthorityProfile,
  ManagedAgentRouteSource,
  ProviderModelEvidence,
  ProviderModelEvidenceObservation,
  ProviderModelEvidenceState,
  ProviderModelEvidenceValue,
  ProviderModelEligibilityDecision,
  ProviderModelEligibilityRequirements,
  ModelTaskSuitabilityEvidence,
  ManagedAgentWorkingDirectory,
  ModelGatewayConfig,
  ManagedEconomicAdoptedSnapshotExpectation,
  ManagedEconomicPriceEvidence,
  ModelDeliberationCapabilities,
} from "@kilnai/core";
import {
  adoptManagedEconomicSnapshot,
  createAccountRef,
  createAccountPolicyId,
  createManagedAccountAffinityKey,
  createProviderModelEvidence,
  defineManagedAgentReadAuthority,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  deriveProviderModelEligibility,
  digestManagedEconomicValue,
  defineDeliberationLevelId,
  isDirectProviderId,
} from "@kilnai/core";
import {
  createAttachedRuntimeBuiltinToolSurface,
  ConfiguredManagedAccountRuntime,
  resolveClaudeCodeExecutable,
  type ClaudeCodeExecutableResolution,
  ManagedCliHarnessAdapter,
  ManagedCommittedRouteMismatchError,
  ManagedEconomicDispatchCoordinator,
  ManagedJobApplicationError,
  ManagedFilesystemRuntimeRecoveryStore,
  ManagedGitWorktreeLeaseManager,
  ManagedRemoteHarnessAdapter,
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
  SqliteManagedAccountLeaseAuthority,
  type ManagedAgentRuntimeAdapter,
  type ManagedAgentRuntimeAuthorityObserver,
  type ManagedInvocationAgentCatalogEntry,
  type ManagedCommittedInvocationRequest,
  type ManagedInvocationRouteProfile,
  type ManagedInvocationToolOptions,
  type ManagedInvocationToolRoute,
  type ManagedEconomicCandidateSet,
  type ManagedJobEconomicAdoption,
  type ManagedJobRecord,
} from "@kilnai/runtime";
import type {
  ManagedAgentProviderModelCatalogDiagnostic,
  ManagedAgentProviderModelCatalogDiagnostics,
} from "./managed-agent-provider-models.js";
import type { CliSessionFactory } from "@kilnai/runtime";
import type {
  KilnManagedAgentsConfig,
  KilnManagedAgentProfile,
  KilnManagedAgentRouteConfig,
  KilnModelTaskSuitabilityOverride,
  KilnYamlSkillsConfig,
} from "../kiln-yaml-types.js";
import type {
  ProviderCreateConfig,
  ProviderId,
  SessionRegistry,
} from "../wrapper/session-registry.js";
import type { DirectProviderAccountBinding } from "../wrapper/direct-provider-adapter-factory.js";
import { createManagedInvocationContextResolver } from "./managed-invocation-context-resolver.js";
import { loadAgentDefinitions, type KilnAgentDefinition } from "../application/agent-loader.js";
import { readSkillCatalogStatus } from "./skill-catalog-status.js";
import { resolveConfiguredModelTaskSuitability } from "./model-task-suitability.js";

type ManagedSkillCatalogEntry = NonNullable<ManagedInvocationToolOptions["skillCatalog"]>[number];

export type ManagedAgentOperatorSurface = "gui" | "tui" | "run" | "operator";

export interface ManagedAgentRouteHealth {
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly kind: "harness" | "direct";
  readonly provider: string;
  readonly model?: string;
  readonly profiles: readonly ManagedAgentAdmissionProfile[];
  readonly available: boolean;
  readonly reason?: string;
}

export interface ManagedAgentProfileHealth {
  readonly agentName: string;
  readonly available: boolean;
  readonly routeId?: string;
  readonly reason?: string;
}

export interface ManagedInvocationRouteResolution {
  readonly managedInvocation?: ManagedInvocationToolOptions;
  readonly routeHealth: readonly ManagedAgentRouteHealth[];
  readonly agentHealth?: readonly ManagedAgentProfileHealth[];
}

export interface ManagedInvocationToolOptionsCatalog {
  readonly options: ManagedInvocationToolOptions;
  update(next: ManagedInvocationToolOptions): void;
}

export interface ResolveManagedInvocationToolOptionsContext {
  readonly cwd: string;
  readonly registry: SessionRegistry;
  readonly surface: ManagedAgentOperatorSurface;
  readonly isProviderAvailable?: (provider: string) => boolean | undefined;
  /**
   * Operator Claude Code executable resolution.  Injectable so route admission
   * stays deterministic and network-free in tests; production defaults to the
   * one canonical resolver shared with model discovery.
   */
  readonly resolveClaudeExecutable?: () => ClaudeCodeExecutableResolution | undefined;
  readonly providerModelEligibility?: ManagedAgentProviderModelCatalogDiagnostics;
  readonly includeUnavailableRoutes?: boolean;
  readonly directAdapterFactory?: (
    route: KilnManagedAgentRouteConfig,
    accountBinding: DirectProviderAccountBinding | undefined,
    abortSignal: AbortSignal | undefined,
    committedRequest: ManagedCommittedInvocationRequest,
  ) => ManagedAgentRuntimeAdapter | Promise<ManagedAgentRuntimeAdapter | undefined> | undefined;
  readonly builtinToolOptions?: BuiltinToolOptionsSource;
  readonly artifactStore?: ArtifactResourceStore;
  readonly invocationService?: RuntimeManagedAgentInvocationService;
  readonly invocationServiceKey?: string;
  readonly userHome?: string;
  readonly maxParallelChildren?: number;
  readonly managedAccountComposition?: ManagedAccountRuntimeComposition;
  /** Candidate admission projects static route evidence without constructing execution owners. */
  readonly compositionMode?: "execution" | "candidate-admission";
}

type BuiltinToolOptionsSource = DefaultBuiltinToolRegistryOptions | (() => DefaultBuiltinToolRegistryOptions | undefined);

interface ManagedAgentRouteConfigProjection {
  readonly routeConfig: KilnManagedAgentRouteConfig;
  readonly routeSource: ManagedAgentRouteSource;
}

export interface ManagedAgentRouteConfigSource {
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  readonly skills?: KilnYamlSkillsConfig;
  readonly engines?: Record<string, { readonly enabled?: boolean }>;
  readonly routing?: {
    readonly defaultWorker?: string;
    readonly routes?: readonly {
      readonly provider: string;
      readonly model?: string;
    }[];
  };
  readonly models?: {
    readonly default?: string;
    readonly [engine: string]: string | undefined;
  };
  readonly modelGateway?: ModelGatewayConfig;
}

export interface ManagedAccountRuntimeComposition {
  readonly routing: ConfiguredManagedAccountRuntime;
  readonly authority: SqliteManagedAccountLeaseAuthority;
  updateConfig(config: ModelGatewayConfig): void;
  close(): void;
}

export type ManagedEconomicAdoptionSubject = Pick<
  ManagedJobRecord,
  | "economicPolicyId"
  | "economicPolicyRevision"
  | "candidateSet"
  | "constraints"
  | "adoptedDecisionAt"
  | "projectId"
  | "callerId"
  | "parent"
>;

/** Projects validated config and persisted admission into immutable Core evidence. */
export async function projectManagedEconomicJobAdoption(
  config: ManagedAgentRouteConfigSource,
  job: ManagedEconomicAdoptionSubject,
  routing: ConfiguredManagedAccountRuntime,
): Promise<ManagedJobEconomicAdoption> {
  const managed = config.managedAgents;
  const gateway = config.modelGateway;
  const policy = managed?.economicPolicies?.find((entry) =>
    entry.id === job.economicPolicyId && entry.revision === job.economicPolicyRevision);
  if (managed?.schemaVersion !== 2 || !policy || !gateway) {
    throw new ManagedJobApplicationError(
      "identity-revision-conflict",
      "Restore the exact persisted managed economic policy revision.",
    );
  }
  const admitted = admittedEconomicIdentities(job.candidateSet);
  const domains = policy.comparisonDomains.map((domain) => ({
    id: domain.id,
    rank: domain.rank,
    basis: {
      unit: domain.unit,
      scheme: domain.scheme,
      rateCardBasis: domain.rateCardBasis,
      envelopeSemantics: domain.envelopeSemantics,
    },
  }));
  const routes = policy.candidates
    .filter((candidate) => admitted.some((identity) => identity.routeId === candidate.routeId))
    .map((candidate) => {
      const admittedIdentity = admitted.find((identity) => identity.routeId === candidate.routeId)!;
      const routeConfig = managed.routes?.find((entry) => entry.id === candidate.routeId);
      const domain = domains.find((entry) => entry.id === candidate.comparisonDomainId);
      const configuredAccountPolicyId = routeConfig?.credentials?.mode === "runtime-selected"
        ? routeConfig.credentials.accountPolicyId
        : null;
      const economicsRouteId = routeConfig?.credentials?.mode === "credentialless"
        ? routeConfig.credentials.economicsRouteId
        : configuredAccountPolicyId;
      const virtual = gateway.virtualModels.find((entry) => entry.id === economicsRouteId);
      const economics = virtual?.economics;
      if (!routeConfig || !routeConfig.model || !domain || !virtual || !economics) {
        throw new ManagedJobApplicationError(
          "identity-revision-conflict",
          `Restore managed economic route '${candidate.routeId}' and its exact revision.`,
        );
      }
      if (
        routeConfig.provider !== admittedIdentity.providerId
        || routeConfig.model !== admittedIdentity.modelId
        || economics.adapterCapabilityId !== admittedIdentity.adapterCapabilityId
        || economics.adapterCapabilityVersion !== admittedIdentity.adapterCapabilityVersion
        || (configuredAccountPolicyId === null
          ? admittedIdentity.accountPolicy.kind !== "accountless"
          : admittedIdentity.accountPolicy.kind !== "account-bound"
            || admittedIdentity.accountPolicy.accountPolicyId !== configuredAccountPolicyId)
      ) {
        throw new ManagedJobApplicationError(
          "identity-revision-conflict",
          `Restore managed economic route '${candidate.routeId}' and its exact admitted identity.`,
        );
      }
      const unitRates = "unitPrices" in economics.priceEvidence
        ? economics.priceEvidence.unitPrices
        : [];
      const unitScheduleDigest = digestManagedEconomicValue(unitRates);
      const auxiliaryScheduleDigest = digestManagedEconomicValue(economics.auxiliaryCharges);
      const envelopeDigest = digestManagedEconomicValue(economics.executionEnvelope);
      const priceIdentity = {
        providerId: virtual.providerId,
        modelId: virtual.providerModelId,
        authBillingChannel: economics.authBillingChannel,
        executionMode: economics.executionMode,
        serviceTier: economics.serviceTier,
        rateCardId: economics.priceEvidence.rateCardId,
        rateCardRevision: economics.priceEvidence.rateCardRevision,
        unit: domain.basis.unit,
        scheme: domain.basis.scheme,
        unitScheduleDigest,
        contextClass: economics.contextClass,
        cacheClass: economics.cacheClass,
        auxiliaryScheduleDigest,
        evidence: economics.priceEvidence.evidence,
      };
      const priceEvidence: ManagedEconomicPriceEvidence = {
        kind: economics.priceEvidence.kind,
        identity: priceIdentity,
        ...("allowanceId" in economics.priceEvidence ? { allowanceId: economics.priceEvidence.allowanceId } : {}),
        ...("reason" in economics.priceEvidence ? { reason: economics.priceEvidence.reason } : {}),
        ...("estimationMethod" in economics.priceEvidence
          ? { estimationMethod: economics.priceEvidence.estimationMethod }
          : {}),
      } as ManagedEconomicPriceEvidence;
      return {
        admittedIdentity,
        route: {
          routeId: candidate.routeId,
          providerId: virtual.providerId,
          modelId: virtual.providerModelId,
          adapterCapabilityId: economics.adapterCapabilityId,
          adapterCapabilityVersion: economics.adapterCapabilityVersion,
          authBillingChannel: economics.authBillingChannel,
          executionMode: economics.executionMode,
          serviceTier: economics.serviceTier,
          accountPolicyId: configuredAccountPolicyId,
          fallbackPosture: economics.fallbackPosture,
          overagePosture: economics.overagePosture,
          rateCardId: economics.priceEvidence.rateCardId,
          rateCardRevision: economics.priceEvidence.rateCardRevision,
          priceEvidenceDigest: economics.priceEvidence.evidence.sourceDigest,
          unit: domain.basis.unit,
          scheme: domain.basis.scheme,
          contextClass: economics.contextClass,
          cacheClass: economics.cacheClass,
          auxiliaryScheduleDigest,
          envelopeDigest,
        },
        comparisonDomain: domain,
        priorityRank: candidate.priorityRank,
        priceEvidence,
        rateSchedule: { unitRates, auxiliaryCharges: economics.auxiliaryCharges },
        executionEnvelope: { kind: "bounded" as const, digest: envelopeDigest, limits: economics.executionEnvelope.limits },
        worstCaseReservation: candidate.worstCaseReservation,
        ceiling: candidate.ceiling,
      };
    });
  if (routes.length !== admitted.length) {
    throw new ManagedJobApplicationError(
      "identity-revision-conflict",
      "Restore the exact persisted managed economic candidate set.",
    );
  }
  const callerConstraints = {
    ...(job.constraints.routeId ? { routeIds: [job.constraints.routeId] } : {}),
    ...(job.constraints.providerId ? { providerIds: [job.constraints.providerId] } : {}),
    ...(job.constraints.model ? { modelIds: [job.constraints.model] } : {}),
  };
  const snapshot = adoptManagedEconomicSnapshot({
    policy: {
      policyId: policy.id,
      schemaVersion: managed.schemaVersion,
      policyRevision: policy.revision,
      policyDigest: digestManagedEconomicValue(policy),
      comparisonDomains: domains,
      noRouteAction: policy.noRouteAction,
      evidenceRequirements: policy.evidenceRequirements,
    },
    adoptedAt: job.adoptedDecisionAt,
    adoptedDecisionAt: job.adoptedDecisionAt,
    callerConstraints,
    routes,
  });
  const expectation: ManagedEconomicAdoptedSnapshotExpectation = {
    policyId: job.economicPolicyId,
    policyRevision: job.economicPolicyRevision,
    candidateSetDigest: snapshot.candidateSetDigest,
    admittedCandidates: admitted,
    callerConstraints,
  };
  const routeCapacity = await Promise.all(routes.map(async (route) => {
    if (route.route.accountPolicyId === null) {
      return { routeId: route.route.routeId };
    }
    const resolution = await routing.resolve({
      accountPolicyId: createAccountPolicyId(route.route.accountPolicyId!),
      providerRoute: {
        providerId: route.route.providerId,
        model: route.route.modelId,
        surface: "managed-economic-adoption",
      },
    });
    const affinityRequest = resolution.affinityPolicy.continuity === "none"
      ? { continuity: "none" as const }
      : managedEconomicAffinityRequest(job, route.route.routeId, resolution.affinityPolicy);
    return {
      routeId: route.route.routeId,
      route: resolution.route,
      affinityRequest,
      candidates: resolution.candidates,
    };
  }));
  return { snapshot, expectation, routeCapacity };
}

function managedEconomicAffinityRequest(
  job: ManagedEconomicAdoptionSubject,
  routeId: string,
  policy: Exclude<Awaited<ReturnType<ConfiguredManagedAccountRuntime["resolve"]>>["affinityPolicy"], { continuity: "none" }>,
) {
  if (!job.parent) {
    throw new ManagedJobApplicationError(
      "identity-revision-conflict",
      `Managed economic route '${routeId}' requires persisted parent lineage for affinity continuity.`,
    );
  }
  const parts = [
    "kiln-managed-economic-affinity-v1",
    job.projectId,
    job.callerId,
    routeId,
    policy.scope,
    job.parent.invocationId,
    ...(policy.scope === "turn" ? [job.parent.turnId] : []),
  ];
  const hash = createHash("sha256");
  for (const part of parts) {
    const bytes = Buffer.from(part, "utf8");
    hash.update(`${bytes.byteLength}:`);
    hash.update(bytes);
    hash.update(";");
  }
  return {
    continuity: policy.continuity,
    scope: policy.scope,
    ...(policy.allowRebind === undefined ? {} : { allowRebind: policy.allowRebind }),
    key: createManagedAccountAffinityKey(hash.digest("hex")),
  };
}

function admittedEconomicIdentities(candidateSet: ManagedEconomicCandidateSet) {
  return candidateSet.candidates.map((candidate) => ({
    routeId: candidate.routeId,
    sourceIdentity: candidate.routeSource,
    providerId: candidate.providerId,
    modelId: candidate.model ?? "",
    adapterCapabilityId: candidate.adapterCapabilityId,
    adapterCapabilityVersion: candidate.adapterCapabilityVersion,
    accountPolicy: candidate.accountPolicyId
      ? { kind: "account-bound" as const, accountPolicyId: candidate.accountPolicyId }
      : { kind: "accountless" as const },
  }));
}

const SUPPORTED_HARNESS_PROVIDERS = new Set<string>(["claude", "codex", "opencode"]);
const READONLY_PROFILE: KilnManagedAgentProfile = "foundation-readonly-plan";
const WRITE_PROFILES = new Set<KilnManagedAgentProfile>([
  "foundation-propose-writes",
  "foundation-apply-approved-writes",
  "foundation-memory-write-proposals",
]);
const DEFAULT_ALLOWED_TOOLS = ["read", "tree", "grep", "glob"] as const;
const DEFAULT_WRITE_ALLOWED_TOOLS = ["read", "tree", "grep", "glob", "write", "edit", "apply-patch"] as const;
const DEFAULT_MANAGED_WORKSPACE_DENIED_ENTRIES = [".git", "node_modules", ".kiln"] as const;
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MODELS: Record<string, string> = {
  codex: "gpt-5.3-codex-spark",
  opencode: "opencode/minimax-m2.5-free",
};
const LIVE_PROVEN_WRITE_HARNESS_PROVIDERS = new Set<string>(["codex"]);
const CLAUDE_MOVING_MODEL_ALIASES = new Set<string>(["default", "sonnet", "opus", "haiku"]);
const LIVE_PROVEN_HARNESS_WRITE_AUTHORITY = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;
const HARNESS_READONLY_RESULT_HANDOFF_MODELS: Record<string, readonly string[] | "*"> = {
  claude: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
  codex: "*",
  // OpenCode permission rules do not provide a hard filesystem boundary for a
  // managed child. Keep the native child route closed; authorized OpenCode Go
  // and Zen direct-provider routes remain available through Kiln tool policy.
  opencode: [],
};
const MANAGED_ACCOUNT_COMPOSITIONS = new Map<string, ManagedAccountRuntimeComposition>();

export async function resolveManagedInvocationToolOptions(
  config: ManagedAgentRouteConfigSource | null | undefined,
  context: ResolveManagedInvocationToolOptionsContext,
): Promise<ManagedInvocationRouteResolution> {
  const mark = createManagedRouteResolutionStartupMarker();
  mark("managed-route-resolution-entered");
  if (!config || config.managedAgents?.enabled === false) {
    return { routeHealth: [] };
  }

  const routeConfigs = resolveRouteConfigs(config);
  mark("managed-route-configs-resolved", { count: routeConfigs.length });
  if (routeConfigs.length === 0) {
    return { routeHealth: [] };
  }

  const routes: ManagedInvocationToolRoute[] = [];
  const routeHealth: ManagedAgentRouteHealth[] = [];
  const userHome = context.userHome ?? homedir();
  const agentDefinitions = await loadAgentDefinitions(context.cwd, { userHome });
  mark("managed-route-agents-loaded", { count: agentDefinitions.length });
  const configuredAgentDefinitions = config.managedAgents?.schemaVersion === 2
    ? agentDefinitions.filter((agent) => agent.scope !== "builtin")
    : agentDefinitions;
  const economicPolicyHealth = validateManagedAgentEconomicPolicyBindings(
    configuredAgentDefinitions,
    routeConfigs,
    config.managedAgents,
  );
  if (economicPolicyHealth.length > 0) {
    return { routeHealth: [], agentHealth: economicPolicyHealth };
  }
  const skillCatalog = loadManagedInvocationSkillCatalog(context.cwd, userHome, config.skills);
  mark("managed-route-skills-loaded", { count: skillCatalog.length });

  let routeIndex = 0;
  const economicPolicyIdsByRoute = managedEconomicPolicyIdsByRoute(config.managedAgents);
  const economicCapabilityByRoute = managedEconomicCapabilitiesByRoute(
    config,
    routeConfigs.map((projection) => projection.routeConfig),
    economicPolicyIdsByRoute,
  );
  const deliberationCapabilitiesByRoute = managedDeliberationCapabilitiesByRoute(
    config,
    routeConfigs.map((projection) => projection.routeConfig),
  );
  for (const routeConfig of routeConfigs) {
    routeIndex += 1;
    mark("managed-route-resolve-started", { routeIndex, routeId: routeConfig.routeConfig.id });
    const policyIds = economicPolicyIdsByRoute.get(routeConfig.routeConfig.id) ?? [];
    const deferAdapterConstruction = routeConfig.routeConfig.kind === "direct"
      ? true
      : policyIds.length > 0 || context.compositionMode === "candidate-admission";
    const resolved = await resolveRouteConfig(
      routeConfig,
      context,
      config,
      deferAdapterConstruction,
    );
    mark("managed-route-resolve-finished", { routeIndex, routeId: routeConfig.routeConfig.id });
    const policyUncovered = routeConfig.routeConfig.kind === "direct" && policyIds.length === 0;
    const health = policyUncovered && resolved.health.available
      ? {
          ...resolved.health,
          available: false,
          reason: `Direct managed invocation route '${routeConfig.routeConfig.id}' has no covering economic policy; managed invocation requires a durable economic commitment before adapter construction.`,
        }
      : resolved.health;
    routeHealth.push(health);
    if (resolved.route && health.available) {
      const economics = economicCapabilityByRoute.get(routeConfig.routeConfig.id);
      routes.push({
        ...resolved.route,
        ...(deliberationCapabilitiesByRoute.get(routeConfig.routeConfig.id)
          ? { deliberationCapabilities: deliberationCapabilitiesByRoute.get(routeConfig.routeConfig.id) }
          : {}),
        ...(policyIds.length > 0 ? { economicPolicyIds: policyIds } : {}),
        ...(economics ? { economicCapability: economics } : {}),
      });
    }
  }
  const agentProjections = configuredAgentDefinitions.map((agent) =>
    projectManagedAgentCatalogEntry(agent, routes, config.managedAgents)
  );
  const agentCatalog = agentProjections.flatMap((projection) => projection.entry ? [projection.entry] : []);
  const agentHealth = agentProjections.flatMap((projection) => projection.health ? [projection.health] : []);

  const unavailableRoutes = routeHealth
    .filter((route) => !route.available)
    .map((route) => {
      const routeConfig = routeConfigs.find(
        (candidate) => candidate.routeConfig.id === route.routeId,
      )?.routeConfig;
      const policyIds = economicPolicyIdsByRoute.get(route.routeId) ?? [];
      const economics = economicCapabilityByRoute.get(route.routeId);
      return {
        routeId: route.routeId,
        ...(policyIds.length > 0 ? { economicPolicyIds: policyIds } : {}),
        ...(routeConfig?.credentials?.mode === "runtime-selected"
          ? { accountPolicyId: routeConfig.credentials.accountPolicyId }
          : {}),
        ...(economics ? { economicCapability: economics } : {}),
        routeSource: route.routeSource,
        providerId: route.provider,
        ...(route.model ? { model: route.model } : {}),
        profiles: route.profiles,
        reason: route.reason ?? "Route is unavailable.",
      };
    });
  const shouldExposeManagedInvocation = routes.length > 0
    || (context.includeUnavailableRoutes === true && unavailableRoutes.length > 0);
  const executionComposition = context.compositionMode !== "candidate-admission";
  const managedAccountComposition = executionComposition
    ? context.managedAccountComposition ?? createManagedAccountRuntimeComposition(config, context.cwd)
    : undefined;
  if (managedAccountComposition && config.modelGateway) {
    managedAccountComposition.updateConfig(config.modelGateway);
  }
  const invocationService = executionComposition
    ? createManagedInvocationService(
        config,
        context.cwd,
        context.invocationService,
        context.invocationServiceKey,
        managedAccountComposition,
      )
    : undefined;
  const invocationServiceKey = executionComposition
    ? managedInvocationServiceKey(config, context.cwd)
    : undefined;
  const economicDispatch = managedAccountComposition
    ? createManagedEconomicDispatchComposition(
        config,
        context.cwd,
        routes,
        managedAccountComposition,
      ).port
    : undefined;

  return {
    routeHealth,
    ...(agentHealth.length > 0 ? { agentHealth } : {}),
    ...(shouldExposeManagedInvocation ? {
      managedInvocation: {
        routes,
        maxParallelChildren: context.maxParallelChildren ?? 1,
        ...(agentCatalog.length > 0 ? { agentCatalog } : {}),
        ...(skillCatalog.length > 0 ? { skillCatalog } : {}),
        ...(unavailableRoutes.length > 0 ? { unavailableRoutes } : {}),
        requestedBy: "assistant",
        requestSource: context.surface,
        ...(context.artifactStore ? { artifactStore: context.artifactStore } : {}),
        ...(invocationService ? { invocationService } : {}),
        ...(invocationService && invocationServiceKey ? { invocationServiceKey } : {}),
        ...(economicDispatch ? { economicDispatch, workspaceRoot: context.cwd } : {}),
        contextResolver: createManagedInvocationContextResolver(context.cwd, userHome, {
          skillConfig: config.skills,
          modelTaskSuitability: config.modelTaskSuitability,
        }),
      },
    } : {}),
  };
}

export function createManagedEconomicDispatchComposition(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
  routes: readonly ManagedInvocationToolRoute[],
  composition: ManagedAccountRuntimeComposition,
): {
  readonly coordinator: ManagedEconomicDispatchCoordinator;
  readonly port: NonNullable<ManagedInvocationToolOptions["economicDispatch"]>;
} {
  const coordinator = new ManagedEconomicDispatchCoordinator({
    authority: {
      acquire: (input) => composition.authority.acquireCommitment(input),
      releasePreFence: (jobId, economicAttemptId) =>
        composition.authority.releaseCommitmentPreFence(jobId, economicAttemptId),
      fenceDispatch: (jobId, economicAttemptId, dispatchFenceId) =>
        composition.authority.fenceDispatch(jobId, economicAttemptId, dispatchFenceId),
      settleExecution: (jobId, economicAttemptId, dispatchFenceId, settlement) =>
        composition.authority.settleExecution(jobId, economicAttemptId, dispatchFenceId, settlement),
      recordExecutionSettlementPending: (jobId, economicAttemptId, dispatchFenceId, reason) =>
        composition.authority.recordExecutionSettlementPending(jobId, economicAttemptId, dispatchFenceId, reason),
    },
    resolveLifecycleTimeoutMs: (commitment, admissionProfile) => {
      const routeId = commitment.reservation.selectedIdentity.route.routeId;
      const route = routes.find((candidate) => candidate.routeId === routeId);
      if (!route) throw new Error(`Committed managed economic route '${routeId}' is not configured.`);
      const profile = route.profiles[admissionProfile];
      if (!profile) throw new Error(`Committed managed economic route '${routeId}' does not admit '${admissionProfile}'.`);
      return profile.timeoutMs;
    },
    createAdapter: async (request) => {
      const routeId = request.commitment.reservation.selectedIdentity.route.routeId;
      const route = routes.find((candidate) => candidate.routeId === routeId);
      if (!route?.createCommittedAdapter) {
        throw new Error(`Committed managed economic route '${routeId}' has no postcommit adapter factory.`);
      }
      return await route.createCommittedAdapter(request);
    },
  });
  const projectId = `project-${createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 32)}`;
  return { coordinator, port: {
    prepare: async (input) => {
      const adoption = await awaitManagedRoutePreparation(projectManagedEconomicJobAdoption(config, {
        economicPolicyId: input.candidateSet.economicPolicyId,
        economicPolicyRevision: input.candidateSet.economicPolicyRevision,
        candidateSet: input.candidateSet,
        constraints: input.candidateSet.constraints,
        adoptedDecisionAt: input.adoptedDecisionAt,
        projectId,
        callerId: input.parentSessionId,
        parent: {
          invocationId: input.parentSessionId,
          turnId: input.parentTurnId,
        },
      }, composition.routing), input.abortSignal);
      return await coordinator.prepare({
        jobId: input.jobId,
        economicAttemptId: input.economicAttemptId,
        intentFingerprint: input.intentFingerprint,
        adoption,
        admissionProfile: input.candidateSet.admissionProfileId,
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        ...(input.lifecycleEvents ? { lifecycleEvents: input.lifecycleEvents } : {}),
      });
    },
  } };
}

function validateManagedAgentEconomicPolicyBindings(
  agents: readonly KilnAgentDefinition[],
  routeConfigs: readonly ManagedAgentRouteConfigProjection[],
  managedAgents: KilnManagedAgentsConfig | undefined,
): readonly ManagedAgentProfileHealth[] {
  if (managedAgents?.schemaVersion !== 2 || !managedAgents.economicPolicies) return [];
  const policies = new Map(managedAgents.economicPolicies.map((policy) => [policy.id, policy]));
  const configuredRoutes = new Map(routeConfigs.map((route) => [route.routeConfig.id, route.routeConfig]));
  const failures: ManagedAgentProfileHealth[] = [];
  for (const agent of agents) {
    if (agent.mode !== "managed-child" && agent.mode !== "all") continue;
    const configuredRoute = agent.routeId ? configuredRoutes.get(agent.routeId) : undefined;
    if (configuredRoute?.kind === "harness") continue;
    if (!agent.economicPolicyId) {
      failures.push({
        agentName: agent.name,
        available: false,
        reason: "Managed agent schema v2 requires an explicit economicPolicyId.",
      });
      continue;
    }
    const policy = policies.get(agent.economicPolicyId);
    if (!policy) {
      failures.push({
        agentName: agent.name,
        available: false,
        reason: `Agent references unknown economic policy '${agent.economicPolicyId}'.`,
      });
      continue;
    }
    const candidateRouteIds = new Set(policy.candidates.map((candidate) => candidate.routeId));
    if (agent.routeId && !candidateRouteIds.has(agent.routeId)) {
      failures.push({
        agentName: agent.name,
        available: false,
        routeId: agent.routeId,
        reason: `Agent route '${agent.routeId}' is not admitted by economic policy '${policy.id}'.`,
      });
      continue;
    }
    if (agent.providerRoute) {
      const providerRoute = agent.providerRoute;
      const matchesCandidate = [...candidateRouteIds].some((routeId) => {
        const route = configuredRoutes.get(routeId);
        return route !== undefined
          && route.provider === providerRoute.providerId
          && (!providerRoute.model || route.model === providerRoute.model);
      });
      if (!matchesCandidate) {
        failures.push({
          agentName: agent.name,
          available: false,
          reason: `Agent provider constraint is not admitted by economic policy '${policy.id}'.`,
        });
      }
    }
  }
  return failures;
}

function managedEconomicPolicyIdsByRoute(
  managedAgents: KilnManagedAgentsConfig | undefined,
): ReadonlyMap<string, readonly string[]> {
  const idsByRoute = new Map<string, string[]>();
  for (const policy of managedAgents?.economicPolicies ?? []) {
    for (const candidate of policy.candidates) {
      const ids = idsByRoute.get(candidate.routeId) ?? [];
      ids.push(policy.id);
      idsByRoute.set(candidate.routeId, ids);
    }
  }
  return idsByRoute;
}

function managedEconomicCapabilitiesByRoute(
  config: ManagedAgentRouteConfigSource,
  routes: readonly KilnManagedAgentRouteConfig[],
  policyIdsByRoute: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, NonNullable<ManagedInvocationToolRoute["economicCapability"]>> {
  const capabilities = new Map<string, NonNullable<ManagedInvocationToolRoute["economicCapability"]>>();
  for (const route of routes) {
    if (!policyIdsByRoute.has(route.id)) continue;
    if (
      route.kind !== "direct"
      || !["codex-oauth", "opencode-go", "opencode-zen"].includes(route.provider)
      || !route.credentials
    ) {
      capabilities.set(route.id, { status: "unverified" });
      continue;
    }
    // The credential union owns the single validated reference to the canonical
    // virtual route for both account-backed and accountless economics.
    const economicsRouteId = route.credentials.mode === "runtime-selected"
      ? route.credentials.accountPolicyId
      : route.credentials.economicsRouteId;
    const canonicalRoute = config.modelGateway?.virtualModels.find(
      (candidate) =>
        candidate.id === economicsRouteId
        && candidate.providerId === route.provider
        && candidate.providerModelId === route.model,
    );
    const economics = canonicalRoute?.economics;
    capabilities.set(route.id, economics
      ? {
          status: "verified",
          adapterCapabilityId: economics.adapterCapabilityId,
          adapterCapabilityVersion: economics.adapterCapabilityVersion,
        }
      : { status: "unverified" });
  }
  return capabilities;
}

function createManagedRouteResolutionStartupMarker(): (phase: string, detail?: Record<string, unknown>) => void {
  const startedAt = performance.now();
  return (phase, detail) => {
    if (process.env.KILN_STARTUP_PROFILE !== "1") {
      return;
    }
    process.stderr.write(`KILN_STARTUP_PROFILE ${JSON.stringify({
      type: "kiln_startup_profile",
      surface: "managed-agent-route-resolution",
      phase,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...(detail ? { detail } : {}),
    })}\n`);
  };
}

function projectManagedAgentCatalogEntry(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
  managedAgents: KilnManagedAgentsConfig | undefined,
): { readonly entry?: ManagedInvocationAgentCatalogEntry; readonly health?: ManagedAgentProfileHealth } {
  const explicitRouteHealth = validateExplicitAgentRoute(agent, routes);
  if (explicitRouteHealth) {
    return { health: explicitRouteHealth };
  }
  const routeHint = resolveAgentRouteHint(agent, routes);
  return {
    entry: {
      name: agent.name,
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.nicknameCandidates ? { nicknameCandidates: agent.nicknameCandidates } : {}),
      role: agent.role,
      goal: agent.goal,
      tier: agent.tier,
      ...(agent.authorityProfile ? { authorityProfile: agent.authorityProfile } : {}),
      ...(agent.skills ? { skills: agent.skills } : {}),
      ...(agent.taskAffinity ? { taskAffinity: agent.taskAffinity } : {}),
      ...(agent.economicPolicyId
        ? {
            economicPolicyId: agent.economicPolicyId,
            economicPolicyRevision: managedAgents?.economicPolicies?.find(
              (policy) => policy.id === agent.economicPolicyId,
            )?.revision,
            economicPolicyCandidateRouteIds: managedAgents?.economicPolicies?.find(
              (policy) => policy.id === agent.economicPolicyId,
            )?.candidates.map((candidate) => candidate.routeId),
          }
        : {}),
      ...(routeHint?.routeId ? { routeId: routeHint.routeId } : {}),
      ...(routeHint?.providerRoute ? { providerRoute: routeHint.providerRoute } : {}),
      ...(agent.voiceProfile ? { voiceProfile: agent.voiceProfile } : {}),
    },
  };
}

function validateExplicitAgentRoute(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
): ManagedAgentProfileHealth | undefined {
  if (!agent.routeId && !agent.providerRoute) {
    return undefined;
  }
  const route = routeFromExplicitAgentHint(agent, routes);
  if (!route) {
    const routeDescription = agent.routeId
      ? `route '${agent.routeId}'`
      : `provider '${agent.providerRoute?.providerId}'${agent.providerRoute?.model ? ` model '${agent.providerRoute.model}'` : ""}`;
    return {
      agentName: agent.name,
      available: false,
      ...(agent.routeId ? { routeId: agent.routeId } : {}),
      reason: `Agent references unavailable managed ${routeDescription}.`,
    };
  }
  if (agent.providerRoute?.providerId && agent.providerRoute.providerId !== route.providerId) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent provider '${agent.providerRoute.providerId}' does not match route provider '${route.providerId}'.`,
    };
  }
  if (agent.providerRoute?.model && agent.providerRoute.model !== route.model) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent model '${agent.providerRoute.model}' does not match route model '${route.model ?? "unspecified"}'.`,
    };
  }
  if (agent.authorityProfile && !route.profiles[agent.authorityProfile]) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent authority profile '${agent.authorityProfile}' is not admitted by route '${route.routeId}'.`,
    };
  }
  const routeTools = new Set(Object.values(route.profiles).flatMap((profile) => profile?.allowedToolNames ?? []));
  const missingTools = (agent.tools ?? []).filter((tool) => !routeTools.has(tool));
  if (missingTools.length > 0) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent tools are not admitted by route '${route.routeId}': ${missingTools.join(", ")}.`,
    };
  }
  return undefined;
}

function resolveAgentRouteHint(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
): Pick<ManagedInvocationAgentCatalogEntry, "routeId" | "providerRoute"> | undefined {
  const explicit = routeFromExplicitAgentHint(agent, routes);
  if (explicit) {
    return routeHint(explicit, agent);
  }
  if (agent.economicPolicyId) {
    return undefined;
  }
  const scored = routes
    .map((route, index) => ({
      route,
      index,
      score: scoreAgentRoute(agent, route),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = scored[0]?.route;
  return selected ? routeHint(selected, agent) : undefined;
}

function routeFromExplicitAgentHint(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
): ManagedInvocationToolRoute | undefined {
  if (agent.routeId) {
    return routes.find((route) => route.routeId === agent.routeId);
  }
  if (agent.providerRoute) {
    return routes.find((route) =>
      route.providerId === agent.providerRoute?.providerId
      && (!agent.providerRoute.model || route.model === agent.providerRoute.model)
    );
  }
  return undefined;
}

function routeHint(
  route: ManagedInvocationToolRoute,
  agent: KilnAgentDefinition,
): Pick<ManagedInvocationAgentCatalogEntry, "routeId" | "providerRoute"> {
  return {
    routeId: route.routeId,
    providerRoute: {
      providerId: route.providerId,
      ...(route.model ? { model: route.model } : {}),
      ...(agent.providerRoute?.deliberationIntent ? { deliberationIntent: agent.providerRoute.deliberationIntent } : {}),
    },
  };
}

function scoreAgentRoute(agent: KilnAgentDefinition, route: ManagedInvocationToolRoute): number {
  let score = 0;
  const normalizedRouteId = route.routeId.toLowerCase();
  const normalizedAgentName = agent.name.toLowerCase();
  if (normalizedRouteId.includes(normalizedAgentName)) {
    score += 100;
  }
  for (const alias of [agent.displayName, ...(agent.nicknameCandidates ?? [])]) {
    if (alias && normalizedRouteId.includes(alias.toLowerCase())) {
      score += 60;
    }
  }
  for (const affinity of agent.taskAffinity ?? []) {
    const suitability = route.taskSuitability?.find((entry) => entry.task === affinity);
    if (!suitability) {
      continue;
    }
    if (suitability.level === "preferred") {
      score += 30;
    } else if (suitability.level === "capable") {
      score += 20;
    } else if (suitability.level === "limited") {
      score += 5;
    }
  }
  return score;
}

export function createManagedInvocationToolOptionsCatalog(
  initial: ManagedInvocationToolOptions,
): ManagedInvocationToolOptionsCatalog {
  let current = initial;
  return {
    options: {
      get routes() {
        return current.routes;
      },
      get unavailableRoutes() {
        return current.unavailableRoutes;
      },
      get agentCatalog() {
        return current.agentCatalog;
      },
      get skillCatalog() {
        return current.skillCatalog;
      },
      get requestedBy() {
        return current.requestedBy;
      },
      get requestSource() {
        return current.requestSource;
      },
      get artifactStore() {
        return current.artifactStore;
      },
      get invocationService() {
        return current.invocationService;
      },
      get invocationServiceKey() {
        return current.invocationServiceKey;
      },
      get sessionEventSink() {
        return current.sessionEventSink;
      },
      get contextResolver() {
        return current.contextResolver;
      },
      get maxParallelChildren() {
        return current.maxParallelChildren;
      },
    },
    update(next: ManagedInvocationToolOptions) {
      current = next;
    },
  };
}

function loadManagedInvocationSkillCatalog(
  projectPath: string,
  userHome: string,
  skillConfig: KilnYamlSkillsConfig | undefined,
): readonly ManagedSkillCatalogEntry[] {
  const catalog = readSkillCatalogStatus({ projectPath, userHome, skillConfig });
  return catalog.entries
    .map((skill): ManagedSkillCatalogEntry => ({
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      configured: skill.configured,
      builtIn: skill.builtIn,
      sourcePath: skill.sourcePath,
      admission: skill.admission,
      projections: skill.projections.map((projection) => ({
        target: projection.target,
        status: projection.status,
        path: projection.path,
      })),
      ...(skill.omissionReason ? { omissionReason: skill.omissionReason } : {}),
      ...(skill.tags && skill.tags.length > 0 ? { tags: skill.tags } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveRouteConfigs(
  config: ManagedAgentRouteConfigSource,
): readonly ManagedAgentRouteConfigProjection[] {
  return (config.managedAgents?.routes ?? [])
    .map((routeConfig) => projectedRoute(routeConfig, "explicit-managed-route"));
}

function projectedRoute(
  routeConfig: KilnManagedAgentRouteConfig,
  routeSource: ManagedAgentRouteSource,
): ManagedAgentRouteConfigProjection {
  return { routeConfig, routeSource };
}

function managedAgentVoiceProfile(
  routeConfig: KilnManagedAgentRouteConfig,
  config: ManagedAgentRouteConfigSource,
): string | undefined {
  return routeConfig.voiceProfile ?? config.managedAgents?.defaultVoiceProfile;
}

async function resolveRouteConfig(
  projection: ManagedAgentRouteConfigProjection,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
  deferAdapterConstruction: boolean,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  const { routeConfig, routeSource } = projection;
  const profiles = normalizeProfiles(routeConfig.profiles);
  const baseHealth = {
    routeId: routeConfig.id,
    routeSource,
    kind: routeConfig.kind,
    provider: routeConfig.provider,
    ...(routeConfig.model ? { model: routeConfig.model } : {}),
    profiles,
  };

  const writeRequired = routeRequiresWriteAuthority(routeConfig, profiles);
  if (writeRequired && routeConfig.writeAuthority === undefined) {
    return unhealthy(baseHealth, "Write-capable managed invocation routes require explicit writeAuthority scope and approval config.");
  }

  if (config.engines?.[routeConfig.provider]?.enabled === false) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is disabled in engine config.`);
  }

  if (routeConfig.kind !== "harness" && routeConfig.kind !== "direct") {
    return unhealthy(baseHealth, `Unsupported managed invocation route kind '${routeConfig.kind}'.`);
  }

  if (routeConfig.kind === "direct") {
    return resolveDirectRouteConfig(
      routeConfig,
      context,
      config,
      baseHealth,
      writeRequired,
    );
  }

  if (routeConfig.remoteHarness !== undefined) {
    return resolveRemoteHarnessRouteConfig(
      routeConfig,
      context,
      config,
      baseHealth,
      writeRequired,
      deferAdapterConstruction,
    );
  }

  if (routeConfig.workingDirectory === "sandbox") {
    return unhealthy(baseHealth, "Harness sandbox working-directory routes require live-proven sandbox enforcement.");
  }

  if (!SUPPORTED_HARNESS_PROVIDERS.has(routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' does not have a live-proven managed harness adapter.`);
  }
  if (writeRequired && !LIVE_PROVEN_WRITE_HARNESS_PROVIDERS.has(routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' does not have live-proven write evidence support.`);
  }

  if (!isProviderAvailable(context, routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is unavailable.`);
  }

  // The Agent SDK executes its own bundled Claude Code whenever no executable is
  // given, which is not the binary whose catalog admitted this route.  Bind the
  // managed child to the operator's installed harness or keep the route closed.
  const harnessExecutable = routeConfig.provider === "claude"
    ? (context.resolveClaudeExecutable ?? resolveClaudeCodeExecutable)()
    : undefined;
  if (routeConfig.provider === "claude" && harnessExecutable === undefined) {
    return unhealthy(
      baseHealth,
      "Claude Code executable was not found; a managed Claude child must not run the Agent SDK bundled build.",
    );
  }

  const model = routeConfig.provider === "claude"
    ? routeConfig.model
    : routeConfig.model ?? DEFAULT_MODELS[routeConfig.provider];
  if (!model) {
    return unhealthy(baseHealth, `Managed invocation route '${routeConfig.id}' requires a model.`);
  }
  if (routeConfig.provider === "claude" && CLAUDE_MOVING_MODEL_ALIASES.has(model)) {
    return unhealthy(
      baseHealth,
      `Provider 'claude' model '${model}' is a moving alias and cannot carry live-proof admission.`,
    );
  }
  const catalogEntry = resolveManagedProviderModelCatalogEntry(context, routeConfig.provider, model);
  if (catalogEntry.status === "pending") {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' model eligibility evidence is pending.`);
  }
  if (catalogEntry.status === "ineligible") {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, undefined));
  }
  const canonicalAdmission = deriveCanonicalManagedRouteAdmission(catalogEntry.entry, routeConfig, model);
  if (!canonicalAdmission.eligible) {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, canonicalAdmission));
  }
  if (!supportsReadonlyResultHandoff(routeConfig.provider, model)) {
    return unhealthy(
      baseHealth,
      readonlyResultHandoffUnavailableReason(routeConfig.provider, model),
    );
  }

  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, profiles, config.managedAgents?.worktreeLease);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const builtinToolsProvider = deferAdapterConstruction
    ? undefined
    : createManagedRouteBuiltinToolsProvider(context);
  const adapter = deferAdapterConstruction
    ? undefined
    : new ManagedCliHarnessAdapter({
        providerId: routeConfig.provider,
        model,
        ...(routeConfig.provider === "claude" ? { admittedProviderModelId: model } : {}),
        factory: createHarnessSessionFactory(routeConfig.provider as ProviderId, model, context, harnessExecutable),
        ...(writeRequired ? { writeAuthority: LIVE_PROVEN_HARNESS_WRITE_AUTHORITY } : {}),
        ...(builtinToolsProvider ? { builtinToolsProvider } : {}),
      });
  const voiceProfile = managedAgentVoiceProfile(routeConfig, config);
  const externalRuntimeAttachment = resolveRouteExternalRuntimeAttachment(routeConfig);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    ...(routeConfig.credentials?.mode === "runtime-selected"
      ? { accountPolicyId: createAccountPolicyId(routeConfig.credentials.accountPolicyId) }
      : {}),
    routeSource,
    providerId: routeConfig.provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    ...(adapter ? { adapter } : {}),
    surface: "cli-harness",
    ...(externalRuntimeAttachment ? { externalRuntimeAttachment } : {}),
    taskSuitability: resolveTaskSuitability(
      routeConfig.provider,
      model,
      config.modelTaskSuitability,
      liveProofEvidence(routeConfig.provider, model, profiles),
    ),
    profiles: profileResolution.profiles,
  };

  return {
    health: {
      ...baseHealth,
      model,
      available: true,
    },
    route,
  };
}

async function resolveRemoteHarnessRouteConfig(
  routeConfig: KilnManagedAgentRouteConfig,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
  writeRequired: boolean,
  deferAdapterConstruction: boolean,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  if (writeRequired) {
    return unhealthy(baseHealth, "Remote harness managed invocation routes currently support foundation-readonly-plan only.");
  }
  const remoteHarness = routeConfig.remoteHarness;
  if (remoteHarness === undefined) {
    return unhealthy(baseHealth, "Remote harness route requires remoteHarness endpoint config.");
  }
  const model = routeConfig.model;
  if (!model) {
    return unhealthy(baseHealth, `Remote harness managed invocation route '${routeConfig.id}' requires a model.`);
  }
  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, normalizeProfiles(routeConfig.profiles), config.managedAgents?.worktreeLease);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const adapter = deferAdapterConstruction
    ? undefined
    : new ManagedRemoteHarnessAdapter({
        providerId: routeConfig.provider,
        model,
        invokeUrl: remoteHarness.invokeUrl,
        cancelUrl: remoteHarness.cancelUrl,
        ...(remoteHarness.authTokenEnv ? { authTokenEnv: remoteHarness.authTokenEnv } : {}),
        ...(remoteHarness.limitations ? { limitations: remoteHarness.limitations } : {}),
      });
  const voiceProfile = managedAgentVoiceProfile(routeConfig, config);
  const externalRuntimeAttachment = resolveRouteExternalRuntimeAttachment(routeConfig);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    ...(routeConfig.credentials?.mode === "runtime-selected"
      ? { accountPolicyId: createAccountPolicyId(routeConfig.credentials.accountPolicyId) }
      : {}),
    routeSource: baseHealth.routeSource,
    providerId: routeConfig.provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    ...(adapter ? { adapter } : {}),
    surface: "remote-harness",
    ...(externalRuntimeAttachment ? { externalRuntimeAttachment } : {}),
    providerModelProof: {
      status: "configured",
      source: "remote-harness-config",
      requiresToolCalls: false,
    },
    taskSuitability: resolveTaskSuitability(
      routeConfig.provider,
      model,
      config.modelTaskSuitability,
      remoteHarnessEvidence(routeConfig.provider, model, normalizeProfiles(routeConfig.profiles)),
    ),
    profiles: profileResolution.profiles,
  };
  return {
    health: {
      ...baseHealth,
      model,
      available: true,
    },
    route,
  };
}

function supportsReadonlyResultHandoff(provider: string, model: string): boolean {
  const supportedModels = HARNESS_READONLY_RESULT_HANDOFF_MODELS[provider];
  return supportedModels === "*" || supportedModels?.includes(model) === true;
}

function readonlyResultHandoffUnavailableReason(provider: string, model: string): string {
  if (provider === "opencode") {
    return "Provider 'opencode' native harness has no admitted hard filesystem boundary for managed child execution; use an authorized direct provider route or keep the route unavailable.";
  }
  return `Provider '${provider}' model '${model}' does not have live-proven read-only managed result handoff support for foundation-readonly-plan.`;
}

function routeRequiresWriteAuthority(
  routeConfig: KilnManagedAgentRouteConfig,
  profiles: readonly ManagedAgentAdmissionProfile[],
): boolean {
  return routeConfig.tools?.writes === true
    || profiles.some((profile) => WRITE_PROFILES.has(profile as KilnManagedAgentProfile));
}

function buildRouteProfiles(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  profiles: readonly ManagedAgentAdmissionProfile[],
  worktreeLeaseConfig: KilnManagedAgentsConfig["worktreeLease"] | undefined,
): {
  readonly ok: true;
  readonly profiles: ManagedInvocationToolRoute["profiles"];
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const workingDirectoryLease = resolveWorkingDirectoryLease(routeConfig, cwd, worktreeLeaseConfig);
  if (!workingDirectoryLease.ok) {
    return workingDirectoryLease;
  }
  const resolved: ManagedInvocationToolRoute["profiles"] = {};
  for (const profile of profiles) {
    if (profile === READONLY_PROFILE) {
      resolved[profile] = buildReadonlyProfile(routeConfig, cwd, workingDirectoryLease.lease);
      continue;
    }
    if (profile === "foundation-propose-writes" || profile === "foundation-apply-approved-writes" || profile === "foundation-memory-write-proposals") {
      const writeProfile = buildWriteProfile(routeConfig, cwd, profile, workingDirectoryLease.lease);
      if (!writeProfile.ok) {
        return writeProfile;
      }
      resolved[profile] = writeProfile.profile;
      continue;
    }
    return {
      ok: false,
      reason: `Managed invocation profile '${profile}' is not supported by route projection.`,
    };
  }
  return { ok: true, profiles: resolved };
}

function resolveRouteTimeout(routeConfig: KilnManagedAgentRouteConfig): {
  readonly timeoutMs: number;
  readonly source: NonNullable<ManagedAgentAuthorityProfile["timeoutSource"]>;
} {
  return {
    timeoutMs: routeConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    source: routeConfig.timeoutMs === undefined ? "default" : "explicit-route",
  };
}

function buildReadonlyProfile(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): ManagedInvocationRouteProfile {
  const timeout = resolveRouteTimeout(routeConfig);
  return {
    authorityProfileId: `authority:${routeConfig.id}:${READONLY_PROFILE}`,
    permissionProfile: "read-only",
    allowedToolNames: routeConfig.tools?.allowed ?? DEFAULT_ALLOWED_TOOLS,
    writeAllowed: false,
    networkAllowed: routeConfig.tools?.network === true,
    workingDirectory: resolveWorkingDirectory(routeConfig, cwd, workingDirectoryLease),
    ...(workingDirectoryLease ? { workingDirectoryLease } : {}),
    timeoutMs: timeout.timeoutMs,
    timeoutSource: timeout.source,
    credentialRoute: resolveCredentialRoute(routeConfig),
    memoryScope: resolveMemoryScope(routeConfig, cwd),
    ...(routeConfig.readAuthority
      ? { readAuthority: buildReadAuthority(routeConfig, cwd) }
      : {}),
  };
}

function buildReadAuthority(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
): ManagedAgentAuthorityProfile["readAuthority"] {
  const allowedPaths = normalizeManagedRoutePaths(routeConfig.readAuthority?.workspace?.allowedPaths ?? [], cwd);
  return defineManagedAgentReadAuthority({
    workspace: {
      allowedPaths,
      deniedPaths: uniqueStrings([
        ...normalizeManagedRoutePaths(routeConfig.readAuthority?.workspace?.deniedPaths ?? [], cwd),
        ...defaultManagedWorkspaceDeniedPaths(cwd, allowedPaths),
      ]),
    },
  });
}

function buildWriteProfile(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  profile: Exclude<KilnManagedAgentProfile, "foundation-readonly-plan">,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): {
  readonly ok: true;
  readonly profile: ManagedInvocationRouteProfile;
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const networkEnabled = (routeConfig.tools as { readonly network?: boolean } | undefined)?.network === true;
  if (networkEnabled) {
    return {
      ok: false,
      reason: `${profile} routes cannot enable tools.network. Use a separate foundation-readonly-plan route for web, browser, computer-use, or visual-reference research phases.`,
    };
  }
  const writeAuthority = buildWriteAuthority(routeConfig, cwd, profile);
  if (!writeAuthority.ok) {
    return writeAuthority;
  }
  const applyApproved = profile === "foundation-apply-approved-writes";
  const timeout = resolveRouteTimeout(routeConfig);
  return {
    ok: true,
    profile: {
      authorityProfileId: `authority:${routeConfig.id}:${profile}`,
      permissionProfile: applyApproved ? "apply-approved-writes" : "propose-writes",
      allowedToolNames: routeConfig.tools?.allowed ?? (applyApproved ? DEFAULT_WRITE_ALLOWED_TOOLS : DEFAULT_ALLOWED_TOOLS),
      writeAllowed: applyApproved,
      networkAllowed: routeConfig.tools?.network === true,
      workingDirectory: resolveWriteWorkingDirectory(routeConfig, cwd, applyApproved, workingDirectoryLease),
      ...(workingDirectoryLease ? { workingDirectoryLease } : {}),
      timeoutMs: timeout.timeoutMs,
      timeoutSource: timeout.source,
      credentialRoute: resolveCredentialRoute(routeConfig),
      memoryScope: resolveMemoryScope(routeConfig, cwd, writeAuthority.authority.scope.memory.mode === "propose" ? "write-proposals" : undefined),
      writeAuthority: writeAuthority.authority,
    },
  };
}

function buildWriteAuthority(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  profile: Exclude<KilnManagedAgentProfile, "foundation-readonly-plan">,
): {
  readonly ok: true;
  readonly authority: NonNullable<ManagedAgentAuthorityProfile["writeAuthority"]>;
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const config = routeConfig.writeAuthority;
  if (!config) {
    return {
      ok: false,
      reason: "Write-capable managed invocation routes require explicit writeAuthority scope and approval config.",
    };
  }
  const applyApproved = profile === "foundation-apply-approved-writes";
  const memoryOnly = profile === "foundation-memory-write-proposals";
  const configuredWorkspaceMode = config.workspace?.mode;
  const workspaceMode = memoryOnly
    ? "none"
    : applyApproved
      ? "apply-approved"
      : configuredWorkspaceMode ?? "propose";
  if (applyApproved && configuredWorkspaceMode !== undefined && configuredWorkspaceMode !== "apply-approved") {
    return {
      ok: false,
      reason: "foundation-apply-approved-writes routes require writeAuthority.workspace.mode apply-approved.",
    };
  }
  if (!applyApproved && configuredWorkspaceMode === "apply-approved") {
    return {
      ok: false,
      reason: `${profile} routes cannot use writeAuthority.workspace.mode apply-approved.`,
    };
  }
  const allowedWorkspacePaths = normalizeManagedRoutePaths(config.workspace?.allowedPaths ?? [], cwd);
  if (workspaceMode !== "none" && allowedWorkspacePaths.length === 0) {
    return {
      ok: false,
      reason: "Workspace write-capable managed invocation routes require at least one writeAuthority.workspace.allowedPaths entry.",
    };
  }
  if (
    routeConfig.workingDirectory === "isolated-worktree"
    && allowedWorkspacePaths.some((path) => !isPathWithinOrEqual(cwd, path))
  ) {
    return {
      ok: false,
      reason: "isolated-worktree write routes require writeAuthority.workspace.allowedPaths to stay inside the repository root.",
    };
  }
  const memoryMode = profile === "foundation-memory-write-proposals"
    ? "propose"
    : config.memory?.mode ?? "none";
  if (profile === "foundation-memory-write-proposals" && config.memory?.mode !== undefined && config.memory.mode !== "propose") {
    return {
      ok: false,
      reason: "foundation-memory-write-proposals routes require writeAuthority.memory.mode propose.",
    };
  }
  const artifactMode = config.artifacts?.mode ?? "none";
  if (!config.approval || (config.approval.mode !== "required-before-apply" && config.approval.mode !== "policy-approved")) {
    return {
      ok: false,
      reason: "Write-capable managed invocation routes require approval.mode required-before-apply or policy-approved.",
    };
  }

  return {
    ok: true,
    authority: defineManagedAgentWriteAuthority({
      profile,
      scope: defineManagedAgentWriteScope({
        workspace: {
          mode: workspaceMode,
          allowedPaths: workspaceMode === "none" ? [] : allowedWorkspacePaths,
          deniedPaths: workspaceMode === "none"
            ? []
            : uniqueStrings([
              ...normalizeManagedRoutePaths(config.workspace?.deniedPaths ?? [], cwd),
              ...defaultManagedWorkspaceDeniedPaths(cwd, allowedWorkspacePaths),
            ]),
        },
        memory: {
          mode: memoryMode,
          ...(memoryMode === "propose" ? { scope: { kind: "project" as const, id: basename(cwd.replace(/\\/g, "/")) || "project" } } : {}),
          operations: memoryMode === "propose" ? config.memory?.operations ?? ["create", "update"] : [],
        },
        artifacts: {
          mode: artifactMode,
          resourceUris: artifactMode === "none" ? [] : config.artifacts?.resourceUris ?? [],
          retention: config.artifacts?.retention ?? "none",
        },
        tools: {
          allowedToolNames: config.tools?.allowed ?? routeConfig.tools?.allowed ?? (applyApproved ? DEFAULT_WRITE_ALLOWED_TOOLS : DEFAULT_ALLOWED_TOOLS),
          deniedToolNames: config.tools?.denied ?? [],
        },
      }),
      approval: {
        mode: config.approval.mode,
        evidenceRequired: true,
        ...(config.approval.approver ? { approver: config.approval.approver } : {}),
        ...(config.approval.evidenceUris ? { evidenceUris: config.approval.evidenceUris } : {}),
      },
    }),
  };
}

function createManagedRouteBuiltinToolsProvider(
  context: ResolveManagedInvocationToolOptionsContext,
): (() => ReturnType<typeof createAttachedRuntimeBuiltinToolSurface>["callBuiltinTools"]) | undefined {
  const source = context.builtinToolOptions;
  if (!source) {
    return undefined;
  }
  return () => {
    const builtinToolOptions = resolveBuiltinToolOptions(source);
    return createAttachedRuntimeBuiltinToolSurface(
      builtinToolOptions ? { builtinToolOptions } : {},
    ).callBuiltinTools;
  };
}

function resolveBuiltinToolOptions(
  source: BuiltinToolOptionsSource,
): DefaultBuiltinToolRegistryOptions | undefined {
  return typeof source === "function" ? source() : source;
}

async function resolveDirectRouteConfig(
  routeConfig: KilnManagedAgentRouteConfig,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
  writeRequired: boolean,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  if (!isProviderAvailable(context, routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is unavailable.`);
  }
  const model = routeConfig.model;
  if (!model) {
    return unhealthy(baseHealth, `Direct managed invocation route '${routeConfig.id}' requires a model.`);
  }
  const catalogEntry = resolveManagedProviderModelCatalogEntry(context, routeConfig.provider, model);
  if (catalogEntry.status === "pending") {
    return unhealthy(baseHealth, `Provider/model eligibility evidence is pending for direct managed invocation route '${routeConfig.id}'.`);
  }
  if (catalogEntry.status === "ineligible") {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, undefined));
  }
  if (writeRequired) {
    const writeSupport = validateDirectRouteWriteSupport(normalizeProfiles(routeConfig.profiles));
    if (!writeSupport.ok) {
      return unhealthy(baseHealth, writeSupport.reason);
    }
  }
  const canonicalAdmission = deriveCanonicalManagedRouteAdmission(catalogEntry.entry, routeConfig, model);
  if (!canonicalAdmission.eligible) {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, canonicalAdmission));
  }
  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, normalizeProfiles(routeConfig.profiles), config.managedAgents?.worktreeLease);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const voiceProfile = managedAgentVoiceProfile(routeConfig, config);
  const externalRuntimeAttachment = resolveRouteExternalRuntimeAttachment(routeConfig);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    ...(routeConfig.credentials?.mode === "runtime-selected"
      ? { accountPolicyId: createAccountPolicyId(routeConfig.credentials.accountPolicyId) }
      : {}),
    routeSource: baseHealth.routeSource,
    providerId: routeConfig.provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    createCommittedAdapter: async (request: ManagedCommittedInvocationRequest) => {
      const committedRoute = request.commitment.reservation.selectedIdentity.route;
      const committedAccount = request.commitment.reservation.selectedIdentity.account;
      if (
        committedRoute.routeId !== routeConfig.id
        || committedRoute.providerId !== routeConfig.provider
        || committedRoute.modelId !== model
      ) {
        throw new ManagedCommittedRouteMismatchError({
          code: "committed-route-mismatch",
          expected: { routeId: routeConfig.id, providerId: routeConfig.provider, modelId: model },
          committed: {
            routeId: committedRoute.routeId,
            providerId: committedRoute.providerId,
            modelId: committedRoute.modelId,
          },
        });
      }
      let accountBinding: DirectProviderAccountBinding | undefined;
      if (committedAccount.kind === "account-bound") {
        const accountComposition = context.managedAccountComposition
          ?? createManagedAccountRuntimeComposition(config, context.cwd);
        if (
          routeConfig.credentials?.mode !== "runtime-selected"
          || !accountComposition
          || !isDirectProviderId(routeConfig.provider)
        ) {
          throw new Error("Committed account-bound managed route has no process-owned account authority.");
        }
        accountBinding = await accountComposition.routing.resolveCommittedAccountBinding({
          accountPolicyId: routeConfig.credentials.accountPolicyId,
          providerId: routeConfig.provider,
          model,
          capacityIdentity: committedAccount.capacityIdentity,
          accountRef: createAccountRef(committedAccount.accountRef),
          credentialRevisionId: committedAccount.credentialRevision,
        });
        throwIfManagedRoutePreparationAborted(request.abortSignal);
      } else if (routeConfig.credentials?.mode !== "credentialless") {
        throw new Error("Accountless managed commitment does not match the configured credential route.");
      }
      return await context.directAdapterFactory?.(
        routeConfig,
        accountBinding,
        request.abortSignal,
        request,
      );
    },
    surface: "direct-provider",
    ...(externalRuntimeAttachment ? { externalRuntimeAttachment } : {}),
    taskSuitability: resolveTaskSuitability(
      routeConfig.provider,
      model,
      config.modelTaskSuitability,
      liveProofEvidence(routeConfig.provider, model, normalizeProfiles(routeConfig.profiles)),
    ),
    profiles: profileResolution.profiles,
  };
  return {
    health: {
      ...baseHealth,
      model,
      available: true,
    },
    route,
  };
}

function managedDeliberationCapabilitiesByRoute(
  config: ManagedAgentRouteConfigSource,
  routes: readonly KilnManagedAgentRouteConfig[],
): ReadonlyMap<string, ModelDeliberationCapabilities> {
  const capabilities = new Map<string, ModelDeliberationCapabilities>();
  const observedAt = new Date().toISOString();
  for (const route of routes) {
    if (!route.model || !route.credentials) continue;
    const gatewayRouteId = route.credentials.mode === "runtime-selected"
      ? route.credentials.accountPolicyId
      : route.credentials.economicsRouteId;
    const gatewayRoute = config.modelGateway?.virtualModels.find((candidate) =>
      candidate.id === gatewayRouteId
      && candidate.providerId === route.provider
      && candidate.providerModelId === route.model,
    );
    if (!gatewayRoute?.deliberation) continue;
    capabilities.set(route.id, {
      provider: route.provider,
      model: route.model,
      levels: gatewayRoute.deliberation.levels.map((id) => ({ id: defineDeliberationLevelId(id) })),
      ...(gatewayRoute.deliberation.defaultLevel
        ? { defaultLevel: defineDeliberationLevelId(gatewayRoute.deliberation.defaultLevel) }
        : {}),
      supportsAdaptive: gatewayRoute.deliberation.supportsAdaptive,
      evidence: {
        sourceIdentity: `model-gateway:${gatewayRoute.id}`,
        sourceRevision: gatewayRoute.deliberation.evidenceRevision,
        observedAt,
      },
    });
  }
  return capabilities;
}

function throwIfManagedRoutePreparationAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Managed route preparation was aborted.");
}

function awaitManagedRoutePreparation<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfManagedRoutePreparationAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      try {
        throwIfManagedRoutePreparationAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

const DIRECT_WRITE_CAPABLE_PROFILES: readonly ManagedAgentAdmissionProfile[] = [
  "foundation-readonly-plan",
  "foundation-propose-writes",
  "foundation-apply-approved-writes",
  "foundation-memory-write-proposals",
];

// Determines write capability from route/profile configuration alone, without
// constructing the (now always-deferred) direct provider adapter. The direct
// adapter factory grants LIVE_PROVEN_DIRECT_WRITE_AUTHORITY whenever
// routeRequiresWriteAuthority(route) is true, so this mirrors that contract.
function validateDirectRouteWriteSupport(
  profiles: readonly ManagedAgentAdmissionProfile[],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const unsupportedProfile = profiles.find((profile) => !DIRECT_WRITE_CAPABLE_PROFILES.includes(profile));
  if (unsupportedProfile !== undefined) {
    return {
      ok: false,
      reason: `Direct managed invocation route does not support profile '${unsupportedProfile}'.`,
    };
  }
  return { ok: true };
}

function resolveTaskSuitability(
  provider: string,
  model: string,
  overrides: readonly KilnModelTaskSuitabilityOverride[] | undefined,
  liveProof: ModelTaskSuitabilityEvidence | undefined,
): ReturnType<typeof resolveConfiguredModelTaskSuitability> {
  return resolveConfiguredModelTaskSuitability({
    provider,
    model,
    overrides,
    liveProof,
  });
}

function liveProofEvidence(
  provider: string,
  model: string,
  profiles: readonly ManagedAgentAdmissionProfile[],
): ModelTaskSuitabilityEvidence {
  return {
    source: "live-proof",
    status: "observed",
    summary: `Managed invocation route for ${provider}/${model} is available with live-proven profiles: ${profiles.join(", ")}.`,
  };
}

function remoteHarnessEvidence(
  provider: string,
  model: string,
  profiles: readonly ManagedAgentAdmissionProfile[],
): ModelTaskSuitabilityEvidence {
  return {
    source: "configured-route",
    status: "declared",
    summary: `Remote harness managed invocation route for ${provider}/${model} is endpoint-configured with admitted profiles: ${profiles.join(", ")}.`,
  };
}

function normalizeProfiles(
  profiles: readonly ManagedAgentAdmissionProfile[] | undefined,
): readonly ManagedAgentAdmissionProfile[] {
  return profiles && profiles.length > 0 ? profiles : [READONLY_PROFILE];
}

function unhealthy(
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
  reason: string,
): {
  readonly health: ManagedAgentRouteHealth;
} {
  return {
    health: {
      ...baseHealth,
      available: false,
      reason,
    },
  };
}

function resolveManagedProviderModelCatalogEntry(
  context: ResolveManagedInvocationToolOptionsContext,
  providerId: string,
  model: string,
): {
  readonly status: "available";
  readonly entry: ManagedAgentProviderModelCatalogDiagnostic;
} | {
  readonly status: "ineligible";
} | {
  readonly status: "pending";
} {
  if (!context.providerModelEligibility) {
    return { status: "pending" };
  }
  const providerEligibility = context.providerModelEligibility?.[providerId];
  if (providerEligibility === undefined) {
    return { status: "pending" };
  }
  const entry = providerEligibility?.[model];
  if (!entry) {
    return { status: "ineligible" };
  }
  return { status: "available", entry };
}

function deriveCanonicalManagedRouteAdmission(
  entry: ManagedAgentProviderModelCatalogDiagnostic,
  routeConfig: KilnManagedAgentRouteConfig,
  model: string,
): ProviderModelEligibilityDecision {
  return deriveProviderModelEligibility(
    managedRouteEvidence(entry.catalogDiagnosticEvidence, routeConfig, model),
    managedRouteEligibilityRequirements(new Date().toISOString()),
    [],
  );
}

function managedEligibilityUnavailableReason(
  providerId: string,
  model: string,
  decision: ProviderModelEligibilityDecision | undefined,
): string {
  if (!decision) {
    return `Provider '${providerId}' has no eligible managed-agent decision for model '${model}'.`;
  }
  const reasons = decision.reasons.length > 0 ? decision.reasons.join(", ") : "unknown";
  return `Provider '${providerId}' model '${model}' is not eligible for managed invocation: ${reasons}.`;
}

function managedRouteEligibilityRequirements(evaluatedAt: string): ProviderModelEligibilityRequirements {
  return {
    use: "managed-agent",
    evaluatedAt,
    requiredStates: [
      "discovered",
      "configured",
      "authenticated",
      "capabilityCompatible",
      "policyAdmitted",
      "routeHealthy",
    ],
    requiredCapabilities: [],
    minimumCapabilityAuthority: "harness-reported",
    minimumStateAuthority: "harness-reported",
    requireProbe: false,
  };
}

function managedRouteEvidence(
  catalogDiagnosticEvidence: ProviderModelEvidence,
  routeConfig: KilnManagedAgentRouteConfig,
  model: string,
): ProviderModelEvidence {
  const observedAt = new Date().toISOString();
  const routeObservations = [
    managedRouteObservation("configured", "confirmed", "operator-declared", routeConfig.id, observedAt),
    managedRouteObservation("authenticated", "confirmed", "runtime-observed", routeConfig.provider, observedAt),
    managedRouteObservation("capabilityCompatible", "confirmed", "runtime-observed", routeConfig.id, observedAt),
    managedRouteObservation("policyAdmitted", "confirmed", "operator-declared", routeConfig.id, observedAt),
    managedRouteObservation("routeHealthy", "confirmed", "runtime-observed", routeConfig.id, observedAt),
  ];
  return createProviderModelEvidence({
    identity: {
      ...catalogDiagnosticEvidence.identity,
      route: {
        providerId: routeConfig.provider,
        providerModelId: model,
        scope: catalogDiagnosticEvidence.identity.route.scope,
      },
    },
    aliases: catalogDiagnosticEvidence.aliases,
    states: {
      ...catalogDiagnosticEvidence.states,
      configured: "confirmed",
      authenticated: "confirmed",
      capabilityCompatible: "confirmed",
      policyAdmitted: "confirmed",
      routeHealthy: "confirmed",
    },
    observations: [
      ...catalogDiagnosticEvidence.observations,
      ...routeObservations,
    ],
    failures: catalogDiagnosticEvidence.failures,
  });
}

function managedRouteObservation(
  state: ProviderModelEvidenceState,
  value: ProviderModelEvidenceValue,
  authority: ProviderModelEvidenceObservation["authority"],
  id: string,
  observedAt: string,
): ProviderModelEvidenceObservation {
  return {
    state,
    value,
    provenance: `managed-agent-route:${state}`,
    authority,
    source: {
      kind: "managed-agent-route",
      id,
    },
    observedAt,
    freshness: "fresh",
  };
}

function isProviderAvailable(
  context: ResolveManagedInvocationToolOptionsContext,
  provider: string,
): boolean {
  if (context.isProviderAvailable?.(provider) === false) {
    return false;
  }
  const descriptor = context.registry.list().find((entry) => entry.id === provider);
  if (!descriptor || descriptor.health === "suppressed") {
    return false;
  }
  try {
    return descriptor.isAvailable?.() !== false;
  } catch {
    return false;
  }
}

function createHarnessSessionFactory(
  provider: ProviderId,
  model: string,
  context: ResolveManagedInvocationToolOptionsContext,
  harnessExecutable: ClaudeCodeExecutableResolution | undefined,
): CliSessionFactory {
  return (systemPrompt, cwd, factoryContext) => {
    const config: ProviderCreateConfig = {
      task: systemPrompt,
      systemPrompt,
      cwd,
      permissionPolicy: factoryContext?.permissionPolicy ?? {
        approval: "on-request",
        sandbox: "read-only",
      },
      model,
      sessionLedgerOwner: "host",
      ...(harnessExecutable
        ? {
            harnessExecutable: harnessExecutable.path,
            harnessEvidence: harnessExecutable.evidence,
          }
        : {}),
      ...(factoryContext?.structuredOutput ? { structuredOutputSchema: factoryContext.structuredOutput.schema } : {}),
      ...(factoryContext?.operatorSurface ? { operatorSurface: factoryContext.operatorSurface } : {}),
    };
    return context.registry.createSession(provider, config);
  };
}

function createManagedInvocationService(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
  existingService: RuntimeManagedAgentInvocationService | undefined,
  existingServiceKey: string | undefined,
  managedAccountComposition: ManagedAccountRuntimeComposition | undefined,
): RuntimeManagedAgentInvocationService | undefined {
  const serviceKey = managedInvocationServiceKey(config, cwd);
  if (!serviceKey) {
    return undefined;
  }
  if (existingService && existingServiceKey === serviceKey) {
    return existingService;
  }
  const leaseConfig = config.managedAgents?.worktreeLease;
  const routeConfigs = resolveRouteConfigs(config).map((route) => route.routeConfig);
  const needsWorktreeLease = leaseConfig !== undefined && routeConfigs.some((route) => route.workingDirectory === "isolated-worktree");
  const needsSandboxLease = routeConfigs.some(routeUsesRuntimeSandboxLease);
  const credentialRouteIds = collectRuntimeCredentialRouteIds(routeConfigs);
  if (credentialRouteIds.length > 0 && managedAccountComposition === undefined) {
    throw new Error("Runtime-selected managed routes require a configured modelGateway account policy.");
  }

  return new RuntimeManagedAgentInvocationService({
    authorityObserver: createCliManagedRuntimeAuthorityObserver(),
    ...(needsWorktreeLease && leaseConfig ? {
      worktreeLeaseManager: new ManagedGitWorktreeLeaseManager({
        repositoryPath: cwd,
        worktreeRootPath: normalizeManagedRoutePath(leaseConfig.rootPath, cwd),
        ...(leaseConfig.ref ? { ref: leaseConfig.ref } : {}),
        ...(leaseConfig.gitBinary ? { gitBinary: leaseConfig.gitBinary } : {}),
      }),
    } : {}),
    ...(needsSandboxLease ? {
      sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
    } : {}),
    ...(credentialRouteIds.length > 0 ? {
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: credentialRouteIds,
      }),
      recoveryStore: new ManagedFilesystemRuntimeRecoveryStore({
        rootPath: join(cwd, ".kiln", "runtime", "managed-invocation-recovery"),
      }),
    } : {}),
  });
}

export function createManagedAccountRuntimeComposition(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
): ManagedAccountRuntimeComposition | undefined {
  const hasRuntimeSelectedRoute = resolveRouteConfigs(config)
    .some(({ routeConfig }) => routeConfig.credentials?.mode === "runtime-selected");
  const economicRouteIds = new Set(
    config.managedAgents?.economicPolicies?.flatMap((policy) =>
      policy.candidates.map((candidate) => candidate.routeId)) ?? [],
  );
  const hasManagedEconomicRoute = resolveRouteConfigs(config).some(({ routeConfig }) =>
    economicRouteIds.has(routeConfig.id)
    && routeConfig.credentials?.mode === "credentialless"
    && routeConfig.credentials.economicsRouteId !== undefined
  );
  if (!hasRuntimeSelectedRoute && !hasManagedEconomicRoute) return undefined;
  if (!config.modelGateway) {
    throw new Error("Managed account or economic routes require modelGateway configuration.");
  }
  const compositionKey = resolve(cwd);
  const existing = MANAGED_ACCOUNT_COMPOSITIONS.get(compositionKey);
  if (existing) {
    existing.updateConfig(config.modelGateway);
    return existing;
  }
  const runtimeDirectory = join(compositionKey, ".kiln", "runtime");
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const routing = new ConfiguredManagedAccountRuntime({ config: config.modelGateway });
  const authority = new SqliteManagedAccountLeaseAuthority({
    path: join(runtimeDirectory, "managed-account-leases.sqlite"),
  });
  try {
    for (const commitment of authority.recoverCommitments()) {
      if (commitment.state === "held") {
        authority.releaseCommitmentPreFence(
          commitment.commitment.reservation.jobId,
          commitment.commitment.reservation.economicAttemptId,
        );
      }
    }
  } catch (error) {
    authority.close();
    throw new Error("Managed account startup recovery failed.", { cause: error });
  }
  const composition: ManagedAccountRuntimeComposition = {
    routing,
    authority,
    updateConfig(next) {
      routing.updateConfig(next);
    },
    close() {
      authority.close();
    },
  };
  MANAGED_ACCOUNT_COMPOSITIONS.set(compositionKey, composition);
  return composition;
}

/** Releases the process-scoped authority when its owning application lifecycle ends. */
export function closeManagedAccountRuntimeComposition(cwd: string): void {
  const compositionKey = resolve(cwd);
  const composition = MANAGED_ACCOUNT_COMPOSITIONS.get(compositionKey);
  if (!composition) return;
  MANAGED_ACCOUNT_COMPOSITIONS.delete(compositionKey);
  composition.close();
}

function createCliManagedRuntimeAuthorityObserver(): ManagedAgentRuntimeAuthorityObserver {
  return {
    observe: async ({ request }) => {
      const observedAt = new Date();
      const validUntil = new Date(observedAt.getTime() + 60000);
      return {
        approval: observedApprovalForManagedAuthority(request.authority),
        sandbox: observedSandboxForManagedAuthority(request.authority),
        source: "runtime-observation",
        proof: "proven",
        observedAt: observedAt.toISOString(),
        validUntil: validUntil.toISOString(),
        reason: "CLI managed route was admitted by Kiln route resolution with live-proven managed invocation capability.",
      };
    },
  };
}

function observedApprovalForManagedAuthority(
  authority: ManagedAgentAuthorityProfile,
): "never" | "on-request" {
  const profile = authority.permissionProfile.toLowerCase();
  return profile.includes("trusted")
    || profile.includes("full-access")
    || profile.includes("danger-full-access")
    ? "never"
    : "on-request";
}

function observedSandboxForManagedAuthority(
  authority: ManagedAgentAuthorityProfile,
): "read-only" | "workspace-write" {
  return authority.toolAuthority.writeAllowed === true && authority.workingDirectory.mode !== "read-only"
    ? "workspace-write"
    : "read-only";
}

function managedInvocationServiceKey(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
): string | undefined {
  const routeConfigs = resolveRouteConfigs(config).map((route) => route.routeConfig);
  const leaseConfig = config.managedAgents?.worktreeLease;
  const needsWorktreeLease = leaseConfig !== undefined && routeConfigs.some((route) => route.workingDirectory === "isolated-worktree");
  const needsSandboxLease = routeConfigs.some(routeUsesRuntimeSandboxLease);
  const credentialRouteIds = collectRuntimeCredentialRouteIds(routeConfigs);
  if (!needsWorktreeLease && !needsSandboxLease && credentialRouteIds.length === 0) {
    return undefined;
  }
  return JSON.stringify({
    ...(needsWorktreeLease && leaseConfig ? {
      worktreeLease: {
        mode: leaseConfig.mode,
        repositoryPath: normalizeManagedRoutePath(cwd, cwd),
        rootPath: normalizeManagedRoutePath(leaseConfig.rootPath, cwd),
        ref: leaseConfig.ref ?? "HEAD",
        gitBinary: leaseConfig.gitBinary ?? "git",
      },
    } : {}),
    ...(needsSandboxLease ? {
      sandboxPolicy: {
        mode: "kiln-tool-policy",
        rootPath: normalizeManagedRoutePath(cwd, cwd),
      },
    } : {}),
    ...(credentialRouteIds.length > 0 ? { credentialRouteIds } : {}),
  });
}

function routeUsesRuntimeSandboxLease(route: KilnManagedAgentRouteConfig): boolean {
  return route.workingDirectory === "sandbox"
    && (route.kind === "direct" || route.remoteHarness !== undefined);
}

function collectRuntimeCredentialRouteIds(
  routeConfigs: readonly KilnManagedAgentRouteConfig[],
): readonly string[] {
  const routeIds = new Set<string>();
  for (const routeConfig of routeConfigs) {
    const credentialRoute = resolveCredentialRoute(routeConfig);
    if (credentialRoute.mode !== "credentialless") {
      routeIds.add(credentialRoute.routeId);
    }
  }
  return [...routeIds].sort((left, right) => left.localeCompare(right));
}

function resolveWorkingDirectory(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): ManagedAgentWorkingDirectory {
  if (routeConfig.workingDirectory === "isolated-worktree" && workingDirectoryLease) {
    return {
      path: workingDirectoryLease.rootPath,
      mode: "isolated-worktree",
    };
  }
  if (routeConfig.workingDirectory === "sandbox") {
    return {
      path: cwd,
      mode: "sandbox",
    };
  }
  return {
    path: cwd,
    mode: "read-only",
  };
}

function resolveWriteWorkingDirectory(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  applyApproved: boolean,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): ManagedAgentWorkingDirectory {
  if (routeConfig.workingDirectory === "isolated-worktree" && workingDirectoryLease) {
    return {
      path: workingDirectoryLease.rootPath,
      mode: "isolated-worktree",
    };
  }
  if (routeConfig.workingDirectory === "sandbox") {
    return {
      path: cwd,
      mode: "sandbox",
    };
  }
  return {
    path: cwd,
    mode: applyApproved ? "workspace-write" : "read-only",
  };
}

function resolveWorkingDirectoryLease(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  config: KilnManagedAgentsConfig["worktreeLease"] | undefined,
): {
  readonly ok: true;
  readonly lease?: ManagedInvocationRouteProfile["workingDirectoryLease"];
} | {
  readonly ok: false;
  readonly reason: string;
} {
  if (routeConfig.workingDirectory !== "isolated-worktree") {
    return { ok: true };
  }
  if (!config) {
    return {
      ok: false,
      reason: "isolated-worktree managed invocation routes require managedAgents.worktreeLease.rootPath.",
    };
  }
  return {
    ok: true,
    lease: {
      mode: "git-worktree",
      sourcePath: cwd,
      rootPath: normalizeManagedRoutePath(config.rootPath, cwd),
    },
  };
}

function normalizeManagedRoutePaths(paths: readonly string[], cwd: string): readonly string[] {
  return paths.map((path) => normalizeManagedRoutePath(path, cwd));
}

function defaultManagedWorkspaceDeniedPaths(cwd: string, allowedPaths: readonly string[]): readonly string[] {
  return uniqueStrings([cwd, ...allowedPaths].flatMap((rootPath) =>
    DEFAULT_MANAGED_WORKSPACE_DENIED_ENTRIES.map((entry) => normalizeManagedRoutePath(joinManagedRoutePath(rootPath, entry), cwd))
  ));
}

function joinManagedRoutePath(rootPath: string, childPath: string): string {
  if (posix.isAbsolute(rootPath)) {
    return posix.join(rootPath, childPath);
  }
  if (win32.isAbsolute(rootPath)) {
    return win32.join(rootPath, childPath);
  }
  return resolve(rootPath, childPath);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function normalizeManagedRoutePath(path: string, cwd: string): string {
  if (posix.isAbsolute(path)) {
    return posix.normalize(path);
  }
  if (win32.isAbsolute(path)) {
    return win32.normalize(path);
  }
  if (posix.isAbsolute(cwd)) {
    return posix.resolve(cwd, path);
  }
  if (win32.isAbsolute(cwd)) {
    return win32.resolve(cwd, path);
  }
  return resolve(cwd, path);
}

function isPathWithinOrEqual(rootPath: string, candidatePath: string): boolean {
  const caseInsensitive = isCaseInsensitivePath(rootPath) || isCaseInsensitivePath(candidatePath);
  const root = normalizeComparablePath(rootPath, caseInsensitive);
  const candidate = normalizeComparablePath(candidatePath, caseInsensitive);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function normalizeComparablePath(path: string, caseInsensitive: boolean): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function isCaseInsensitivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * Roadmap 01 Slice 3.1 (F6) - reads a route's declared external-runtime
 * attachment from real config, not just test fixtures. Requires both fields
 * non-empty; a partially-configured attachment (e.g. blank attachmentId) is
 * rejected rather than silently treated as "no attachment". The identities
 * are opaque, so a non-empty value is persisted exactly as configured -
 * trimming here would make the route address a different instance than the
 * operator declared.
 */
function resolveRouteExternalRuntimeAttachment(
  routeConfig: KilnManagedAgentRouteConfig,
): ManagedAgentExternalRuntimeAttachmentIdentity | undefined {
  const config = routeConfig.externalRuntimeAttachment;
  if (!config) {
    return undefined;
  }
  const { runtimeId, attachmentId } = config;
  if (!isOpaqueAttachmentIdentity(runtimeId) || !isOpaqueAttachmentIdentity(attachmentId)) {
    throw new Error(
      `Managed invocation route '${routeConfig.id}' externalRuntimeAttachment requires non-empty runtimeId and attachmentId.`,
    );
  }
  return { kind: "external-runtime", runtimeId, attachmentId };
}

function isOpaqueAttachmentIdentity(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveCredentialRoute(
  routeConfig: KilnManagedAgentRouteConfig,
): ManagedAgentCredentialRoute {
  if (routeConfig.credentials?.mode === "credentialless") {
    return { mode: "credentialless" };
  }
  const configuredRouteId = routeConfig.credentials?.mode === "runtime-selected"
    ? routeConfig.credentials.routeId?.trim()
    : undefined;
  if (routeConfig.credentials?.mode !== "runtime-selected") {
    throw new Error(`Managed invocation route '${routeConfig.id}' requires an explicit runtime-selected account policy.`);
  }
  return {
    mode: "account-leased",
    routeId: configuredRouteId
      ? configuredRouteId
      : `credential-route:${routeConfig.provider}:runtime-selected`,
    accountPolicyId: createAccountPolicyId(routeConfig.credentials.accountPolicyId),
  };
}

function resolveMemoryScope(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  accessOverride?: ManagedAgentMemoryScope["access"],
): ManagedAgentMemoryScope {
  return {
    scope: {
      kind: "project",
      id: basename(cwd.replace(/\\/g, "/")) || "project",
    },
    access: accessOverride ?? routeConfig.memory?.access ?? "read-only",
  };
}

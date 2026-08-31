import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import type {
  ArtifactResourceStore,
  DefaultBuiltinToolRegistryOptions,
  ManagedAgentAccess,
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
  ExecutionTargetCatalog,
  AdmittedExecutionTarget,
  ManagedEconomicAdoptedSnapshotExpectation,
  ManagedEconomicPriceEvidence,
  ModelDeliberationCapabilities,
  RouteCapability,
} from "@kilnai/core";
import {
  adoptManagedEconomicSnapshot,
  createExecutionAccountRef,
  createExecutionAccountPolicyId,
  createProviderModelEvidence,
  defineManagedAgentReadAuthority,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  deriveProviderModelEligibility,
  digestManagedEconomicValue,
  isDirectProviderId,
} from "@kilnai/core";
import {
  createAttachedRuntimeBuiltinToolSurface,
  ConfiguredExecutionAccountRuntime,
  resolveClaudeCodeExecutable,
  resolveOpenCodeExecutable,
  type ClaudeCodeExecutableResolution,
  type OpenCodeExecutableResolution,
  ManagedCliHarnessAdapter,
  ManagedCommittedRouteMismatchError,
  ManagedEconomicDispatchCoordinator,
  AgentTaskApplicationError,
  ManagedFilesystemRuntimeRecoveryStore,
  ManagedGitWorktreeLeaseManager,
  ManagedRemoteHarnessAdapter,
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
  SqliteManagedAccountLeaseAuthority,
  digestManagedEconomicCandidateProfileAuthority,
  resolveConfiguredManagedInvocationRouteProfile,
  type ManagedAgentRuntimeAdapter,
  type ManagedInvocationAgentCatalogEntry,
  type ManagedCommittedInvocationRequest,
  type ManagedInvocationRouteProfile,
  type ManagedInvocationToolOptions,
  type ManagedInvocationToolRoute,
  type ManagedEconomicCandidateSet,
  type ManagedEconomicDispatchAuthorityPort,
  type AgentTaskEconomicAdoption,
  type AgentTaskRecord,
} from "@kilnai/runtime";
import type {
  ManagedAgentProviderModelCatalogDiagnostic,
  ManagedAgentProviderModelCatalogDiagnostics,
} from "./managed-agent-provider-models.js";
import type { CliSessionFactory } from "@kilnai/runtime";
import type {
  KilnManagedAgentsConfig,
  KilnManagedAgentAccess,
  KilnModelTaskSuitabilityOverride,
  KilnYamlSkillsConfig,
  KilnAuthorityProfileConfig,
  KilnTargetCatalogIntentConfig,
  KilnDeliberationPolicyConfig,
} from "../kiln-yaml-types.js";
import type { ExecutionTargetEvidenceSnapshot } from "./execution-target-evidence-store.js";
import {
  deriveManagedAgentEconomicPolicies,
  type DerivedManagedAgentEconomicPolicy,
} from "./managed-agent-intent.js";
import type {
  ProviderCreateConfig,
  ProviderId,
  SessionRegistry,
} from "../wrapper/session-registry.js";
import {
  resolveClaudePrivatePlanArtifactCapability,
  type ClaudePrivatePlanArtifactCapability,
} from "../wrapper/claude-private-plan-artifacts.js";
import type { DirectProviderCredentialBinding } from "../wrapper/direct-provider-adapter-factory.js";
import { TranscriptStore } from "../wrapper/session-store.js";
import { TranscriptAuthorityAdmissionEvidenceStore } from "../application/authority-admission-evidence-store.js";
import { SqliteManagedExternalInvocationActionClaimStore } from "../application/managed-external-invocation-action-claim-store.js";
import { createManagedInvocationContextResolver } from "./managed-invocation-context-resolver.js";
import { loadAgentDefinitions, type KilnAgentDefinition } from "../application/agent-loader.js";
import { readConfiguredSkillCatalogStatus } from "./skill-catalog-status.js";
import { resolveConfiguredModelTaskSuitability } from "./model-task-suitability.js";
import { admitManagedDirectTarget } from "./managed-direct-target-admission.js";
import type { ResolvedManagedTargetConfig } from "./resolved-managed-target.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../application/project-state-root.js";

type ManagedSkillCatalogEntry = NonNullable<ManagedInvocationToolOptions["skillCatalog"]>[number];

interface ManagedRouteProjection {
  readonly routeId: string;
  readonly kind: ResolvedManagedTargetConfig["kind"];
  readonly providerId: string;
  readonly providerModelId?: string;
  readonly admission?: AdmittedExecutionTarget;
}

/** Projects a resolved physical target into the Runtime route contract. */
function projectManagedRoute(
  routeConfig: ResolvedManagedTargetConfig,
  executionCatalog: ExecutionTargetCatalog | undefined,
): ManagedRouteProjection {
  if (routeConfig.kind === "direct") {
    const projection = admitManagedDirectTarget(executionCatalog, routeConfig);
    return {
      routeId: routeConfig.id,
      kind: routeConfig.kind,
      providerId: projection.admission.providerId,
      providerModelId: projection.admission.providerModelId,
      admission: projection.admission,
    };
  }
  return {
    routeId: routeConfig.id,
    kind: routeConfig.kind,
    providerId: routeConfig.provider,
    ...(routeConfig.model ? { providerModelId: routeConfig.model } : {}),
  };
}

function managedRouteCapability(input: {
  readonly route: ResolvedManagedTargetConfig;
  readonly provider: string;
  readonly model: string;
  readonly profiles: ManagedInvocationToolRoute["profiles"];
  readonly adapterKind: RouteCapability["adapter"]["kind"];
  readonly settlement: RouteCapability["settlement"];
  readonly provenAccess?: readonly ManagedAgentAccess[];
  readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
  /** Direct-target capacity authority is the catalog policy. */
  readonly accountPolicyId?: string;
}): RouteCapability {
  const routeProfiles = input.profiles;
  const accessLevels = [...new Set(routeProfiles.map((profile) => profile.access))];
  const write = routeProfiles.some((profile) => profile?.writeAllowed === true)
    && (input.provenAccess ?? accessLevels).some((access) => WRITE_ACCESS.has(access as KilnManagedAgentAccess));
  const revision = digestManagedEconomicValue({
    route: input.route,
    provider: input.provider,
    model: input.model,
    profiles: input.profiles,
    adapterKind: input.adapterKind,
    settlement: input.settlement,
    provenAccess: input.provenAccess ?? accessLevels,
    externalRuntimeAttachment: input.externalRuntimeAttachment,
    accountPolicyId: input.accountPolicyId,
  });
  return {
    identity: { routeId: input.route.id, revision },
    target: { providerId: input.provider, modelId: input.model },
    adapter: { kind: input.adapterKind, capabilityId: `managed:${input.route.id}`, capabilityVersion: "v1" },
    authorityCeiling: write ? "destructive" : "read_only",
    toolNames: [...new Set(routeProfiles.flatMap((profile) => profile?.allowedToolNames ?? []))],
    supportsRecursion: true,
    supportsAttachments: input.externalRuntimeAttachment !== undefined,
    supportsWrite: write,
    ...(input.externalRuntimeAttachment ? { externalRuntimeAttachment: input.externalRuntimeAttachment } : {}),
    proof: { status: "configured", source: "provider-adapter-catalog", provenAccess: accessLevels.filter((access) => (input.provenAccess ?? accessLevels).includes(access)) },
    capacity: input.route.kind === "direct" && input.accountPolicyId
      ? { kind: "policy-bound", accountPolicyId: input.accountPolicyId }
      : { kind: "accountless" },
    settlement: input.settlement,
  };
}

export type ManagedAgentOperatorSurface = "gui" | "tui" | "run" | "operator";

export interface ManagedAgentRouteHealth {
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly kind: "harness" | "direct";
  readonly provider: string;
  readonly model?: string;
  readonly accessLevels: readonly ManagedAgentAccess[];
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
  /** Established private binding; production compositions should pass it when already resolved. */
  readonly projectStateBinding?: ProjectStateBinding;
  /** Exact operator-private Runtime state root supplied by CLI composition. */
  readonly runtimeStateRoot?: string;
  readonly registry: SessionRegistry;
  readonly surface: ManagedAgentOperatorSurface;
  readonly isProviderAvailable?: (provider: string) => boolean | undefined;
  /**
   * Operator Claude Code executable resolution.  Injectable so route admission
   * stays deterministic and network-free in tests; production defaults to the
   * one canonical resolver shared with model discovery.
   */
  readonly resolveClaudeExecutable?: () => ClaudeCodeExecutableResolution | undefined;
  readonly resolveOpenCodeExecutable?: () => OpenCodeExecutableResolution | undefined;
  readonly providerModelEligibility?: ManagedAgentProviderModelCatalogDiagnostics;
  readonly includeUnavailableRoutes?: boolean;
  readonly directAdapterFactory?: (
    route: ResolvedManagedTargetConfig,
    credentialBinding: DirectProviderCredentialBinding | undefined,
    abortSignal: AbortSignal | undefined,
    committedRequest: ManagedCommittedInvocationRequest,
    profile: ManagedInvocationRouteProfile,
  ) => ManagedAgentRuntimeAdapter | Promise<ManagedAgentRuntimeAdapter | undefined> | undefined;
  readonly builtinToolOptions?: BuiltinToolOptionsSource;
  readonly artifactStore?: ArtifactResourceStore;
  readonly invocationService?: RuntimeManagedAgentInvocationService;
  readonly invocationServiceKey?: string;
  readonly userHome?: string;
  readonly maxParallelChildren?: number;
  readonly managedAccountComposition?: ManagedAccountRuntimeComposition;
  readonly managedEconomicAuthority?: ManagedEconomicDispatchAuthorityPort;
  readonly managedAccountRouting?: ConfiguredExecutionAccountRuntime;
  /** Candidate admission projects static route evidence without constructing execution owners. */
  readonly compositionMode?: "execution" | "candidate-admission";
  /** Internal staged-catalog signal: recover only when constructing its cold-start owner. */
  readonly recoverPersistedInvocationsOnConstruct?: boolean;
}

type BuiltinToolOptionsSource = DefaultBuiltinToolRegistryOptions | (() => DefaultBuiltinToolRegistryOptions | undefined);

interface ManagedAgentRouteConfigProjection {
  readonly routeConfig: ResolvedManagedTargetConfig;
  readonly routeSource: ManagedAgentRouteSource;
}

export interface ManagedAgentRouteConfigSource {
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  readonly skills?: KilnYamlSkillsConfig;
  readonly engines?: Record<string, { readonly enabled?: boolean }>;
  readonly executionCatalog?: ExecutionTargetCatalog;
  readonly executionTargetEvidence?: ExecutionTargetEvidenceSnapshot;
  readonly targetCatalog?: KilnTargetCatalogIntentConfig;
  readonly targetRouting?: { readonly defaultTargetId: string };
  readonly authorityProfiles?: readonly KilnAuthorityProfileConfig[];
  readonly deliberationPolicy?: KilnDeliberationPolicyConfig;
}

export interface ManagedAccountRuntimeComposition {
  readonly routing: ConfiguredExecutionAccountRuntime;
  readonly authority: SqliteManagedAccountLeaseAuthority;
  updateCatalog(config: ExecutionTargetCatalog): void;
  close(): void;
}

export type ManagedEconomicAdoptionSubject = Pick<
  AgentTaskRecord,
  | "adoptedDecisionAt"
  | "projectId"
  | "callerId"
  | "parent"
> & {
  readonly dispatch: Extract<AgentTaskRecord["dispatch"], { readonly kind: "economic" }>;
};

/** Projects validated config and persisted admission into immutable Core evidence. */
export async function projectManagedEconomicJobAdoption(
  config: ManagedAgentRouteConfigSource,
  job: ManagedEconomicAdoptionSubject,
  routing: ConfiguredExecutionAccountRuntime,
): Promise<AgentTaskEconomicAdoption> {
  if (!isManagedEconomicAdoptionSubject(job)) {
    throw new AgentTaskApplicationError(
      "identity-revision-conflict",
      "Restore the exact persisted managed economic dispatch contract.",
    );
  }
  const managed = config.managedAgents;
  const executionCatalog = resolveSourceExecutionTargetCatalog(config);
  const dispatch = job.dispatch;
  const policy = deriveManagedAgentEconomicPolicies({
    managedAgents: managed,
    executionCatalog,
    defaultTargetId: config.targetRouting?.defaultTargetId,
    targetEvidenceRevision: config.targetCatalog?.evidenceRevision,
  }).find((entry) =>
    entry.id === dispatch.economicPolicyId && entry.revision === dispatch.economicPolicyRevision);
  if (!managed || !policy || !executionCatalog) {
    throw new AgentTaskApplicationError(
      "identity-revision-conflict",
      "Restore the exact persisted managed economic policy revision.",
    );
  }
  const admitted = admittedEconomicIdentities(dispatch.candidateSet);
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
    .filter((candidate) => admitted.some((identity) => identity.routeId === candidate.targetId))
    .map((candidate) => {
      const admittedIdentity = admitted.find((identity) => identity.routeId === candidate.targetId)!;
      const routeConfig = resolveRouteConfigs(config).find((entry) => entry.routeConfig.id === candidate.targetId)?.routeConfig;
      const domain = domains.find((entry) => entry.id === candidate.comparisonDomainId);
      const projection = routeConfig ? projectManagedRoute(routeConfig, executionCatalog) : undefined;
      const economicsRoute = projection
        ? executionCatalog.targets.find((entry) => entry.id === projection.routeId)
        : undefined;
      const economics = economicsRoute?.economics;
      const configuredExecutionAccountPolicyId = projection?.admission?.accountSelection.kind === "policy"
        ? projection.admission.accountSelection.accountPolicyId
        : null;
      if (!routeConfig || routeConfig.kind !== "direct" || !projection || !economicsRoute || !domain || !economics) {
        throw new AgentTaskApplicationError(
          "identity-revision-conflict",
          `Restore managed economic target '${candidate.targetId}' and its exact revision.`,
        );
      }
      if (
        economicsRoute.providerId !== admittedIdentity.providerId
        || economicsRoute.providerModelId !== admittedIdentity.modelId
        || economics.adapterCapabilityId !== admittedIdentity.adapterCapabilityId
        || economics.adapterCapabilityVersion !== admittedIdentity.adapterCapabilityVersion
        || (configuredExecutionAccountPolicyId === null
          ? admittedIdentity.accountPolicy.kind !== "accountless"
          : admittedIdentity.accountPolicy.kind !== "account-bound"
            || admittedIdentity.accountPolicy.accountPolicyId !== configuredExecutionAccountPolicyId)
      ) {
        throw new AgentTaskApplicationError(
          "identity-revision-conflict",
          `Restore managed economic target '${candidate.targetId}' and its exact admitted identity.`,
        );
      }
      const unitRates = "unitPrices" in economics.priceEvidence
        ? economics.priceEvidence.unitPrices
        : [];
      const unitScheduleDigest = digestManagedEconomicValue(unitRates);
      const auxiliaryScheduleDigest = digestManagedEconomicValue(economics.auxiliaryCharges);
      const envelopeDigest = digestManagedEconomicValue(economics.executionEnvelope);
      const priceIdentity = {
        providerId: economicsRoute.providerId,
        modelId: economicsRoute.providerModelId,
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
          routeId: candidate.targetId,
          providerId: economicsRoute.providerId,
          modelId: economicsRoute.providerModelId,
          adapterCapabilityId: economics.adapterCapabilityId,
          adapterCapabilityVersion: economics.adapterCapabilityVersion,
          authBillingChannel: economics.authBillingChannel,
          executionMode: economics.executionMode,
          serviceTier: economics.serviceTier,
          accountPolicyId: configuredExecutionAccountPolicyId,
          fallbackPosture: economics.fallbackPosture,
          overagePosture: economics.overagePosture,
          rateCardId: economics.priceEvidence.rateCardId,
          rateCardRevision: economics.priceEvidence.rateCardRevision,
          priceEvidenceDigest: economics.priceEvidence.evidence.sourceDigest,
          priceClass: economics.priceEvidence.kind,
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
    throw new AgentTaskApplicationError(
      "identity-revision-conflict",
      "Restore the exact persisted managed economic candidate set.",
    );
  }
  const callerConstraints = {
    ...(dispatch.constraints.routeId ? { routeIds: [dispatch.constraints.routeId] } : {}),
    ...(dispatch.constraints.providerId ? { providerIds: [dispatch.constraints.providerId] } : {}),
    ...(dispatch.constraints.model ? { modelIds: [dispatch.constraints.model] } : {}),
  };
  const snapshot = adoptManagedEconomicSnapshot({
    policy: {
      policyId: policy.id,
      schemaVersion: 2,
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
    policyId: dispatch.economicPolicyId,
    policyRevision: dispatch.economicPolicyRevision,
    candidateSetDigest: snapshot.candidateSetDigest,
    admittedCandidates: admitted,
    callerConstraints,
  };
  const routeCapacity = await Promise.all(routes.map(async (route) => {
    const managedRoute = resolveRouteConfigs(config).find((entry) => entry.routeConfig.id === route.route.routeId)?.routeConfig;
    if (!managedRoute || managedRoute.kind !== "direct" || !executionCatalog) {
      throw new AgentTaskApplicationError(
        "identity-revision-conflict",
        `Restore managed economic route '${route.route.routeId}' and its execution catalog reference.`,
      );
    }
    const admission = admitManagedDirectTarget(executionCatalog, managedRoute).admission;
    const canonicalTargetId = admission.targetId;
    const candidates = await routing.modelGatewayCandidates.resolve({
      admission,
      route: {
        routeId: canonicalTargetId,
        providerId: route.route.providerId,
        providerModelId: route.route.modelId,
        // The account authority compares candidate and commitment routes
        // exactly. This is the managed-economic commitment scope, not a
        // transient adoption-step label.
        scope: `economic:${canonicalTargetId}`,
      },
    });
    const capacity = {
      routeId: canonicalTargetId,
      route: {
        providerId: route.route.providerId,
        providerModelId: route.route.modelId,
        scope: `economic:${canonicalTargetId}`,
      },
      affinityRequest: { continuity: "none" as const },
      candidates: candidates.map(({ lease }) => lease),
    };
    return capacity;
  }));
  return { snapshot, expectation, routeCapacity };
}

function admittedEconomicIdentities(candidateSet: ManagedEconomicCandidateSet) {
  return candidateSet.candidates.map((candidate) => ({
    routeId: candidate.routeId,
    sourceIdentity: candidate.routeSource,
    providerId: candidate.providerId,
    modelId: candidate.model ?? "",
    adapterCapabilityId: candidate.adapterCapabilityId,
    adapterCapabilityVersion: candidate.adapterCapabilityVersion,
    profileAuthorityDigest: candidate.profileAuthorityDigest,
    accountPolicy: candidate.accountPolicyId
      ? { kind: "account-bound" as const, accountPolicyId: candidate.accountPolicyId }
      : { kind: "accountless" as const },
  }));
}

function isManagedEconomicAdoptionSubject(value: unknown): value is ManagedEconomicAdoptionSubject {
  if (!isObjectRecord(value)) return false;
  if (
    !isNonEmptyText(value.projectId)
    || !isNonEmptyText(value.callerId)
    || !isIsoTimestamp(value.adoptedDecisionAt)
    || (value.parent !== undefined && (
      !isObjectRecord(value.parent)
      || !isNonEmptyText(value.parent.invocationId)
      || !isNonEmptyText(value.parent.turnId)
    ))
  ) return false;
  const dispatch = value.dispatch;
  if (
    !isObjectRecord(dispatch)
    || dispatch.kind !== "economic"
    || !isNonEmptyText(dispatch.economicAttemptId)
    || !isNonEmptyText(dispatch.economicPolicyId)
    || !isNonEmptyText(dispatch.economicPolicyRevision)
    || !isObjectRecord(dispatch.constraints)
  ) return false;
  const candidateSet = dispatch.candidateSet;
  if (
    !isObjectRecord(candidateSet)
    || !isNonEmptyText(candidateSet.economicPolicyId)
    || !isNonEmptyText(candidateSet.economicPolicyRevision)
    || !isNonEmptyText(candidateSet.access)
    || !isObjectRecord(candidateSet.constraints)
    || !Array.isArray(candidateSet.candidates)
    || !Array.isArray(candidateSet.rejections)
  ) return false;
  return candidateSet.candidates.every((candidate) => (
    isObjectRecord(candidate)
    && isNonEmptyText(candidate.routeId)
    && isNonEmptyText(candidate.routeSource)
    && isNonEmptyText(candidate.providerId)
    && (candidate.model === undefined || isNonEmptyText(candidate.model))
    && (candidate.accountPolicyId === undefined || isNonEmptyText(candidate.accountPolicyId))
      && isNonEmptyText(candidate.adapterCapabilityId)
      && isNonEmptyText(candidate.adapterCapabilityVersion)
      && isCanonicalSha256(candidate.profileAuthorityDigest)
  ));
}

function isCanonicalSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyText(value) && Number.isFinite(Date.parse(value));
}

const READ_ONLY_ACCESS: KilnManagedAgentAccess = "read-only";
const WRITE_ACCESS = new Set<KilnManagedAgentAccess>([
  "propose",
  "approved-write",
]);
const DEFAULT_ALLOWED_TOOLS = ["read", "tree", "grep", "glob"] as const;
const DEFAULT_WRITE_ALLOWED_TOOLS = ["read", "tree", "grep", "glob", "write", "edit", "apply-patch"] as const;
const DEFAULT_MANAGED_WORKSPACE_DENIED_ENTRIES = [".git", "node_modules", ".kiln"] as const;
const DEFAULT_TIMEOUT_MS = 300000;
const CLAUDE_MOVING_MODEL_ALIASES = new Set<string>(["default", "sonnet", "opus", "haiku"]);
const LIVE_PROVEN_HARNESS_WRITE_AUTHORITY = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;
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
  const projectedExecutionTargetCatalog = resolveSourceExecutionTargetCatalog(config);
  if (projectedExecutionTargetCatalog && !config.executionCatalog) {
    config = { ...config, executionCatalog: projectedExecutionTargetCatalog };
  }

  const routeConfigs = resolveRouteConfigs(config);
  mark("managed-route-configs-resolved", { count: routeConfigs.length });
  if (routeConfigs.length === 0) {
    return { routeHealth: [] };
  }
  const routes: ManagedInvocationToolRoute[] = [];
  const routeHealth: ManagedAgentRouteHealth[] = [];
  const userHome = context.userHome;
  const projectStateBinding = context.projectStateBinding ?? resolveProjectStateBinding(context.cwd, {
    ...(context.userHome ? { kilnHome: join(context.userHome, ".kiln") } : {}),
  });
  const managedAccountRouting = context.managedAccountRouting
    ?? (context.managedEconomicAuthority && config.executionCatalog
      ? new ConfiguredExecutionAccountRuntime({ catalog: config.executionCatalog, kilnHome: projectStateBinding.kilnHome })
      : undefined);
  const routeContext = managedAccountRouting === context.managedAccountRouting
    ? context
    : { ...context, managedAccountRouting };
  const agentDefinitions = await loadAgentDefinitions(context.cwd, {
    ...(userHome ? { userHome } : {}),
    projectStateBinding,
  });
  mark("managed-route-agents-loaded", { count: agentDefinitions.length });
  const configuredAgentDefinitions = mergeManagedAgentIntentDefinitions(agentDefinitions, config.managedAgents);
  const derivedEconomicPolicies = deriveManagedAgentEconomicPolicies({
    managedAgents: config.managedAgents,
    executionCatalog: config.executionCatalog,
    defaultTargetId: config.targetRouting?.defaultTargetId,
    targetEvidenceRevision: config.targetCatalog?.evidenceRevision,
  });
  const economicPolicyHealth = validateManagedAgentEconomicPolicyBindings(
    configuredAgentDefinitions,
    routeConfigs,
    derivedEconomicPolicies,
  );
  const economicPolicyHealthByAgent = new Map(
    economicPolicyHealth.map((health) => [health.agentName, health]),
  );
  const skillCatalog = loadManagedInvocationSkillCatalog(context.cwd, userHome, projectStateBinding, config.skills);
  mark("managed-route-skills-loaded", { count: skillCatalog.length });

  let routeIndex = 0;
  const economicPolicyIdsByRoute = managedEconomicPolicyIdsByRoute(derivedEconomicPolicies);
  const economicCapabilityByRoute = managedEconomicCapabilitiesByRoute(
    config,
    routeConfigs.map((projection) => projection.routeConfig),
    economicPolicyIdsByRoute,
  );
  const deliberationCapabilitiesByRoute = managedDeliberationCapabilitiesByRoute(
    config,
    routeConfigs.map((projection) => projection.routeConfig),
    context.providerModelEligibility,
  );
  for (const routeConfig of routeConfigs) {
    routeIndex += 1;
    mark("managed-route-resolve-started", { routeIndex, routeId: routeConfig.routeConfig.id });
    const policyIds = economicPolicyIdsByRoute.get(routeConfig.routeConfig.id) ?? [];
    const resolved = await resolveRouteConfig(
      routeConfig,
      routeContext,
      config,
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
  const agentProjections = configuredAgentDefinitions
    .filter((agent) => agent.authorityProfileId !== undefined)
    .map((agent) => {
    const policyHealth = economicPolicyHealthByAgent.get(agent.name);
    return policyHealth
      ? { health: policyHealth }
      : projectManagedAgentCatalogEntry(
          agent,
          routes,
          config,
          derivedEconomicPolicies.find((candidate) => candidate.intentId === agent.name),
        );
  });
  const agentCatalog = agentProjections.flatMap((projection) => projection.entry ? [projection.entry] : []);
  const agentHealth = agentProjections.flatMap((projection) => projection.health ? [projection.health] : []);
  const configuredConcurrencyLimits = agentCatalog
    .map((entry) => entry.workLimits?.maxConcurrency)
    .filter((limit): limit is number => limit !== undefined);
  const maxParallelChildren = Math.min(
    context.maxParallelChildren ?? 1,
    ...(configuredConcurrencyLimits.length > 0 ? configuredConcurrencyLimits : [Number.POSITIVE_INFINITY]),
  );

  const unavailableRoutes = routeHealth
    .filter((route) => !route.available)
    .map((route) => {
      const routeConfig = routeConfigs.find(
        (candidate) => candidate.routeConfig.id === route.routeId,
      )?.routeConfig;
      const policyIds = economicPolicyIdsByRoute.get(route.routeId) ?? [];
      const economics = economicCapabilityByRoute.get(route.routeId);
      const accountPolicyId = routeConfig?.kind === "direct"
        ? (() => {
            try {
              const projection = projectManagedRoute(routeConfig, config.executionCatalog);
              return projection.admission?.accountSelection.kind === "policy"
                ? projection.admission.accountSelection.accountPolicyId
                : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined;
      return {
        routeId: route.routeId,
        ...(policyIds.length > 0 ? { economicPolicyIds: policyIds } : {}),
        ...(accountPolicyId ? { accountPolicyId } : {}),
        ...(economics ? { economicCapability: economics } : {}),
        routeSource: route.routeSource,
        providerId: route.provider,
        ...(route.model ? { model: route.model } : {}),
        accessLevels: route.accessLevels,
        reason: route.reason ?? "Route is unavailable.",
      };
    });
  const shouldExposeManagedInvocation = routes.length > 0
    || (context.includeUnavailableRoutes === true && unavailableRoutes.length > 0);
  const executionComposition = context.compositionMode !== "candidate-admission";
  const managedAccountComposition = executionComposition && !context.managedEconomicAuthority
    ? context.managedAccountComposition ?? createManagedAccountRuntimeComposition(config, context.cwd, {
        ...(context.runtimeStateRoot ? { runtimeStateRoot: context.runtimeStateRoot } : {}),
      })
    : undefined;
  if (managedAccountComposition && config.executionCatalog) {
    managedAccountComposition.updateCatalog(config.executionCatalog);
  }
  // Standalone resolution has no owner lifecycle when every route failed
  // admission, so it must not claim a fixed-path external action-claim store
  // that cannot be returned to a caller. The staged route catalog explicitly
  // asks for unavailable routes and owns the service across its refreshes, so
  // it may construct the service while provider evidence is still pending.
  const invocationService = executionComposition
    && (routes.length > 0 || context.includeUnavailableRoutes === true)
    ? await createManagedInvocationService(
        config,
        context.cwd,
        context.invocationService,
        context.invocationServiceKey,
        managedAccountComposition,
        context.runtimeStateRoot,
        projectStateBinding,
        context.managedEconomicAuthority !== undefined,
        context.recoverPersistedInvocationsOnConstruct !== false,
      )
    : undefined;
  const invocationServiceKey = executionComposition
    ? managedInvocationServiceKey(config, context.cwd)
    : undefined;
  const economicDispatch = context.managedEconomicAuthority && config.executionCatalog
    ? createManagedEconomicDispatchWithAuthority(
        config,
        context.cwd,
        routes,
        managedAccountRouting!,
        context.managedEconomicAuthority,
      ).port
    : managedAccountComposition
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
        maxParallelChildren,
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
          projectAgentsDirectory: projectStateBinding.agentsPath,
          projectSkillsDirectory: projectStateBinding.skillsPath,
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
  return createManagedEconomicDispatchWithAuthority(config, cwd, routes, composition.routing, {
    acquire: (input) => composition.authority.acquireCommitment(input),
    releasePreFence: (jobId, economicAttemptId) =>
      composition.authority.releaseCommitmentPreFence(jobId, economicAttemptId),
    fenceDispatch: (jobId, economicAttemptId, dispatchFenceId, actionClaim) =>
      composition.authority.fenceDispatch(jobId, economicAttemptId, dispatchFenceId, actionClaim),
    readDispatch: (jobId, economicAttemptId, dispatchFenceId, actionClaim) =>
      composition.authority.readDispatch(jobId, economicAttemptId, dispatchFenceId, actionClaim),
    settleExecution: (jobId, economicAttemptId, dispatchFenceId, settlement) =>
      composition.authority.settleExecution(jobId, economicAttemptId, dispatchFenceId, settlement),
    recordExecutionSettlementPending: (jobId, economicAttemptId, dispatchFenceId, reason) =>
      composition.authority.recordExecutionSettlementPending(jobId, economicAttemptId, dispatchFenceId, reason),
  });
}

function createManagedEconomicDispatchWithAuthority(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
  routes: readonly ManagedInvocationToolRoute[],
  routing: ConfiguredExecutionAccountRuntime,
  authority: ManagedEconomicDispatchAuthorityPort,
): {
  readonly coordinator: ManagedEconomicDispatchCoordinator;
  readonly port: NonNullable<ManagedInvocationToolOptions["economicDispatch"]>;
} {
  const coordinator = new ManagedEconomicDispatchCoordinator({
    authority,
    resolveLifecycleTimeoutMs: (commitment, access, authorityProfileId) => {
      const routeId = commitment.reservation.selectedIdentity.route.routeId;
      const route = routes.find((candidate) => candidate.routeId === routeId);
      if (!route) throw new Error(`Committed managed economic route '${routeId}' is not configured.`);
      const profile = resolveConfiguredManagedInvocationRouteProfile(
        route,
        { authorityProfileId, access },
        access,
      );
      if (!profile) throw new Error(`Committed managed economic route '${routeId}' does not admit '${access}'.`);
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
        dispatch: {
          kind: "economic",
          economicAttemptId: input.economicAttemptId,
          economicPolicyId: input.candidateSet.economicPolicyId,
          economicPolicyRevision: input.candidateSet.economicPolicyRevision,
          candidateSet: input.candidateSet,
          constraints: input.candidateSet.constraints,
          admissionBundle: input.admissionBundle,
        },
        adoptedDecisionAt: input.adoptedDecisionAt,
        projectId,
        callerId: input.parentSessionId,
        parent: {
          invocationId: input.parentSessionId,
          turnId: input.parentTurnId,
        },
      }, routing), input.abortSignal);
      return await coordinator.prepare({
        jobId: input.jobId,
        economicAttemptId: input.economicAttemptId,
        intentFingerprint: input.intentFingerprint,
        admissionBundle: input.admissionBundle,
        effectIdentity: input.effectIdentity,
        adoption,
        access: input.candidateSet.access,
        authorityProfileId: input.authorityProfileId,
        invocationId: input.invocationId,
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        ...(input.workLimitDurationMs !== undefined
          ? { workLimitDurationMs: input.workLimitDurationMs }
          : {}),
        ...(input.lifecycleEvents ? { lifecycleEvents: input.lifecycleEvents } : {}),
        ...(input.validateAndConsumeApprovalBeforeFence
          ? { validateAndConsumeApprovalBeforeFence: input.validateAndConsumeApprovalBeforeFence }
          : {}),
        ...(input.validateExecutionProfile ? { validateExecutionProfile: input.validateExecutionProfile } : {}),
      });
    },
  } };
}

function validateManagedAgentEconomicPolicyBindings(
  agents: readonly KilnAgentDefinition[],
  routeConfigs: readonly ManagedAgentRouteConfigProjection[],
  policies: readonly DerivedManagedAgentEconomicPolicy[],
): readonly ManagedAgentProfileHealth[] {
  const policiesByIntent = new Map(policies.map((policy) => [policy.intentId, policy]));
  const configuredRoutes = new Map(routeConfigs.map((route) => [route.routeConfig.id, route.routeConfig]));
  const failures: ManagedAgentProfileHealth[] = [];
  for (const agent of agents) {
    if (agent.mode !== "managed-child" && agent.mode !== "all") continue;
    const configuredRoute = agent.targetId ? configuredRoutes.get(agent.targetId) : undefined;
    if (configuredRoute?.kind === "harness") continue;
    const policy = policiesByIntent.get(agent.name);
    if (!policy) {
      failures.push({
        agentName: agent.name,
        available: false,
        reason: "Managed agent requires a bounded intent with target/model and paid-usage posture.",
      });
      continue;
    }
    if (policy.candidates.length === 0) {
      failures.push({
        agentName: agent.name,
        available: false,
        reason: policy.unavailableReason
          ?? `Managed agent intent '${agent.name}' has no admitted target with comparable current economics.`,
      });
      continue;
    }
    const candidateRouteIds = new Set(policy.candidates.map((candidate) => candidate.targetId));
    if (agent.targetId && !candidateRouteIds.has(agent.targetId)) {
      failures.push({
        agentName: agent.name,
        available: false,
        routeId: agent.targetId,
        reason: `Agent target '${agent.targetId}' is not admitted by its managed intent.`,
      });
      continue;
    }
  }
  return failures;
}

/** Intent-only managed agents do not require a second private project agent authoring file. */
function mergeManagedAgentIntentDefinitions(
  definitions: readonly KilnAgentDefinition[],
  managedAgents: KilnManagedAgentsConfig | undefined,
): readonly KilnAgentDefinition[] {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  for (const intent of managedAgents?.intents ?? []) {
    if (byName.has(intent.id)) continue;
    byName.set(intent.id, {
      name: intent.id,
      role: intent.purpose,
      goal: intent.purpose,
      tier: "fast",
      mode: "managed-child",
      authorityProfileId: intent.authorityProfileId,
      scope: "global",
      ...(intent.workLimits ? { workLimits: intent.workLimits } : {}),
    });
  }
  return [...byName.values()];
}

function managedEconomicPolicyIdsByRoute(
  policies: readonly DerivedManagedAgentEconomicPolicy[],
): ReadonlyMap<string, readonly string[]> {
  const idsByRoute = new Map<string, string[]>();
  for (const policy of policies) {
    for (const candidate of policy.candidates) {
      const ids = idsByRoute.get(candidate.targetId) ?? [];
      ids.push(policy.id);
      idsByRoute.set(candidate.targetId, ids);
    }
  }
  return idsByRoute;
}

function managedEconomicCapabilitiesByRoute(
  config: ManagedAgentRouteConfigSource,
  routes: readonly ResolvedManagedTargetConfig[],
  policyIdsByRoute: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, NonNullable<ManagedInvocationToolRoute["economicCapability"]>> {
  const capabilities = new Map<string, NonNullable<ManagedInvocationToolRoute["economicCapability"]>>();
  for (const route of routes) {
    if (!policyIdsByRoute.has(route.id)) continue;
    if (route.kind !== "direct") {
      capabilities.set(route.id, { status: "unverified" });
      continue;
    }
    let economics: ExecutionTargetCatalog["targets"][number]["economics"] | undefined;
    try {
      economics = projectManagedRoute(route, config.executionCatalog).admission
        ? config.executionCatalog?.targets.find(({ id }) => id === route.id)?.economics
        : undefined;
    } catch {
      economics = undefined;
    }
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
  config: ManagedAgentRouteConfigSource,
  derivedPolicy?: DerivedManagedAgentEconomicPolicy,
): { readonly entry?: ManagedInvocationAgentCatalogEntry; readonly health?: ManagedAgentProfileHealth } {
  const explicitRouteHealth = validateExplicitAgentRoute(agent, routes, config.authorityProfiles);
  if (explicitRouteHealth) {
    return { health: explicitRouteHealth };
  }
  const routeHint = resolveAgentRouteHint(agent, routes);
  const access = resolveAgentAccess(agent, config.authorityProfiles)!;
  const intent = config.managedAgents?.intents?.find((candidate) => candidate.id === agent.name);
  return {
    entry: {
      name: agent.name,
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.nicknameCandidates ? { nicknameCandidates: agent.nicknameCandidates } : {}),
      role: agent.role,
      goal: agent.goal,
      tier: agent.tier,
      authorityProfileId: agent.authorityProfileId!,
      access,
      ...(agent.skills ? { skills: agent.skills } : {}),
      ...(agent.modalities ? { modalities: agent.modalities } : {}),
      ...(agent.structured !== undefined ? { structured: agent.structured } : {}),
      ...(agent.taskAffinity ? { taskAffinity: agent.taskAffinity } : {}),
      ...(() => {
        const policy = derivedPolicy;
        return policy
          ? {
              economicPolicyId: policy.id,
              economicPolicyRevision: policy.revision,
              economicPolicyCandidateRouteIds: policy.candidates.map((candidate) => candidate.targetId),
            }
          : {};
      })(),
      ...(intent?.workLimits ? { workLimits: intent.workLimits } : {}),
      ...(intent && (intent.paidUsage === "ask-before-spend" || intent.paidUsage === undefined)
        ? { economicSpendApproval: "required" as const }
        : {}),
      ...(routeHint?.routeId ? { routeId: routeHint.routeId } : {}),
      ...(routeHint?.providerRoute ? { providerRoute: routeHint.providerRoute } : {}),
      ...(agent.voiceProfile ? { voiceProfile: agent.voiceProfile } : {}),
      ...(agent.communication ? { communication: agent.communication } : {}),
    },
  };
}

function validateExplicitAgentRoute(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
  authorityProfiles: readonly KilnAuthorityProfileConfig[] | undefined,
): ManagedAgentProfileHealth | undefined {
  if (!agent.targetId) {
    return undefined;
  }
  const route = routeFromExplicitAgentHint(agent, routes);
  if (!route) {
    return {
      agentName: agent.name,
      available: false,
      routeId: agent.targetId,
      reason: `Agent references unavailable managed target '${agent.targetId}'.`,
    };
  }
  const access = resolveAgentAccess(agent, authorityProfiles);
  if (agent.authorityProfileId && !access) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent authority profile '${agent.authorityProfileId}' is not configured.`,
    };
  }
  const routeProfile = agent.authorityProfileId && access
    ? resolveConfiguredManagedInvocationRouteProfile(route, {
        authorityProfileId: agent.authorityProfileId,
        access,
      }, access)
    : undefined;
  if (access && !routeProfile) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent authority profile '${agent.authorityProfileId}' is not admitted by target '${route.routeId}'.`,
    };
  }
  const routeTools = new Set(routeProfile?.allowedToolNames ?? []);
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
    return routeHint(explicit);
  }
  if (agent.mode === "managed-child" || agent.mode === "all") {
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
  return selected ? routeHint(selected) : undefined;
}

function routeFromExplicitAgentHint(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
): ManagedInvocationToolRoute | undefined {
  return agent.targetId ? routes.find((route) => route.routeId === agent.targetId) : undefined;
}

function routeHint(
  route: ManagedInvocationToolRoute,
): Pick<ManagedInvocationAgentCatalogEntry, "routeId" | "providerRoute"> {
  return {
    routeId: route.routeId,
    providerRoute: {
      providerId: route.providerId,
      ...(route.model ? { model: route.model } : {}),
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
  userHome: string | undefined,
  projectStateBinding: ReturnType<typeof resolveProjectStateBinding>,
  skillConfig: KilnYamlSkillsConfig | undefined,
): readonly ManagedSkillCatalogEntry[] {
  const catalog = readConfiguredSkillCatalogStatus({
    projectPath,
    ...(userHome ? { userHome } : {}),
    projectStateBinding,
    skillConfig,
  });
  return catalog.entries
    .map((skill): ManagedSkillCatalogEntry => ({
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      configured: skill.configured,
      builtIn: skill.builtIn,
      sourcePath: skill.sourcePath,
      desiredVisibility: skill.desiredVisibility,
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
  const authorityProfiles = config.authorityProfiles ?? [];
  if (authorityProfiles.length === 0) return [];
  return (config.targetCatalog?.targets ?? []).map((target) => {
    const routeConfig = {
      id: target.id,
      kind: target.kind,
      authorityProfiles,
      ...(target.kind === "harness"
        ? {
            provider: target.providerId,
            model: target.providerModelId,
            ...(target.remoteHarness ? { remoteHarness: target.remoteHarness } : {}),
            ...(target.externalRuntimeAttachment ? { externalRuntimeAttachment: target.externalRuntimeAttachment } : {}),
          }
        : {}),
    } as ResolvedManagedTargetConfig;
    return projectedRoute(routeConfig, "explicit-managed-route");
    });
}

function resolveSourceExecutionTargetCatalog(config: ManagedAgentRouteConfigSource): ExecutionTargetCatalog | undefined {
  return config.executionCatalog;
}

function resolveAgentAccess(
  agent: KilnAgentDefinition,
  authorityProfiles: readonly KilnAuthorityProfileConfig[] | undefined,
): ManagedAgentAccess | undefined {
  if (!agent.authorityProfileId) return undefined;
  return authorityProfiles?.find((profile) => profile.id === agent.authorityProfileId)?.access;
}

function projectedRoute(
  routeConfig: ResolvedManagedTargetConfig,
  routeSource: ManagedAgentRouteSource,
): ManagedAgentRouteConfigProjection {
  return { routeConfig, routeSource };
}

function managedAgentVoiceProfile(
  config: ManagedAgentRouteConfigSource,
): string | undefined {
  return config.managedAgents?.defaultVoiceProfile;
}

async function resolveRouteConfig(
  projection: ManagedAgentRouteConfigProjection,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  const { routeConfig, routeSource } = projection;
  const accessLevels = normalizeAccessLevels(routeConfig.authorityProfiles.map((profile) => profile.access));
  let target: ManagedRouteProjection;
  try {
    target = projectManagedRoute(routeConfig, config.executionCatalog);
  } catch (error) {
    return unhealthy({
      routeId: routeConfig.id,
      routeSource,
      kind: routeConfig.kind,
      provider: "unresolved",
      accessLevels,
    }, error instanceof Error ? error.message : String(error));
  }
  const baseHealth = {
    routeId: routeConfig.id,
    routeSource,
    kind: routeConfig.kind,
    provider: target.providerId,
    ...(target.providerModelId ? { model: target.providerModelId } : {}),
    accessLevels,
  };

  const writeRequired = routeRequiresWriteAuthority(accessLevels);
  if (config.engines?.[target.providerId]?.enabled === false) {
    return unhealthy(baseHealth, `Provider '${target.providerId}' is disabled in engine config.`);
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
    );
  }

  if (routeConfig.authorityProfiles.some((profile) => profile.workingDirectory === "sandbox")) {
    return unhealthy(baseHealth, "Harness sandbox working-directory routes require live-proven sandbox enforcement.");
  }

  if (!isProviderAvailable(context, routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is unavailable.`);
  }

  // The Agent SDK executes its own bundled Claude Code whenever no executable is
  // given, which is not the binary whose catalog admitted this route.  Bind the
  // managed child to the operator's installed harness or keep the route closed.
  const harnessExecutable = routeConfig.provider === "claude"
    ? (context.resolveClaudeExecutable ?? resolveClaudeCodeExecutable)()
    : routeConfig.provider === "opencode"
      ? (context.resolveOpenCodeExecutable ?? resolveOpenCodeExecutable)()
      : undefined;
  if (routeConfig.provider === "claude" && harnessExecutable === undefined) {
    return unhealthy(
      baseHealth,
      "Claude Code executable was not found; a managed Claude child must not run the Agent SDK bundled build.",
    );
  }

  const model = routeConfig.model;
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
  const canonicalAdmission = deriveCanonicalManagedRouteAdmission(catalogEntry.entry, routeConfig, routeConfig.provider, model);
  if (!canonicalAdmission.eligible) {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, canonicalAdmission));
  }
  if (routeConfig.provider === "opencode" && harnessExecutable === undefined) {
    return unhealthy(
      baseHealth,
      "OpenCode executable was not found; a managed OpenCode child must run the binary whose catalog admitted this route.",
    );
  }

  const privatePlanArtifactCapability = routeConfig.provider === "claude"
    && !writeRequired
    && accessLevels.length === 1
    && accessLevels[0] === READ_ONLY_ACCESS
    ? resolveClaudePrivatePlanArtifactCapability(harnessExecutable?.evidence.version)
    : undefined;
  if (
    routeConfig.provider === "claude"
    && !writeRequired
    && accessLevels.length === 1
    && accessLevels[0] === READ_ONLY_ACCESS
    && privatePlanArtifactCapability === undefined
  ) {
    return unhealthy(
      baseHealth,
      "Claude Code executable version lacks the admitted private plan artifact-location capability.",
    );
  }
  if (writeRequired && !(catalogEntry.entry.provenAccess ?? accessLevels).some((access) => WRITE_ACCESS.has(access as KilnManagedAgentAccess))) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' model '${model}' has no catalog-proven write enforcement.`);
  }
  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, config.managedAgents?.worktreeLease, config.executionCatalog);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const createAdapter = async (): Promise<ManagedAgentRuntimeAdapter> => {
    const builtinToolsProvider = createManagedRouteBuiltinToolsProvider(context);
    return new ManagedCliHarnessAdapter({
      providerId: routeConfig.provider,
      model,
      ...(routeConfig.provider === "claude" ? { admittedProviderModelId: model } : {}),
      ...((routeConfig.provider === "claude" || routeConfig.provider === "opencode")
        && catalogEntry.entry.deliberationCapabilities
        ? { deliberationCapabilities: catalogEntry.entry.deliberationCapabilities }
        : {}),
      factory: createHarnessSessionFactory(
        routeConfig.provider as ProviderId,
        model,
        context,
        harnessExecutable,
        privatePlanArtifactCapability,
      ),
      ...(privatePlanArtifactCapability ? { privatePlanArtifactCapability } : {}),
      ...(writeRequired ? { writeAuthority: LIVE_PROVEN_HARNESS_WRITE_AUTHORITY } : {}),
      ...(builtinToolsProvider ? { builtinToolsProvider } : {}),
    });
  };
  const voiceProfile = managedAgentVoiceProfile(config);
  const externalRuntimeAttachment = resolveRouteExternalRuntimeAttachment(routeConfig);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    routeSource,
    providerId: routeConfig.provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    capability: managedRouteCapability({ route: routeConfig, provider: routeConfig.provider, model, profiles: profileResolution.profiles, adapterKind: "cli-harness", settlement: { kind: "not-required" }, provenAccess: catalogEntry.entry.provenAccess, ...(externalRuntimeAttachment ? { externalRuntimeAttachment } : {}) }),
    createAdapter,
    surface: "cli-harness",
    ...(externalRuntimeAttachment ? { externalRuntimeAttachment } : {}),
    taskSuitability: resolveTaskSuitability(
      routeConfig.provider,
      model,
      config.modelTaskSuitability,
      liveProofEvidence(routeConfig.provider, model, accessLevels),
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
  routeConfig: Extract<ResolvedManagedTargetConfig, { readonly kind: "harness" }>,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
  writeRequired: boolean,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  if (writeRequired) {
    return unhealthy(baseHealth, "Remote harness managed invocation routes currently support read-only only.");
  }
  const remoteHarness = routeConfig.remoteHarness;
  if (remoteHarness === undefined) {
    return unhealthy(baseHealth, "Remote harness route requires remoteHarness endpoint config.");
  }
  const model = routeConfig.model;
  if (!model) {
    return unhealthy(baseHealth, `Remote harness managed invocation route '${routeConfig.id}' requires a model.`);
  }
  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, config.managedAgents?.worktreeLease, config.executionCatalog);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const createAdapter = async (): Promise<ManagedAgentRuntimeAdapter> => new ManagedRemoteHarnessAdapter({
        providerId: routeConfig.provider,
        model,
        invokeUrl: remoteHarness.invokeUrl,
        cancelUrl: remoteHarness.cancelUrl,
        ...(remoteHarness.authTokenEnv ? { authTokenEnv: remoteHarness.authTokenEnv } : {}),
        ...(remoteHarness.limitations ? { limitations: remoteHarness.limitations } : {}),
      });
  const voiceProfile = managedAgentVoiceProfile(config);
  const externalRuntimeAttachment = resolveRouteExternalRuntimeAttachment(routeConfig);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    routeSource: baseHealth.routeSource,
    providerId: routeConfig.provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    capability: managedRouteCapability({ route: routeConfig, provider: routeConfig.provider, model, profiles: profileResolution.profiles, adapterKind: "governed-external-runtime", settlement: { kind: "not-required" }, ...(externalRuntimeAttachment ? { externalRuntimeAttachment } : {}) }),
    createAdapter,
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
      remoteHarnessEvidence(routeConfig.provider, model, normalizeAccessLevels(routeConfig.authorityProfiles.map((profile) => profile.access))),
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

function routeRequiresWriteAuthority(
  accessLevels: readonly ManagedAgentAccess[],
): boolean {
  return accessLevels.some((access) => WRITE_ACCESS.has(access as KilnManagedAgentAccess));
}

function buildRouteProfiles(
  routeConfig: ResolvedManagedTargetConfig,
  cwd: string,
  worktreeLeaseConfig: KilnManagedAgentsConfig["worktreeLease"] | undefined,
  executionCatalog: ExecutionTargetCatalog | undefined,
): {
  readonly ok: true;
  readonly profiles: ManagedInvocationToolRoute["profiles"];
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const resolved: ManagedInvocationRouteProfile[] = [];
  for (const authorityProfile of routeConfig.authorityProfiles) {
    const workingDirectoryLease = resolveWorkingDirectoryLease(authorityProfile, cwd, worktreeLeaseConfig);
    if (!workingDirectoryLease.ok) return workingDirectoryLease;
    const access = authorityProfile.access;
    if (access === READ_ONLY_ACCESS) {
      resolved.push(buildReadonlyProfile(
        routeConfig,
        authorityProfile,
        authorityProfile.id,
        cwd,
        workingDirectoryLease.lease,
        executionCatalog,
      ));
      continue;
    }
    if (access === "propose" || access === "approved-write") {
      const writeProfile = buildWriteProfile(
        routeConfig,
        authorityProfile,
        authorityProfile.id,
        cwd,
        access,
        workingDirectoryLease.lease,
        executionCatalog,
      );
      if (!writeProfile.ok) {
        return writeProfile;
      }
      resolved.push(writeProfile.profile);
      continue;
    }
    return {
      ok: false,
      reason: `Managed invocation access '${access}' is not supported by target projection.`,
    };
  }
  return { ok: true, profiles: resolved };
}

function resolveRouteTimeout(authorityProfile: KilnAuthorityProfileConfig): {
  readonly timeoutMs: number;
  readonly source: NonNullable<ManagedAgentAuthorityProfile["timeoutSource"]>;
} {
  return {
    timeoutMs: authorityProfile.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    source: authorityProfile.timeoutMs === undefined ? "default" : "explicit-route",
  };
}

function buildReadonlyProfile(
  routeConfig: ResolvedManagedTargetConfig,
  authorityProfile: KilnAuthorityProfileConfig,
  authorityProfileId: string,
  cwd: string,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
  executionCatalog: ExecutionTargetCatalog | undefined,
): ManagedInvocationRouteProfile {
  const timeout = resolveRouteTimeout(authorityProfile);
  return {
    authorityProfileId,
    access: READ_ONLY_ACCESS,
    allowedToolNames: authorityProfile.tools?.allowed ?? DEFAULT_ALLOWED_TOOLS,
    writeAllowed: false,
    networkAllowed: authorityProfile.tools?.network === true,
    workingDirectory: resolveWorkingDirectory(authorityProfile, cwd, workingDirectoryLease),
    ...(workingDirectoryLease ? { workingDirectoryLease } : {}),
    timeoutMs: timeout.timeoutMs,
    timeoutSource: timeout.source,
    credentialRoute: resolveCredentialRoute(routeConfig, executionCatalog),
    memoryScope: resolveMemoryScope(authorityProfile, cwd),
    ...(authorityProfile.readAuthority
      ? { readAuthority: buildReadAuthority(authorityProfile, cwd) }
      : {}),
  };
}

function buildReadAuthority(
  authorityProfile: KilnAuthorityProfileConfig,
  cwd: string,
): ManagedAgentAuthorityProfile["readAuthority"] {
  const allowedPaths = normalizeManagedRoutePaths(authorityProfile.readAuthority?.workspace?.allowedPaths ?? [], cwd);
  return defineManagedAgentReadAuthority({
    workspace: {
      allowedPaths,
      deniedPaths: uniqueStrings([
        ...normalizeManagedRoutePaths(authorityProfile.readAuthority?.workspace?.deniedPaths ?? [], cwd),
        ...defaultManagedWorkspaceDeniedPaths(cwd, allowedPaths),
      ]),
    },
  });
}

function buildWriteProfile(
  routeConfig: ResolvedManagedTargetConfig,
  authorityProfile: KilnAuthorityProfileConfig,
  authorityProfileId: string,
  cwd: string,
  access: Exclude<KilnManagedAgentAccess, "read-only">,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
  executionCatalog: ExecutionTargetCatalog | undefined,
): {
  readonly ok: true;
  readonly profile: ManagedInvocationRouteProfile;
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const networkEnabled = authorityProfile.tools?.network === true;
  if (networkEnabled) {
    return {
      ok: false,
      reason: `${access} routes cannot enable tools.network. Use a separate read-only route for web, browser, computer-use, or visual-reference research phases.`,
    };
  }
  const writeAuthority = buildWriteAuthority(authorityProfile, cwd, access);
  if (!writeAuthority.ok) {
    return writeAuthority;
  }
  const applyApproved = access === "approved-write";
  const timeout = resolveRouteTimeout(authorityProfile);
  return {
    ok: true,
    profile: {
      authorityProfileId,
      access,
      allowedToolNames: authorityProfile.tools?.allowed ?? (applyApproved ? DEFAULT_WRITE_ALLOWED_TOOLS : DEFAULT_ALLOWED_TOOLS),
      writeAllowed: applyApproved,
      networkAllowed: false,
      workingDirectory: resolveWriteWorkingDirectory(authorityProfile, cwd, applyApproved, workingDirectoryLease),
      ...(workingDirectoryLease ? { workingDirectoryLease } : {}),
      timeoutMs: timeout.timeoutMs,
      timeoutSource: timeout.source,
      credentialRoute: resolveCredentialRoute(routeConfig, executionCatalog),
      memoryScope: resolveMemoryScope(authorityProfile, cwd),
      writeAuthority: writeAuthority.authority,
    },
  };
}

function buildWriteAuthority(
  authorityProfile: KilnAuthorityProfileConfig,
  cwd: string,
  access: Exclude<KilnManagedAgentAccess, "read-only">,
): {
  readonly ok: true;
  readonly authority: NonNullable<ManagedAgentAuthorityProfile["writeAuthority"]>;
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const config = authorityProfile.writeAuthority;
  if (!config) {
    return {
      ok: false,
      reason: "Write-capable managed invocation routes require explicit writeAuthority scope and approval config.",
    };
  }
  const applyApproved = access === "approved-write";
  const configuredWorkspaceMode = config.workspace?.mode;
  const workspaceMode = applyApproved
      ? "apply-approved"
      : configuredWorkspaceMode ?? "none";
  if (applyApproved && configuredWorkspaceMode !== undefined && configuredWorkspaceMode !== "apply-approved") {
    return {
      ok: false,
      reason: "approved-write routes require writeAuthority.workspace.mode apply-approved.",
    };
  }
  if (!applyApproved && configuredWorkspaceMode === "apply-approved") {
    return {
      ok: false,
      reason: `${access} routes cannot use writeAuthority.workspace.mode apply-approved.`,
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
    authorityProfile.workingDirectory === "isolated-worktree"
    && allowedWorkspacePaths.some((path) => !isPathWithinOrEqual(cwd, path))
  ) {
    return {
      ok: false,
      reason: "isolated-worktree write routes require writeAuthority.workspace.allowedPaths to stay inside the repository root.",
    };
  }
  const memoryWriteEnabled = authorityProfile.memory?.access === "write-proposals";
  const artifactMode = config.artifacts?.mode ?? "none";
  if (!applyApproved && artifactMode === "apply-approved") {
    return {
      ok: false,
      reason: `${access} routes cannot use writeAuthority.artifacts.mode apply-approved.`,
    };
  }
  if (!config.approval || (config.approval.mode !== "required-before-apply" && config.approval.mode !== "policy-approved")) {
    return {
      ok: false,
      reason: "Write-capable managed invocation routes require approval.mode required-before-apply or policy-approved.",
    };
  }

  return {
    ok: true,
    authority: defineManagedAgentWriteAuthority({
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
          operations: memoryWriteEnabled ? config.memory?.operations ?? ["create", "update"] : [],
        },
        artifacts: {
          mode: artifactMode,
          resourceUris: artifactMode === "none" ? [] : config.artifacts?.resourceUris ?? [],
          retention: config.artifacts?.retention ?? "none",
        },
        tools: {
          allowedToolNames: config.tools?.allowed ?? authorityProfile.tools?.allowed ?? (applyApproved ? DEFAULT_WRITE_ALLOWED_TOOLS : DEFAULT_ALLOWED_TOOLS),
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
  routeConfig: Extract<ResolvedManagedTargetConfig, { readonly kind: "direct" }>,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
  writeRequired: boolean,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  let target: ManagedRouteProjection;
  try {
    target = projectManagedRoute(routeConfig, config.executionCatalog);
  } catch (error) {
    return unhealthy(baseHealth, error instanceof Error ? error.message : String(error));
  }
  const provider = target.providerId;
  const model = target.providerModelId;
  if (!model) {
    return unhealthy(baseHealth, `Direct managed invocation route '${routeConfig.id}' resolved without a model.`);
  }
  if (!isProviderAvailable(context, provider)) {
    return unhealthy(baseHealth, `Provider '${provider}' is unavailable.`);
  }
  const catalogEntry = resolveManagedProviderModelCatalogEntry(context, provider, model);
  if (catalogEntry.status === "pending") {
    return unhealthy(baseHealth, `Provider/model eligibility evidence is pending for direct managed invocation route '${routeConfig.id}'.`);
  }
  if (catalogEntry.status === "ineligible") {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(provider, model, undefined));
  }
  if (writeRequired) {
    const writeSupport = validateDirectRouteWriteSupport(normalizeAccessLevels(routeConfig.authorityProfiles.map((profile) => profile.access)));
    if (!writeSupport.ok) {
      return unhealthy(baseHealth, writeSupport.reason);
    }
  }
  const canonicalAdmission = deriveCanonicalManagedRouteAdmission(catalogEntry.entry, routeConfig, provider, model);
  if (!canonicalAdmission.eligible) {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(provider, model, canonicalAdmission));
  }
  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, config.managedAgents?.worktreeLease, config.executionCatalog);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const voiceProfile = managedAgentVoiceProfile(config);
  const externalRuntimeAttachment = resolveRouteExternalRuntimeAttachment(routeConfig);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    ...(target.admission?.accountSelection.kind === "policy"
      ? { accountPolicyId: createExecutionAccountPolicyId(target.admission.accountSelection.accountPolicyId) }
      : {}),
    routeSource: baseHealth.routeSource,
    providerId: provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    capability: managedRouteCapability({
      route: routeConfig, provider, model, profiles: profileResolution.profiles, adapterKind: "direct-provider",
      settlement: { kind: "managed-economic-selection", contractVersion: "managed-economic-v1", policyIds: [routeConfig.id], pendingSettlement: "required", recovery: "required" },
      ...(target.admission?.accountSelection.kind === "policy"
        ? { accountPolicyId: target.admission.accountSelection.accountPolicyId }
        : {}),
      ...(externalRuntimeAttachment ? { externalRuntimeAttachment } : {}),
    }),
    createCommittedAdapter: async (request: ManagedCommittedInvocationRequest) => {
      const committedRoute = request.commitment.reservation.selectedIdentity.route;
      const committedAccount = request.commitment.reservation.selectedIdentity.account;
      if (
        committedRoute.routeId !== routeConfig.id
        || committedRoute.providerId !== provider
        || committedRoute.modelId !== model
      ) {
        throw new ManagedCommittedRouteMismatchError({
          code: "committed-route-mismatch",
          expected: { routeId: routeConfig.id, providerId: provider, modelId: model },
          committed: {
            routeId: committedRoute.routeId,
            providerId: committedRoute.providerId,
            modelId: committedRoute.modelId,
          },
        });
      }
      const committedProfiles = profileResolution.profiles.filter((profile) =>
        profile.authorityProfileId === request.authorityProfileId
        && profile.access === request.access
      );
      const committedProfile = committedProfiles.length === 1 ? committedProfiles[0] : undefined;
      if (
        !committedProfile
        || digestManagedEconomicCandidateProfileAuthority(committedProfile, request.invocationId)
          !== request.profileAuthorityDigest
      ) {
        throw new Error("identity-revision-conflict: committed managed authority profile is unavailable or changed");
      }
      let credentialBinding: DirectProviderCredentialBinding | undefined;
      if (committedAccount.kind === "account-bound") {
        const accountRouting = context.managedAccountRouting
          ?? context.managedAccountComposition?.routing
          ?? createManagedAccountRuntimeComposition(config, context.cwd)?.routing;
        if (!accountRouting || !isDirectProviderId(provider)) {
          throw new Error("Committed account-bound managed route has no process-owned account authority.");
        }
        const committedBinding = await accountRouting.resolveCommittedAccountBinding({
          capacityIdentity: committedAccount.capacityIdentity,
          accountRef: createExecutionAccountRef(committedAccount.accountRef),
          credentialRevisionId: committedAccount.credentialRevision,
        });
        credentialBinding = {
          routeId: routeConfig.id,
          accountId: committedBinding.accountId,
          credentialId: committedBinding.credentialId,
          credentialRevision: committedBinding.credentialRevision,
        };
        throwIfManagedRoutePreparationAborted(request.abortSignal);
      } else {
        throw new Error("Direct managed routes require an account-bound execution commitment.");
      }
      return await context.directAdapterFactory?.(
        routeConfig,
        credentialBinding,
        request.abortSignal,
        request,
        committedProfile,
      );
    },
    surface: "direct-provider",
    ...(externalRuntimeAttachment ? { externalRuntimeAttachment } : {}),
    taskSuitability: resolveTaskSuitability(
      provider,
      model,
      config.modelTaskSuitability,
      liveProofEvidence(provider, model, normalizeAccessLevels(routeConfig.authorityProfiles.map((profile) => profile.access))),
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
  routes: readonly ResolvedManagedTargetConfig[],
  providerModelEligibility: ManagedAgentProviderModelCatalogDiagnostics | undefined,
): ReadonlyMap<string, ModelDeliberationCapabilities> {
  const capabilities = new Map<string, ModelDeliberationCapabilities>();
  for (const route of routes) {
    let target: ManagedRouteProjection;
    try {
      target = projectManagedRoute(route, config.executionCatalog);
    } catch {
      continue;
    }
    const model = target.providerModelId;
    if (!model) continue;
    const discoveredCapabilities = providerModelEligibility?.[target.providerId]?.[model]?.deliberationCapabilities;
    if (
      discoveredCapabilities
      && discoveredCapabilities.provider === target.providerId
      && discoveredCapabilities.model === model
    ) {
      capabilities.set(route.id, discoveredCapabilities);
    }
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

const DIRECT_WRITE_CAPABLE_ACCESS: readonly ManagedAgentAccess[] = [
  "read-only",
  "propose",
  "approved-write",
];

// Determines write capability from route/access configuration alone, without
// constructing the (now always-deferred) direct provider adapter. The direct
// adapter factory grants LIVE_PROVEN_DIRECT_WRITE_AUTHORITY whenever
// routeRequiresWriteAuthority(route) is true, so this mirrors that contract.
function validateDirectRouteWriteSupport(
  accessLevels: readonly ManagedAgentAccess[],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const unsupportedAccess = accessLevels.find((access) => !DIRECT_WRITE_CAPABLE_ACCESS.includes(access));
  if (unsupportedAccess !== undefined) {
    return {
      ok: false,
      reason: `Direct managed invocation route does not support access '${unsupportedAccess}'.`,
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
  accessLevels: readonly ManagedAgentAccess[],
): ModelTaskSuitabilityEvidence {
  return {
    source: "live-proof",
    status: "observed",
    summary: `Managed invocation route for ${provider}/${model} is available with live-proven access levels: ${accessLevels.join(", ")}.`,
  };
}

function remoteHarnessEvidence(
  provider: string,
  model: string,
  accessLevels: readonly ManagedAgentAccess[],
): ModelTaskSuitabilityEvidence {
  return {
    source: "configured-route",
    status: "declared",
    summary: `Remote harness managed invocation route for ${provider}/${model} is endpoint-configured with admitted access levels: ${accessLevels.join(", ")}.`,
  };
}

function normalizeAccessLevels(
  accessLevels: readonly ManagedAgentAccess[] | undefined,
): readonly ManagedAgentAccess[] {
  return accessLevels && accessLevels.length > 0 ? accessLevels : [READ_ONLY_ACCESS];
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
  routeConfig: ResolvedManagedTargetConfig,
  providerId: string,
  model: string,
): ProviderModelEligibilityDecision {
  return deriveProviderModelEligibility(
    managedRouteEvidence(entry.catalogDiagnosticEvidence, routeConfig, providerId, model),
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
  routeConfig: ResolvedManagedTargetConfig,
  providerId: string,
  model: string,
): ProviderModelEvidence {
  const observedAt = new Date().toISOString();
  const routeObservations = [
    managedRouteObservation("configured", "confirmed", "operator-declared", routeConfig.id, observedAt),
    managedRouteObservation("authenticated", "confirmed", "runtime-observed", providerId, observedAt),
    managedRouteObservation("capabilityCompatible", "confirmed", "runtime-observed", routeConfig.id, observedAt),
    managedRouteObservation("policyAdmitted", "confirmed", "operator-declared", routeConfig.id, observedAt),
    managedRouteObservation("routeHealthy", "confirmed", "runtime-observed", routeConfig.id, observedAt),
  ];
  return createProviderModelEvidence({
    identity: {
      ...catalogDiagnosticEvidence.identity,
      route: {
        providerId,
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
  harnessExecutable: ClaudeCodeExecutableResolution | OpenCodeExecutableResolution | undefined,
  privatePlanArtifactCapability: ClaudePrivatePlanArtifactCapability | undefined,
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
      ...(factoryContext?.deliberationResolution
        ? { deliberationResolution: factoryContext.deliberationResolution }
        : {}),
      ...(harnessExecutable
        ? {
            harnessExecutable: harnessExecutable.path,
            harnessEvidence: harnessExecutable.evidence,
          }
        : {}),
      ...(factoryContext?.structuredOutput ? { structuredOutputSchema: factoryContext.structuredOutput.schema } : {}),
      ...(factoryContext?.privatePlanArtifactCapability
        ? { privatePlanArtifactCapability: factoryContext.privatePlanArtifactCapability }
        : privatePlanArtifactCapability
          ? { privatePlanArtifactCapability }
          : {}),
      ...(factoryContext?.operatorSurface ? { operatorSurface: factoryContext.operatorSurface } : {}),
    };
    return context.registry.createSession(provider, config);
  };
}

async function createManagedInvocationService(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
  existingService: RuntimeManagedAgentInvocationService | undefined,
  existingServiceKey: string | undefined,
  managedAccountComposition: ManagedAccountRuntimeComposition | undefined,
  runtimeStateRoot: string | undefined,
  projectStateBinding: ProjectStateBinding | undefined,
  managedEconomicAuthorityAvailable = false,
  recoverPersistedInvocationsOnConstruct = true,
): Promise<RuntimeManagedAgentInvocationService | undefined> {
  const stateRoot = runtimeStateRoot ?? projectStateBinding?.runtimePath ?? resolveProjectStateBinding(cwd).runtimePath;
  const serviceKey = managedInvocationServiceKey(config, cwd) ?? `managed-invocation:${resolve(cwd)}`;
  const routeConfigs = resolveRouteConfigs(config).map((route) => route.routeConfig);
  const hasExternalHarnessRoute = routeConfigs.some((route) => route.kind === "harness");
  if (existingService && existingServiceKey === serviceKey) {
    if (hasExternalHarnessRoute && !existingService.hasExternalActionClaimConfigured()) {
      existingService.configureExternalActionClaim(createManagedExternalActionClaimContext(cwd, stateRoot, projectStateBinding));
    }
    return existingService;
  }
  const externalActionClaim = hasExternalHarnessRoute
    ? createManagedExternalActionClaimContext(cwd, stateRoot, projectStateBinding)
    : undefined;
  const leaseConfig = config.managedAgents?.worktreeLease;
  const needsWorktreeLease = leaseConfig !== undefined && routeConfigs.some((route) =>
    route.authorityProfiles.some((profile) => profile.workingDirectory === "isolated-worktree")
  );
  const needsSandboxLease = routeConfigs.some(routeUsesRuntimeSandboxLease);
  const credentialRouteIds = collectRuntimeCredentialRouteIds(routeConfigs, config.executionCatalog);
  if (credentialRouteIds.length > 0 && managedAccountComposition === undefined && !managedEconomicAuthorityAvailable) {
    throw new Error("Runtime-selected managed routes require a configured execution account policy.");
  }
  const service = new RuntimeManagedAgentInvocationService({
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
        rootPath: join(stateRoot, "managed-invocation-recovery"),
      }),
    } : {}),
    ...(externalActionClaim !== undefined ? { externalActionClaim } : {}),
  });
  if (credentialRouteIds.length > 0 && recoverPersistedInvocationsOnConstruct) {
    try {
      await service.recoverPersistedInvocations();
    } catch (error) {
      service.close();
      throw new Error("Managed invocation startup recovery failed.", { cause: error });
    }
  }
  return service;
}

function createManagedExternalActionClaimContext(
  cwd: string,
  runtimeStateRoot: string,
  projectStateBinding?: ProjectStateBinding,
) {
  const transcriptEvidence = new TranscriptAuthorityAdmissionEvidenceStore(new TranscriptStore(projectStateBinding ?? cwd));
  const store = new SqliteManagedExternalInvocationActionClaimStore({
    path: join(runtimeStateRoot, "managed-external-invocation-action-claims.sqlite"),
    ...(projectStateBinding ? { privateStateRoot: projectStateBinding.projectStateRoot } : {}),
  });
  return {
    ownerGeneration: `managed-external-owner:${process.pid}:${randomUUID()}`,
    store,
    readAdmission: (input: Parameters<NonNullable<NonNullable<import("@kilnai/runtime").ManagedAgentRuntimeInvocationInput["externalActionClaim"]>["readAdmission"]>>[0]) =>
      transcriptEvidence.readAdmission(input),
  };
}

export function createManagedAccountRuntimeComposition(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
  storage: {
    readonly compositionKey?: string;
    /** Exact operator-private Runtime state root supplied by CLI composition. */
    readonly runtimeStateRoot?: string;
    readonly databasePath?: string;
  } = {},
): ManagedAccountRuntimeComposition | undefined {
  const hasDirectRoute = resolveRouteConfigs(config)
    .some(({ routeConfig }) => routeConfig.kind === "direct");
  const executionCatalog = resolveSourceExecutionTargetCatalog(config);
  if (!hasDirectRoute || !executionCatalog) return undefined;
  const compositionKey = resolve(storage.compositionKey ?? cwd);
  const existing = MANAGED_ACCOUNT_COMPOSITIONS.get(compositionKey);
  if (existing) {
    existing.updateCatalog(executionCatalog);
    return existing;
  }
  const databasePath = storage.databasePath
    ?? join(storage.runtimeStateRoot ?? resolveProjectStateBinding(cwd).runtimePath, "managed-account-leases.sqlite");
  const runtimeDirectory = dirname(databasePath);
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const routing = new ConfiguredExecutionAccountRuntime({
    catalog: executionCatalog,
    kilnHome: resolveProjectStateBinding(cwd).kilnHome,
  });
  const authority = new SqliteManagedAccountLeaseAuthority({
    path: databasePath,
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
    updateCatalog(next) {
      routing.updateCatalog(next);
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

export function managedInvocationServiceKey(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
): string | undefined {
  const routeConfigs = resolveRouteConfigs(config).map((route) => route.routeConfig);
  const hasExternalHarnessRoute = routeConfigs.some((route) => route.kind === "harness");
  const leaseConfig = config.managedAgents?.worktreeLease;
  const needsWorktreeLease = leaseConfig !== undefined && routeConfigs.some((route) =>
    route.authorityProfiles.some((profile) => profile.workingDirectory === "isolated-worktree")
  );
  const needsSandboxLease = routeConfigs.some(routeUsesRuntimeSandboxLease);
  const credentialRouteIds = collectRuntimeCredentialRouteIds(routeConfigs, config.executionCatalog);
  if (!hasExternalHarnessRoute && !needsWorktreeLease && !needsSandboxLease && credentialRouteIds.length === 0) {
    return undefined;
  }
  return JSON.stringify({
    ...(hasExternalHarnessRoute ? {
      externalActionClaim: {
        rootPath: normalizeManagedRoutePath(cwd, cwd),
      },
    } : {}),
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

function routeUsesRuntimeSandboxLease(route: ResolvedManagedTargetConfig): boolean {
  return route.authorityProfiles.some((profile) => profile.workingDirectory === "sandbox")
    && (route.kind === "direct" || route.remoteHarness !== undefined);
}

function collectRuntimeCredentialRouteIds(
  routeConfigs: readonly ResolvedManagedTargetConfig[],
  executionCatalog: ExecutionTargetCatalog | undefined,
): readonly string[] {
  const routeIds = new Set<string>();
  for (const routeConfig of routeConfigs) {
    const credentialRoute = resolveCredentialRoute(routeConfig, executionCatalog);
    if (credentialRoute.mode !== "credentialless") {
      routeIds.add(credentialRoute.routeId);
    }
  }
  return [...routeIds].sort((left, right) => left.localeCompare(right));
}

function resolveWorkingDirectory(
  authorityProfile: KilnAuthorityProfileConfig,
  cwd: string,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): ManagedAgentWorkingDirectory {
  if (authorityProfile.workingDirectory === "isolated-worktree" && workingDirectoryLease) {
    return {
      path: workingDirectoryLease.rootPath,
      mode: "isolated-worktree",
    };
  }
  if (authorityProfile.workingDirectory === "sandbox") {
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
  authorityProfile: KilnAuthorityProfileConfig,
  cwd: string,
  applyApproved: boolean,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): ManagedAgentWorkingDirectory {
  if (authorityProfile.workingDirectory === "isolated-worktree" && workingDirectoryLease) {
    return {
      path: workingDirectoryLease.rootPath,
      mode: "isolated-worktree",
    };
  }
  if (authorityProfile.workingDirectory === "sandbox") {
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
  authorityProfile: KilnAuthorityProfileConfig,
  cwd: string,
  config: KilnManagedAgentsConfig["worktreeLease"] | undefined,
): {
  readonly ok: true;
  readonly lease?: ManagedInvocationRouteProfile["workingDirectoryLease"];
} | {
  readonly ok: false;
  readonly reason: string;
} {
  if (authorityProfile.workingDirectory !== "isolated-worktree") {
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
  routeConfig: ResolvedManagedTargetConfig,
): ManagedAgentExternalRuntimeAttachmentIdentity | undefined {
  const config = routeConfig.kind === "harness"
    ? routeConfig.externalRuntimeAttachment
    : undefined;
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
  routeConfig: ResolvedManagedTargetConfig,
  executionCatalog: ExecutionTargetCatalog | undefined,
): ManagedAgentCredentialRoute {
  if (routeConfig.kind === "harness") {
    return { mode: "credentialless" };
  }
  const projection = projectManagedRoute(routeConfig, executionCatalog);
  if (projection.admission?.accountSelection.kind === "policy") {
    return {
      mode: "account-leased",
      routeId: routeConfig.id,
      accountPolicyId: createExecutionAccountPolicyId(projection.admission.accountSelection.accountPolicyId),
    };
  }
  return {
    mode: "runtime-selected",
    routeId: routeConfig.id,
  };
}

function resolveMemoryScope(
  authorityProfile: KilnAuthorityProfileConfig,
  cwd: string,
  accessOverride?: ManagedAgentMemoryScope["access"],
): ManagedAgentMemoryScope {
  return {
    scope: {
      kind: "project",
      id: basename(cwd.replace(/\\/g, "/")) || "project",
    },
    access: accessOverride ?? authorityProfile.memory?.access ?? "read-only",
  };
}

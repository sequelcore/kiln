import { realpathSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createSessionBuiltinToolOptions,
  defineManagedAgentInvocationRequest,
  digestManagedEconomicValue,
  type DeliberationResolution,
} from "@kilnai/core";
import {
  collectManagedEconomicCandidates,
  digestManagedEconomicCandidateProfileAuthority,
  FilesystemAgentTaskStore,
  AgentTaskApplicationError,
  AgentTaskApplicationService,
  AgentTaskExecutionFailure,
  evaluateExecutionTargetDataPolicy,
  resolveConfiguredManagedInvocationRouteProfile,
  type AgentTaskExecutionFailureClassification,
  type AgentTaskDataPolicyProof,
  type ManagedAgentRuntimeInvocationProgressEvent,
  type AgentTaskNativeHarnessProfile,
  type AgentTaskNativeHarnessRoute,
  type AgentTaskNativeDeliberationResolution,
  type AgentTaskRecord,
  type AgentTaskReplayQuery,
  type AgentTaskResultQuery,
  SqliteManagedWriteApprovalAuthority,
  type ManagedEconomicCommitmentAcquireInput,
  type ManagedEconomicCommitmentAcquireResult,
  type ManagedEconomicCommitmentRecord,
  type ManagedEconomicDispatchAuthorityPort,
  type ManagedWriteApprovalBinding,
  type SanitizedExecutionRouteDataPolicyDecision,
  type EffectiveAuthorityAdmissionBundle,
} from "@kilnai/runtime";
import type {
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentInvocationRecord,
  ManagedAgentWriteEvidence,
  ManagedEconomicSettlement,
} from "@kilnai/core";
import { findAgent, loadAgentDefinitions, type KilnAgentDefinition } from "./agent-loader.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createStagedManagedInvocationRouteCatalog } from "../config/managed-agent-route-catalog.js";
import {
  closeManagedAccountRuntimeComposition,
  createManagedAccountRuntimeComposition,
  createManagedEconomicDispatchComposition,
  projectManagedEconomicJobAdoption,
  type ManagedAgentRouteConfigSource,
  type ManagedInvocationRouteResolution,
} from "../config/managed-agent-routes.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../config/managed-agent-provider-models.js";
import { readConfigStatusSnapshot } from "./config-status.js";
import {
  KILN_STATUS_EVIDENCE_VERSION,
  KilnConfigStatusSnapshotSchema,
  KilnResolvedWorkGovernancePolicySchema,
  type KilnResolvedWorkGovernancePolicy,
} from "@kilnai/gateway-contracts";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import { deriveEffectiveKilnYaml, loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import { publicEffectiveConfigValue } from "./effective-config-projection.js";
import { resolveConfiguredDeliberation } from "../config/deliberation-policy.js";
import { readGlobalConfig, readGlobalExecutionTargetAuthority } from "../config/global-config.js";
import { readKilnYamlFile } from "../kiln-yaml.js";
import { TranscriptStore } from "../wrapper/session-store.js";
import { TranscriptAuthorityAdmissionEvidenceStore } from "./authority-admission-evidence-store.js";
import { SqliteRuntimeModelRoundActionClaimStore } from "./runtime-model-round-action-claim-store.js";
import { SqliteRuntimeToolActionClaimStore } from "./runtime-tool-action-claim-store.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
} from "./project-state-root.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "./private-project-state-filesystem.js";

const MAX_GOVERNANCE_EVIDENCE_AGE_MS = 5 * 60 * 1_000;
const MAX_GOVERNANCE_FUTURE_CLOCK_SKEW_MS = 60 * 1_000;
const OPERATOR_AGENT_TASK_SOURCE = "operator-agent-task";
const TRUSTED_WRITE_APPROVER_ID = "operator";
const MANAGED_WRITE_APPROVAL_DB_FILE = "managed-write-approvals.sqlite";

/**
 * `targetCatalog` and `engines` are global Runtime authority. The projected
 * `executionCatalog` is an internal account-routing view; none are project
 * `ResolvedKilnConfig` fields, so
 * `globalToKilnYaml` (and therefore the effective-`ResolvedKilnConfig` projection)
 * never carries them. Read canonical global config and canonical project
 * config exactly once each, derive the effective project-authorized config
 * from those exact values, and attach the global-only authority from the
 * same global read -- so a project `kiln.yaml` can never define or override
 * it, and no two reads of global config can observe different snapshots.
 */
function loadOperatorProjectManagedRouteConfig(
  rootPath: string,
  projectStateBinding: ProjectStateBinding = resolveProjectStateBinding(rootPath),
): ManagedAgentRouteConfigSource | undefined {
  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYamlFile(projectStateBinding.configPath);
  const effectiveConfig = deriveEffectiveKilnYaml(globalConfig, projectConfig);
  if (!effectiveConfig) return undefined;
  const targetAuthority = readGlobalExecutionTargetAuthority(globalConfig);
  return {
    ...effectiveConfig,
    executionCatalog: targetAuthority?.executionCatalog,
    executionTargetEvidence: targetAuthority?.evidence,
    targetCatalog: globalConfig?.targetCatalog,
    targetRouting: globalConfig?.targetRouting,
    authorityProfiles: globalConfig?.authorityProfiles,
    engines: globalConfig?.engines,
  };
}

/** Slice 3 admits read-only planning only; the route must explicitly support it. */
const REQUIRED_ADMISSION_PROFILE_ID = "foundation-readonly-plan";

/**
 * Production composition for one operator-supervised project Runtime.
 * Configuration and Runtime retain route and provider authority; this owner
 * serves every admitted native-harness caller without adopting harness identity.
 */
export interface CreateOperatorProjectAgentTaskApplicationCompositionOptions {
  readonly discoverProviderModels?: () => Promise<ManagedAgentProviderModelCatalogDiagnostics>;
  readonly onRefreshError?: (error: unknown) => void;
  /** Interactive approval used by ask-before-spend economic intents. */
  readonly requestEconomicApproval?: (
    description: string,
  ) => Promise<{ readonly approved: boolean; readonly reason?: string }>;
  readonly projectPath: string;
  /** Test/embedding seam for the verified operator-private project state. */
  readonly projectStateBinding?: ProjectStateBinding;
  /** Full Core/Runtime admission receipt owned by the enclosing turn. */
  readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
  readonly managedAccountComposition?: NonNullable<ReturnType<typeof createManagedAccountRuntimeComposition>>;
}

interface OperatorProjectGovernanceEvidence {
  readonly policy: KilnResolvedWorkGovernancePolicy;
}

/**
 * Reads project-neutral governance authority from the canonical config-status
 * owner. Harness-facing inspection remains a separate per-request concern.
 */
function createOperatorProjectGovernanceReader(
  rootPath: string,
  projectStateBinding: ProjectStateBinding,
): {
  read(): Promise<OperatorProjectGovernanceEvidence>;
} {
  return {
    async read() {
      let candidate: unknown;
      try {
        candidate = await readConfigStatusSnapshot({ projectPath: rootPath, projectStateBinding, view: "effective" });
      } catch {
        throw new AgentTaskApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence.");
      }
      const snapshot = KilnConfigStatusSnapshotSchema.safeParse(candidate);
      if (
        !snapshot.success
        || snapshot.data.evidenceVersion !== KILN_STATUS_EVIDENCE_VERSION
        || !sameCanonicalProjectRoot(snapshot.data.project.rootPath, rootPath)
        || snapshot.data.effectiveConfigStatus !== "valid"
      ) {
        throw new AgentTaskApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
      }
      const observedAt = Date.parse(snapshot.data.generatedAt);
      const now = Date.now();
      if (
        !Number.isFinite(observedAt)
        || observedAt > now + MAX_GOVERNANCE_FUTURE_CLOCK_SKEW_MS
        || now - observedAt > MAX_GOVERNANCE_EVIDENCE_AGE_MS
      ) {
        throw new AgentTaskApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
      }
      const policy = KilnResolvedWorkGovernancePolicySchema.safeParse(
        publicEffectiveConfigValue(snapshot.data.effectiveConfig, "/workGovernance"),
      );
      if (!policy.success) {
        throw new AgentTaskApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
      }
      return { policy: policy.data };
    },
  };
}

function resolveOperatorProjectStateBinding(projectPath: string): ProjectStateBinding | undefined {
  try {
    const root = resolveProjectRoot({ explicitPath: projectPath });
    return resolveProjectStateBinding(root.rootPath);
  } catch {
    return undefined;
  }
}

function sameCanonicalProjectRoot(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

export async function createOperatorProjectAgentTaskApplicationService(
  options: CreateOperatorProjectAgentTaskApplicationCompositionOptions,
): Promise<AgentTaskApplicationService> {
  return (await createOperatorProjectAgentTaskApplicationComposition(options)).service;
}

export function createOperatorGlobalManagedAccountComposition(input: {
  readonly projectPath: string;
  readonly compositionKey: string;
  readonly databasePath: string;
  readonly projectStateBinding?: ProjectStateBinding;
}): ReturnType<typeof createManagedAccountRuntimeComposition> {
  const binding = input.projectStateBinding ?? resolveOperatorProjectStateBinding(input.projectPath);
  if (!binding) return undefined;
  const config = loadOperatorProjectManagedRouteConfig(binding.canonicalRoot, binding);
  return config
    ? createManagedAccountRuntimeComposition(config, binding.canonicalRoot, {
        compositionKey: input.compositionKey,
        databasePath: input.databasePath,
      })
    : undefined;
}

export interface OperatorProjectManagedAgentSummary {
  readonly configuredAgentProfileId: string;
  readonly displayName?: string;
  readonly role?: string;
  readonly availability: "admitted" | "unavailable" | "unresolved";
  readonly providerFamily?: string;
  readonly admissionProfileId: string;
  readonly diagnostic?: "route_unavailable" | "eligibility_unresolved";
  readonly operatorAction?: string;
}

export interface OperatorProjectAgentTaskApplicationComposition {
  readonly service: AgentTaskApplicationService;
  readonly application: OperatorProjectAgentTaskApplicationPort & OperatorProjectManagedWriteApprovalPort;
  readonly configuredAgents: readonly OperatorProjectManagedAgentSummary[];
  readonly economicAuthority?: OperatorProjectManagedEconomicAuthorityPort;
  /** Releases the process-owned economic authority so a restart can reclaim it immediately. */
  close(): Promise<void>;
}

export interface OperatorProjectManagedEconomicAuthorityPort {
  acquire(input: ManagedEconomicCommitmentAcquireInput): ManagedEconomicCommitmentAcquireResult;
  releasePreFence(jobId: string, economicAttemptId: string): void;
  fenceDispatch(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    actionClaim: Parameters<ManagedEconomicDispatchAuthorityPort["fenceDispatch"]>[3],
  ): void;
  readDispatch(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    actionClaim: Parameters<ManagedEconomicDispatchAuthorityPort["readDispatch"]>[3],
  ): ManagedEconomicCommitmentRecord | undefined;
  settleExecution(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    settlement: ManagedEconomicSettlement,
  ): void;
  recordExecutionSettlementPending(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    reason: string,
  ): void;
}

/** Project identity comes from this trusted composition, never from MCP input. */
export interface OperatorProjectAgentTaskApplicationPort {
  accept(input: unknown, callerIdentity?: ManagedAgentCallerAttachmentIdentity): Promise<AgentTaskRecord>;
  getStatus(input: { readonly callerId: string }, jobId: string): Promise<AgentTaskRecord>;
  getResult(input: { readonly callerId: string }, jobId: string): Promise<AgentTaskResultQuery>;
  cancel(input: { readonly callerId: string }, jobId: string): Promise<AgentTaskRecord>;
  getReplay(input: { readonly callerId: string }, jobId: string): Promise<AgentTaskReplayQuery>;
}

/** Trusted operator-only write approval control; deliberately not an MCP method. */
export interface OperatorProjectManagedWriteApprovalPort {
  approveWrite(jobId: string, expiresAt: string): Promise<AgentTaskRecord>;
}

interface AgentTaskDispatchApplication {
  dispatch(jobId: string, context?: { readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity }): Promise<AgentTaskRecord>;
  failDispatch(jobId: string, error: unknown): Promise<AgentTaskRecord | undefined>;
}

/**
 * Project-owned async dispatch lifecycle. Acceptance is durable and fast;
 * this owner is the only place that starts a Runtime commit and it keeps the
 * active promise alive until the project composition is drained.
 */
export class OperatorProjectAgentTaskDispatcher {
  private readonly active = new Map<string, Promise<AgentTaskRecord | undefined>>();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly application: AgentTaskDispatchApplication) {}

  dispatch(
    jobId: string,
    callerIdentity?: ManagedAgentCallerAttachmentIdentity,
  ): Promise<AgentTaskRecord | undefined> {
    const existing = this.active.get(jobId);
    if (existing) return existing;
    if (this.closed) return Promise.resolve(undefined);
    const task = Promise.resolve()
      .then(() => this.application.dispatch(jobId, callerIdentity ? { callerIdentity } : undefined))
      .catch((error: unknown) => this.application.failDispatch(jobId, error))
      .catch(() => undefined);
    this.active.set(jobId, task);
    task.then(
      () => this.remove(jobId, task),
      () => this.remove(jobId, task),
    );
    return task;
  }

  /** Starts dispatch without exposing a completion promise to the caller. */
  enqueue(jobId: string, callerIdentity?: ManagedAgentCallerAttachmentIdentity): void {
    this.dispatch(jobId, callerIdentity).then(() => undefined, () => undefined);
  }

  async drain(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.all([...this.active.values()]);
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = this.drain();
    return this.closePromise;
  }

  private remove(jobId: string, task: Promise<AgentTaskRecord | undefined>): void {
    if (this.active.get(jobId) === task) this.active.delete(jobId);
  }
}

export async function createOperatorProjectAgentTaskApplicationComposition(
  options: CreateOperatorProjectAgentTaskApplicationCompositionOptions,
): Promise<OperatorProjectAgentTaskApplicationComposition> {
  if (!options || typeof options.projectPath !== "string" || options.projectPath.trim().length === 0) {
    throw new AgentTaskApplicationError("project_identity_unavailable", "Use a trusted project composition boundary.");
  }
  const projectStateBinding = options.projectStateBinding ?? resolveOperatorProjectStateBinding(options.projectPath);
  if (!projectStateBinding) {
    throw new AgentTaskApplicationError("project_identity_unavailable", "Use a trusted project composition boundary.");
  }
  const root = { rootPath: projectStateBinding.canonicalRoot } as const;
  const loadRouteConfig = (): ManagedAgentRouteConfigSource | undefined =>
    loadOperatorProjectManagedRouteConfig(root.rootPath, projectStateBinding);
  const startupRouteConfig = loadRouteConfig();
  if (
    startupRouteConfig?.targetCatalog?.targets.some((target) => target.kind === "direct")
    && !startupRouteConfig.executionCatalog
  ) {
    throw new AgentTaskApplicationError(
      "route_unavailable",
      "Managed direct targets require targetCatalog in global config.",
    );
  }
  const mcpResolution = loadResolvedKilnMcpConfiguration(root.rootPath, { projectStateBinding });
  if (mcpResolution.diagnostics.length > 0) {
    throw new AgentTaskApplicationError("route_unavailable", "Repair canonical MCP configuration before using managed-agent routes.");
  }
  const admittedMcpServers = Object.values(mcpResolution.servers).filter((server) =>
    server.enabled && server.admission?.state === "admitted");
  const worktreeBaseDir = join(projectStateBinding.tmpPath, "worktrees");
  ensurePrivateStateDirectorySync(projectStateBinding.projectStateRoot, worktreeBaseDir);
  const { registry } = createDefaultRegistry({
    kilnHome: projectStateBinding.kilnHome,
    canonicalMcpServers: admittedMcpServers,
    canonicalMcpProjectPath: root.rootPath,
    runtimePermissionObservationProjectPath: root.rootPath,
    worktreeRepoRoot: root.rootPath,
    worktreeBaseDir,
    privateStateRoot: projectStateBinding.projectStateRoot,
  });
  const transcriptStore = new TranscriptStore(projectStateBinding);
  const authorityAdmissionEvidence = new TranscriptAuthorityAdmissionEvidenceStore(transcriptStore);
  if (options.authorityAdmission) {
    await authorityAdmissionEvidence.persist(options.authorityAdmission);
  }
  const runtimeDirectory = projectStateBinding.runtimePath;
  ensurePrivateStateDirectorySync(projectStateBinding.projectStateRoot, runtimeDirectory);
  const managedDirectModelRoundActionClaimsPath = join(runtimeDirectory, "managed-direct-model-round-action-claims.sqlite");
  const managedDirectToolActionClaimsPath = join(runtimeDirectory, "managed-direct-tool-action-claims.sqlite");
  assertPrivateStateFileTargetSync(projectStateBinding.projectStateRoot, managedDirectModelRoundActionClaimsPath);
  assertPrivateStateFileTargetSync(projectStateBinding.projectStateRoot, managedDirectToolActionClaimsPath);
  const managedDirectModelRoundActionClaims = new SqliteRuntimeModelRoundActionClaimStore({
    path: managedDirectModelRoundActionClaimsPath,
    privateStateRoot: projectStateBinding.projectStateRoot,
  });
  let managedDirectToolActionClaims: SqliteRuntimeToolActionClaimStore;
  try {
    managedDirectToolActionClaims = new SqliteRuntimeToolActionClaimStore({
      path: managedDirectToolActionClaimsPath,
      privateStateRoot: projectStateBinding.projectStateRoot,
    });
  } catch (error) {
    managedDirectModelRoundActionClaims.close();
    throw error;
  }
  const governance = createOperatorProjectGovernanceReader(root.rootPath, projectStateBinding);
  const assertNativeRouteDataPolicy = (route: { readonly routeId: string; readonly providerId: string; readonly model: string }): SanitizedExecutionRouteDataPolicyDecision => {
    const currentPolicyConfig = loadRouteConfig();
    const directTarget = currentPolicyConfig?.executionCatalog?.routes.find(({ id }) => id === route.routeId);
    const intentTarget = currentPolicyConfig?.targetCatalog?.targets.find(({ id }) => id === route.routeId);
    const managedTarget = currentPolicyConfig?.executionTargetEvidence?.targets.find(({ targetId }) => targetId === route.routeId);
    try {
      if (!intentTarget || !managedTarget) throw new Error("Missing target data-policy authority.");
      const result = evaluateExecutionTargetDataPolicy({
        routeId: route.routeId,
        providerId: route.providerId,
        providerModelId: route.model,
        requestedClassification: directTarget?.dataClassification ?? intentTarget.dataClassification,
        evidence: directTarget?.dataPolicyEvidence ?? managedTarget.dataPolicyEvidence,
      });
      if (result.decision.status === "denied") throw new Error("Target data policy denied execution.");
      if (!result.evidence) throw new Error("Admitted route policy omitted evidence.");
      return result;
    } catch {
      throw new AgentTaskApplicationError("route_unavailable", "Restore current execution-route data-policy evidence.");
    }
  };
  let managedInvocationService: NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["invocationService"];
  let managedInvocationServiceKey: NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["invocationServiceKey"];
  const freshManagedInvocation = async (
    compositionMode: "execution" | "candidate-admission" = "candidate-admission",
    managedAccountComposition?: ReturnType<typeof createManagedAccountRuntimeComposition>,
  ): Promise<NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>> => {
    let config: ManagedAgentRouteConfigSource | undefined;
    try {
      config = loadRouteConfig();
    } catch {
      throw new AgentTaskApplicationError("route_unavailable", "Refresh current canonical managed-route eligibility evidence.");
    }
    if (!config) throw new AgentTaskApplicationError("route_unavailable", "Refresh current canonical managed-route eligibility evidence.");
    let refreshFailure: unknown;
    const catalog = await createStagedManagedInvocationRouteCatalog(config, {
      cwd: root.rootPath,
      projectStateBinding,
      registry,
      surface: "operator",
      compositionMode,
      runtimeStateRoot: projectStateBinding.runtimePath,
      ...(managedAccountComposition ? { managedAccountComposition } : {}),
      ...(managedInvocationService ? { invocationService: managedInvocationService } : {}),
      ...(managedInvocationServiceKey ? { invocationServiceKey: managedInvocationServiceKey } : {}),
      directAdapterFactory: createManagedDirectProviderAdapterFactory({
        kilnHome: projectStateBinding.kilnHome,
        builtinToolOptions: createSessionBuiltinToolOptions(),
        canonicalMcpServers: admittedMcpServers,
        runtimeToolActionClaims: managedDirectToolActionClaims,
        runtimeModelRoundActionClaims: managedDirectModelRoundActionClaims,
        readAuthorityAdmission: (request) => authorityAdmissionEvidence.readAdmission(request),
      }),
      builtinToolOptions: createSessionBuiltinToolOptions(),
    }, {
      ...options,
      onRefreshError: (error) => {
        refreshFailure = error;
        options.onRefreshError?.(error);
      },
    });
    try {
      await catalog.refreshNow();
      const current = catalog.managedInvocation;
      if (refreshFailure !== undefined || !current) throw new AgentTaskApplicationError("route_unavailable", "Refresh current canonical managed-route eligibility evidence.");
      if (current.invocationService && current.invocationServiceKey) {
        managedInvocationService = current.invocationService;
        managedInvocationServiceKey = current.invocationServiceKey;
      }
      return current;
    } catch (error) {
      await catalog.dispose();
      throw error;
    }
  };
  const managedInvocation = await freshManagedInvocation();
  // The acknowledgement is durable evidence for this composition's exact
  // route admission. Capture it once, never regenerate it per profile lookup.
  const nativeHarnessAcknowledgedAt = new Date().toISOString();
  const initialConfig = loadRouteConfig();
  if (!initialConfig) {
    throw new AgentTaskApplicationError("route_unavailable", "Refresh current canonical managed economic configuration.");
  }
  const managedAccountDatabasePath = join(projectStateBinding.runtimePath, "managed-account-leases.sqlite");
  assertPrivateStateFileTargetSync(projectStateBinding.projectStateRoot, managedAccountDatabasePath);
  const managedAccountComposition = options.managedAccountComposition
    ?? createManagedAccountRuntimeComposition(initialConfig, root.rootPath, {
      compositionKey: root.rootPath,
      databasePath: managedAccountDatabasePath,
    });
  const ownsManagedAccountComposition = options.managedAccountComposition === undefined;
  try {
    await freshManagedInvocation("execution", managedAccountComposition);
  } catch (error) {
    try {
      managedDirectToolActionClaims.close();
    } finally {
      try {
        managedDirectModelRoundActionClaims.close();
      } finally {
        if (ownsManagedAccountComposition) closeManagedAccountRuntimeComposition(root.rootPath);
      }
    }
    throw error;
  }
  const economicDispatch = managedAccountComposition
    ? createManagedEconomicDispatchComposition(
        initialConfig,
        root.rootPath,
        managedInvocation.routes,
        managedAccountComposition,
      )
    : undefined;
  const commitmentRecovery = managedAccountComposition?.authority.createAgentTaskCommitmentRecoveryPort();
  const economicReplay = managedAccountComposition?.authority.createAgentTaskReplayInspectionPort();
  const configuredAgents = await loadAgentDefinitions(root.rootPath, { projectStateBinding });
  const project = { id: `project-${createHash("sha256").update(root.rootPath).digest("hex").slice(0, 32)}` };
  const agentTaskRoot = join(projectStateBinding.runtimePath, "agent-tasks");
  ensurePrivateStateDirectorySync(projectStateBinding.projectStateRoot, agentTaskRoot);
  const agentTaskStore = new FilesystemAgentTaskStore(
    agentTaskRoot,
    60_000,
    projectStateBinding.projectStateRoot,
  );
  const writeApprovalDatabasePath = join(runtimeDirectory, MANAGED_WRITE_APPROVAL_DB_FILE);
  assertPrivateStateFileTargetSync(projectStateBinding.projectStateRoot, writeApprovalDatabasePath);
  const writeApprovalAuthority = new SqliteManagedWriteApprovalAuthority({
    path: writeApprovalDatabasePath,
  });
  const service = new AgentTaskApplicationService({
    project: { resolve: async () => project },
    governance: {
      resolve: async () => {
        await governance.read();
        const now = new Date();
        return {
          version: 1,
          authority: "authoritative",
          source: "kiln-config-status",
          issuedAt: now.toISOString(),
          validUntil: new Date(now.getTime() + 60_000).toISOString(),
        };
      },
      admit: async () => {
        const { policy } = await governance.read();
        // This surface is delegation, never direct execution. The configured
        // policy must explicitly govern managed-agent work before it is admitted.
        if (!policy.requireDelegationFor.includes("managed-agents")) {
          return { admitted: false };
        }
        if (!options.authorityAdmission) return { admitted: false };
        return {
          admitted: true,
          admissionBundle: options.authorityAdmission,
          source: OPERATOR_AGENT_TASK_SOURCE,
        };
      },
    },
    profiles: {
      resolve: async (id) => {
        const agent = findAgent(await loadAgentDefinitions(root.rootPath, { projectStateBinding }), id);
        const current = await freshManagedInvocation();
        const catalogEntry = current.agentCatalog?.find(
          (candidate) => candidate.name === id,
        );
        if (!agent && !catalogEntry?.economicPolicyId) return undefined;
        if (!catalogEntry?.economicPolicyId) {
          if (!agent) return undefined;
          const nativeRoute = resolveNativeHarnessRouteForAgent(agent, current.routes);
          if (!nativeRoute || !catalogEntry?.routeId) return undefined;
          const admissionProfileId = catalogEntry.admissionProfile;
          if (!resolveConfiguredManagedInvocationRouteProfile(nativeRoute, catalogEntry, admissionProfileId)) return undefined;
          return createNativeHarnessProfile(
            agent,
            admissionProfileId,
            nativeRoute,
            nativeHarnessAcknowledgedAt,
            loadRouteConfig()?.deliberationPolicy,
          );
        }
        if (
          !catalogEntry?.economicPolicyId
          || !catalogEntry.economicPolicyRevision
        ) {
          return undefined;
        }
        return {
          kind: "economic" as const,
          id,
          authorityProfileId: catalogEntry.authorityProfileId,
          economicPolicyId: catalogEntry.economicPolicyId,
          economicPolicyRevision: catalogEntry.economicPolicyRevision,
          admissionProfileId: catalogEntry.admissionProfile,
          ...(catalogEntry.economicSpendApproval
            ? { economicSpendApproval: catalogEntry.economicSpendApproval }
            : {}),
          ...(catalogEntry.workLimits ? { workLimits: catalogEntry.workLimits } : {}),
          constraints: {
            ...(agent?.targetId ? { routeId: agent.targetId } : {}),
          },
        };
      },
    },
    routes: {
      resolve: async (profile, context) => {
        const current = await freshManagedInvocation(
          context?.compositionMode ?? "candidate-admission",
          context?.compositionMode === "execution" ? managedAccountComposition : undefined,
        );
        if (profile.kind === "native-harness") {
          const route = current.routes.find((candidate) =>
            candidate.routeId === profile.routeId
            && candidate.providerId === profile.providerId
            && candidate.model === profile.model);
          if (!route || !resolveConfiguredManagedInvocationRouteProfile(route, {
            authorityProfileId: profile.authorityProfileId,
            admissionProfile: profile.admissionProfileId,
          }, profile.admissionProfileId) || route.capability.identity.revision !== profile.routeRevision) {
            return undefined;
          }
          if (route.capability.capacity.kind !== "accountless") return undefined;
          const agent = findAgent(await loadAgentDefinitions(root.rootPath, { projectStateBinding }), profile.id);
          if (!agent) return undefined;
          return nativeHarnessRouteFromProfile(
            profile,
            route,
            agent,
            loadRouteConfig()?.deliberationPolicy,
          );
        }
        return collectManagedEconomicCandidates({
          economicPolicyId: profile.economicPolicyId,
          economicPolicyRevision: profile.economicPolicyRevision,
          configuredAgentProfileId: profile.id,
          authorityProfileId: profile.authorityProfileId,
          admissionProfileId: profile.admissionProfileId,
          ...(profile.constraints?.routeId
            ? { routeId: profile.constraints.routeId }
            : {}),
          ...(profile.constraints?.providerId
            ? {
                providerRoute: {
                  providerId: profile.constraints.providerId,
                  surface: "configured",
                  ...(profile.constraints.model
                    ? { model: profile.constraints.model }
                    : {}),
                },
              }
            : {}),
          ...(context?.invocationId ? { invocationId: context.invocationId } : {}),
        }, current.routes, current.unavailableRoutes);
      },
    },
    ...(managedAccountComposition ? { economicAdoption: {
      adopt: async (job) => {
        if (job.dispatch.kind !== "economic") {
          throw new AgentTaskApplicationError("identity-revision-conflict", "Restore the persisted economic managed dispatch.");
        }
        const currentConfig = loadRouteConfig();
        if (!currentConfig) {
          throw new AgentTaskApplicationError("route_unavailable", "Refresh current canonical managed economic configuration.");
        }
        const currentComposition = createManagedAccountRuntimeComposition(currentConfig, root.rootPath);
        if (!currentComposition || currentComposition.authority !== managedAccountComposition.authority) {
          throw new AgentTaskApplicationError("route_unavailable", "Restore the process-owned managed economic authority.");
        }
        return projectManagedEconomicJobAdoption(currentConfig, job as Parameters<typeof projectManagedEconomicJobAdoption>[1], currentComposition.routing);
      },
    } } : {}),
    ...(managedAccountComposition ? { economicCommitment: {
      query: (input) => commitmentRecovery!.query(input),
      acquire: (input) => managedAccountComposition.authority.acquireCommitment(input),
      releasePreFence: (jobId, economicAttemptId) => {
        managedAccountComposition.authority.releaseCommitmentPreFence(jobId, economicAttemptId);
      },
      recordReleaseFailure: (input) => {
        managedAccountComposition.authority.recordCommitmentReleaseFailure(input);
      },
    } } : {}),
    ...(economicReplay ? { economicReplay } : {}),
    writeApprovals: writeApprovalAuthority,
    ...(economicDispatch ? { economicDispatch: economicDispatch.coordinator } : {}),
    nativeHarnessExecution: {
      execute: async ({ job, route, dispatchFenceId, consumedWriteApproval, callerIdentity, abortSignal }) => {
        const execution = await freshManagedInvocation("execution", managedAccountComposition);
        const currentRoute = execution.routes.find((candidate) =>
          candidate.routeId === route.routeId
          && candidate.providerId === route.providerId
          && candidate.model === route.model);
        const invocationService = execution.invocationService;
          const agent = findAgent(await loadAgentDefinitions(root.rootPath, { projectStateBinding }), job.configuredAgentProfileId);
        const catalogEntry = execution.agentCatalog?.find((candidate) => candidate.name === job.configuredAgentProfileId);
        const profile = currentRoute && catalogEntry
          ? resolveConfiguredManagedInvocationRouteProfile(currentRoute, catalogEntry, job.admissionProfileId)
          : undefined;
        const currentDeliberation = agent && currentRoute
          ? resolveNativeHarnessDeliberation(
              agent,
              currentRoute,
              loadRouteConfig()?.deliberationPolicy,
            )
          : undefined;
        if (
          !currentRoute
          || !profile
          || !invocationService
          || currentRoute.capability.identity.revision !== route.routeRevision
          || currentRoute.capability.target.providerId !== route.providerId
          || currentRoute.capability.target.modelId !== route.model
          || currentRoute.capability.adapter.capabilityId !== route.adapterCapabilityId
          || currentRoute.capability.adapter.capabilityVersion !== route.adapterCapabilityVersion
          || currentRoute.capability.capacity.kind !== "accountless"
          || !currentRoute.createAdapter
          || !agent
          || currentDeliberation?.status === "denied"
          || !sameNativeHarnessDeliberationResolution(
            route.deliberationResolution,
            toNativeHarnessDeliberationResolution(currentDeliberation),
          )
        ) {
          throw new AgentTaskApplicationError("route_unavailable", "Restore the exact admitted native-harness Runtime route.");
        }
        const dataPolicyDecision = assertNativeRouteDataPolicy(route);
        const adapter = await currentRoute.createAdapter();
        if (!adapter) throw new AgentTaskApplicationError("route_unavailable", "Materialize the exact admitted native-harness adapter after the dispatch fence.");
        const request = defineManagedAgentInvocationRequest({
          invocationId: `agent-task:${job.id}`,
          agentId: job.configuredAgentProfileId,
          parentSessionId: job.parent?.invocationId ?? job.id,
          parentTurnId: job.parent?.turnId ?? job.id,
          profile: job.admissionProfileId,
          requestedBy: job.callerId,
          requestSource: OPERATOR_AGENT_TASK_SOURCE,
          providerRoute: {
            providerId: route.providerId,
            surface: currentRoute.surface ?? "cli-harness",
            model: route.model,
            // Equality with the committed Runtime subset above proves this Core
            // resolution is the exact admitted level and capability evidence.
            ...(currentDeliberation?.status === "exact" || currentDeliberation?.status === "clamped"
              ? { deliberationResolution: currentDeliberation }
              : {}),
          },
          adapterKind: adapter.descriptor.adapterKind,
          executionMode: adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
          ...agentTaskRequestedAuthority(job.admissionProfileId),
          authority: {
            authorityProfileId: profile.authorityProfileId,
            permissionProfile: profile.permissionProfile,
            toolAuthority: {
              allowedToolNames: profile.allowedToolNames,
              writeAllowed: profile.writeAllowed ?? false,
              networkAllowed: profile.networkAllowed ?? false,
            },
            workingDirectory: profile.workingDirectory,
            timeoutMs: profile.timeoutMs,
            credentialRoute: profile.credentialRoute,
            memoryScope: profile.memoryScope,
            ...(profile.readAuthority ? { readAuthority: profile.readAuthority } : {}),
            ...(profile.writeAuthority ? { writeAuthority: profile.writeAuthority } : {}),
          },
          input: { summary: job.objective },
        });
        const started = await invocationService.start(request, adapter, {
          capturedAt: new Date().toISOString(),
          routeId: currentRoute.routeId,
          routeSource: currentRoute.routeSource,
          ...(callerIdentity ? { callerIdentity } : {}),
          ...(currentRoute.externalRuntimeAttachment ? { externalRuntimeAttachment: currentRoute.externalRuntimeAttachment } : {}),
          ...(currentRoute.providerModelProof ? { providerModelProof: currentRoute.providerModelProof } : {}),
        }, {
          ...(abortSignal ? { abortSignal } : {}),
          ...(consumedWriteApproval ? { consumedWriteApproval } : {}),
        });
        if (started.status !== "started") {
          throw new AgentTaskApplicationError("admission_denied", "Review the exact admitted native-harness Runtime authority.");
        }
        const joined = await invocationService.join(request.invocationId);
        const progressEvents = invocationService.status(request.invocationId)?.progressEvents;
        if (joined.status !== "completed" || joined.record.lifecycleState !== "completed" || !joined.record.resultHandoff) {
          throw agentTaskExecutionFailure(
            joined.status === "completed" ? joined.record : undefined,
            progressEvents,
          );
        }
        const writeEvidence = sanitizeManagedWriteEvidence(joined.record);
        return {
          runtimeInvocationId: joined.record.invocationId,
          completedAt: new Date().toISOString(),
          resultHandoff: joined.record.resultHandoff,
          dataPolicyProof: {
            version: 1,
            jobId: job.id,
            dispatchFenceId,
            routeId: route.routeId,
            providerId: route.providerId,
            providerModelId: route.model,
            decision: dataPolicyDecision.decision,
            evidence: dataPolicyDecision.evidence!,
          } satisfies AgentTaskDataPolicyProof,
          ...(writeEvidence ? { writeEvidence } : {}),
        };
      },
    },
    economicExecution: {
      execute: async ({ job, preparation, consumedWriteApproval, workLimits }) => {
        if (!managedAccountComposition) {
          throw new AgentTaskApplicationError("route_unavailable", "Restore the process-owned managed economic Runtime authority.");
        }
        const selectedIdentity = preparation.commitment.reservation.selectedIdentity;
        const selected = selectedIdentity.route;
        const selectedCandidate = job.dispatch.kind === "economic"
          ? job.dispatch.candidateSet.candidates.find((candidate) =>
              candidate.routeId === selected.routeId
              && candidate.providerId === selected.providerId
              && candidate.model === selected.modelId)
          : undefined;
        if (!selectedCandidate) {
          throw new AgentTaskApplicationError(
            "identity-revision-conflict",
            "Restore the exact selected managed economic candidate before execution.",
          );
        }
        const dataPolicyDecision = managedAccountComposition.routing.assertAdmittedDataPolicy({
          routeId: selected.routeId,
          providerId: selected.providerId,
          providerModelId: selected.modelId,
        });
        if (!dataPolicyDecision.evidence) {
          throw new AgentTaskApplicationError("route_unavailable", "Restore exact admitted managed Runtime data-policy evidence.");
        }
        const execution = await freshManagedInvocation("execution", managedAccountComposition);
        const route = execution.routes.find((candidate) =>
          candidate.routeId === selected.routeId
          && candidate.providerId === selected.providerId
          && candidate.model === selected.modelId);
        if (
          !route
          || route.economicCapability?.status !== "verified"
          || route.economicCapability?.adapterCapabilityId !== selected.adapterCapabilityId
          || route.economicCapability?.adapterCapabilityVersion !== selected.adapterCapabilityVersion
        ) {
          throw new AgentTaskApplicationError("route_unavailable", "Restore the exact committed managed Runtime route.");
        }
        const catalogEntry = execution.agentCatalog?.find((candidate) => candidate.name === job.configuredAgentProfileId);
        const profile = catalogEntry
          ? resolveConfiguredManagedInvocationRouteProfile(route, catalogEntry, job.admissionProfileId)
          : undefined;
        const invocationService = execution.invocationService;
        if (!profile || !invocationService) {
          throw new AgentTaskApplicationError("route_unavailable", "Restore the exact committed managed Runtime route.");
        }
        if (
          selectedCandidate.profileAuthorityDigest
          !== digestManagedEconomicCandidateProfileAuthority(profile, `agent-task:${job.id}`)
        ) {
          throw new AgentTaskApplicationError(
            "identity-revision-conflict",
            "Restore the exact selected managed economic execution authority.",
          );
        }
        const request = defineManagedAgentInvocationRequest({
          invocationId: `agent-task:${job.id}`,
          agentId: job.configuredAgentProfileId,
          parentSessionId: job.parent?.invocationId ?? job.id,
          parentTurnId: job.parent?.turnId ?? job.id,
          profile: job.admissionProfileId,
          requestedBy: job.callerId,
          requestSource: OPERATOR_AGENT_TASK_SOURCE,
          providerRoute: {
            providerId: selected.providerId,
            surface: route.surface ?? "direct-provider",
            model: selected.modelId,
          },
          adapterKind: preparation.adapter.descriptor.adapterKind,
          executionMode: preparation.adapter.descriptor.supportedExecutionModes[0] ?? "direct-provider",
          ...agentTaskRequestedAuthority(job.admissionProfileId),
          authority: {
            authorityProfileId: profile.authorityProfileId,
            permissionProfile: profile.permissionProfile,
            toolAuthority: {
              allowedToolNames: profile.allowedToolNames,
              writeAllowed: profile.writeAllowed ?? false,
              networkAllowed: profile.networkAllowed ?? false,
            },
            workingDirectory: profile.workingDirectory,
            timeoutMs: profile.timeoutMs,
            credentialRoute: profile.credentialRoute,
            memoryScope: profile.memoryScope,
            ...(profile.readAuthority ? { readAuthority: profile.readAuthority } : {}),
            ...(profile.writeAuthority ? { writeAuthority: profile.writeAuthority } : {}),
          },
          input: { summary: job.objective },
        });
        const started = await invocationService.start(request, preparation.adapter, {
          capturedAt: new Date().toISOString(),
          routeId: route.routeId,
          routeSource: route.routeSource,
          callerIdentity: {
            kind: "kiln-runtime",
            surface: OPERATOR_AGENT_TASK_SOURCE,
            attachmentId: `agent-task:${job.id}`,
          },
          ...(route.providerModelProof ? { providerModelProof: route.providerModelProof } : {}),
        }, {
          abortSignal: preparation.abortSignal,
          ...(workLimits ? { workLimits } : {}),
          ...(consumedWriteApproval ? { consumedWriteApproval } : {}),
          economicDispatch: {
            commitment: preparation.commitment,
            dispatchFenceId: preparation.dispatchFenceId,
            recordExecutionSettlementPending: preparation.recordExecutionSettlementPending,
            createExecutionSettlement: preparation.createExecutionSettlement,
            registerEconomicSettlement: preparation.registerEconomicSettlement,
          },
        });
        if (started.status !== "started") {
          throw new AgentTaskApplicationError("admission_denied", "Review the exact committed managed Runtime authority.");
        }
        const joined = await invocationService.join(request.invocationId);
        const progressEvents = invocationService.status(request.invocationId)?.progressEvents;
        if (
          joined.status === "completed"
          && joined.record.lifecycleState === "cancelled"
          && preparation.abortSignal.aborted
        ) {
          throw new AgentTaskApplicationError(
            "provider_timeout",
            "Retry the exact admitted managed route after verifying provider availability.",
            agentTaskProviderTimeoutEvidence(joined.record, progressEvents),
          );
        }
        if (joined.status !== "completed" || joined.record.lifecycleState !== "completed" || !joined.record.resultHandoff) {
          throw agentTaskExecutionFailure(
            joined.status === "completed" ? joined.record : undefined,
            progressEvents,
          );
        }
        const writeEvidence = sanitizeManagedWriteEvidence(joined.record);
        return {
          runtimeInvocationId: joined.record.invocationId,
          completedAt: new Date().toISOString(),
          resultHandoff: joined.record.resultHandoff,
          dataPolicyProof: {
            version: 1,
            jobId: job.id,
            dispatchFenceId: preparation.dispatchFenceId,
            routeId: selected.routeId,
            providerId: selected.providerId,
            providerModelId: selected.modelId,
            decision: dataPolicyDecision.decision,
            evidence: dataPolicyDecision.evidence,
          } satisfies AgentTaskDataPolicyProof,
          ...(writeEvidence ? { writeEvidence } : {}),
        };
      },
    },
    commitmentRecovery,
    store: agentTaskStore,
    ...(options.requestEconomicApproval ? { requestEconomicApproval: options.requestEconomicApproval } : {}),
  });
  const dispatcher = new OperatorProjectAgentTaskDispatcher(service);
  const recoveredJobs = await service.recoverInterrupted();
  for (const job of recoveredJobs) {
    if (job.dispatch.kind === "economic" && (job.state === "queued" || job.state === "running")) {
      dispatcher.enqueue(job.id);
    }
  }
  const application: OperatorProjectAgentTaskApplicationPort & OperatorProjectManagedWriteApprovalPort = {
    accept: async (input, callerIdentity) => {
      const job = await service.accept(input);
      if (job.state !== "awaiting_approval") dispatcher.enqueue(job.id, callerIdentity);
      return job;
    },
    approveWrite: async (jobId, expiresAt) => {
      const job = await agentTaskStore.get(jobId);
      if (!job) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
      if (job.state !== "awaiting_approval" || job.admissionProfileId !== "foundation-apply-approved-writes" || job.writeApproval !== undefined) {
        throw new AgentTaskApplicationError("invalid_transition", "Approve only an awaiting managed approved-write job once.");
      }
      const binding = managedWriteApprovalBinding(job);
      const issued = writeApprovalAuthority.issue({
        binding,
        approverId: TRUSTED_WRITE_APPROVER_ID,
        expiresAt,
      });
      try {
        const attached = await service.attachWriteApproval(
          { project, callerId: job.callerId },
          job.id,
          issued.approvalId,
        );
        dispatcher.enqueue(attached.id);
        return attached;
      } catch (error) {
        try {
          writeApprovalAuthority.revoke({ approvalId: issued.approvalId, projectId: job.projectId });
        } catch {
          // Keep the original attach failure; an issued-but-unattached receipt cannot authorize dispatch.
        }
        throw error;
      }
    },
    getStatus: (input, jobId) => service.getStatus({ project, callerId: input.callerId }, jobId),
    getResult: (input, jobId) => service.getResult({ project, callerId: input.callerId }, jobId),
    cancel: (input, jobId) => service.cancel({ project, callerId: input.callerId }, jobId),
    getReplay: (input, jobId) => service.getReplay({ project, callerId: input.callerId }, jobId),
  };
  return {
    service,
    application,
    configuredAgents: summarizeOperatorProjectManagedAgents(configuredAgents, managedInvocation),
    ...(managedAccountComposition ? {
      economicAuthority: {
        acquire: (input) => managedAccountComposition.authority.acquireCommitment(input),
        releasePreFence: (jobId, economicAttemptId) => {
          managedAccountComposition.authority.releaseCommitmentPreFence(jobId, economicAttemptId);
        },
        fenceDispatch: (jobId, economicAttemptId, dispatchFenceId, actionClaim) => {
          managedAccountComposition.authority.fenceDispatch(jobId, economicAttemptId, dispatchFenceId, actionClaim);
        },
        readDispatch: (jobId, economicAttemptId, dispatchFenceId, actionClaim) => {
          return managedAccountComposition.authority.readDispatch(jobId, economicAttemptId, dispatchFenceId, actionClaim);
        },
        settleExecution: (jobId, economicAttemptId, dispatchFenceId, settlement) => {
          managedAccountComposition.authority.settleExecution(jobId, economicAttemptId, dispatchFenceId, settlement);
        },
        recordExecutionSettlementPending: (jobId, economicAttemptId, dispatchFenceId, reason) => {
          managedAccountComposition.authority.recordExecutionSettlementPending(
            jobId,
            economicAttemptId,
            dispatchFenceId,
            reason,
          );
        },
      },
    } : {}),
    close: async () => {
      await dispatcher.close();
      try {
        writeApprovalAuthority.close();
      } finally {
        try {
          managedDirectToolActionClaims.close();
        } finally {
          try {
            managedDirectModelRoundActionClaims.close();
          } finally {
            managedInvocationService?.close();
            if (ownsManagedAccountComposition) closeManagedAccountRuntimeComposition(root.rootPath);
          }
        }
      }
    },
  };
}

function agentTaskExecutionFailure(
  record: ManagedAgentInvocationRecord | undefined,
  progressEvents?: readonly ManagedAgentRuntimeInvocationProgressEvent[],
): AgentTaskExecutionFailure | AgentTaskApplicationError {
  if (record?.lifecycleState === "timed_out") {
    return new AgentTaskApplicationError(
      "provider_timeout",
      "Retry the exact admitted managed route after verifying provider availability.",
      agentTaskProviderTimeoutEvidence(record, progressEvents),
    );
  }
  const diagnostic = record?.diagnostics?.find((candidate) => candidate.classification !== undefined)
    ?? record?.diagnostics?.[0];
  return new AgentTaskExecutionFailure(
    agentTaskFailureClassification(diagnostic?.classification),
    diagnostic?.uri,
  );
}

function agentTaskProviderTimeoutEvidence(
  record: ManagedAgentInvocationRecord | undefined,
  progressEvents?: readonly ManagedAgentRuntimeInvocationProgressEvent[],
) {
  const diagnosticUri = record?.diagnostics?.find((candidate) => candidate.kind === "timeout")?.uri;
  const transportPhase = agentTaskProviderTransportPhase(progressEvents);
  return {
    version: 1 as const,
    classification: "provider_timeout" as const,
    ...(diagnosticUri ? { diagnosticUri } : {}),
    ...(transportPhase ? { transportPhase } : {}),
  };
}

function agentTaskProviderTransportPhase(
  progressEvents: readonly ManagedAgentRuntimeInvocationProgressEvent[] | undefined,
): "headers" | "first_byte" | "chunk_idle" | "transport" | undefined {
  let phase: "headers" | "first_byte" | "chunk_idle" | "transport" | undefined;
  for (const event of progressEvents ?? []) {
    if (event.kind !== "provider_transport") continue;
    switch (event.metadata?.eventType) {
      case "request_failed": {
        const failedPhase = event.metadata.phase;
        if (failedPhase === "headers" || failedPhase === "first_byte" || failedPhase === "chunk_idle" || failedPhase === "transport") {
          phase = failedPhase;
          break;
        }
        phase = "transport";
        break;
      }
      case "request_started": phase = "headers"; break;
      case "response_headers": phase = "first_byte"; break;
      case "response_first_byte": phase = "chunk_idle"; break;
      case "request_completed": phase = undefined; break;
      default: break;
    }
  }
  return phase;
}

function agentTaskFailureClassification(
  classification: string | undefined,
): AgentTaskExecutionFailureClassification {
  if (
    classification === "harness_version_mismatch"
    || classification === "structured_handoff_rejected"
    || classification === "model_identity_mismatch"
    || classification === "private_artifact_cleanup_failed"
    || classification === "provider_quota_exhausted"
    || classification === "native_session_error"
    || classification === "write_boundary_violation"
    || classification === "result_handoff_missing"
    || classification === "provider_timeout"
  ) {
    return classification;
  }
  return "unknown_failure";
}

function agentTaskRequestedAuthority(
  admissionProfileId: AgentTaskRecord["admissionProfileId"],
): {
  readonly requestedAuthority: "read_only" | "destructive";
  readonly authorityApproval?: { readonly approved: true };
} {
  return admissionProfileId === "foundation-apply-approved-writes"
    ? { requestedAuthority: "destructive", authorityApproval: { approved: true } }
    : { requestedAuthority: "read_only" };
}

function managedWriteApprovalBinding(job: AgentTaskRecord): ManagedWriteApprovalBinding {
  const route = job.dispatch.kind === "native-harness"
    ? {
        routeId: job.dispatch.routeId,
        providerId: job.dispatch.providerId,
        model: job.dispatch.model,
        adapterCapabilityId: job.dispatch.adapterCapabilityId,
        adapterCapabilityVersion: job.dispatch.adapterCapabilityVersion,
      }
    : job.dispatch.candidateSet.candidates.length === 1
      ? job.dispatch.candidateSet.candidates[0]
      : undefined;
  if (
    route === undefined
    || typeof route.model !== "string"
    || route.model.trim().length === 0
  ) {
    throw new AgentTaskApplicationError("route_unavailable", "Approved managed writes require one exact route with a model identity.");
  }
  const routeIdentity = {
    routeId: route.routeId,
    providerId: route.providerId,
    model: route.model,
    adapterCapabilityId: route.adapterCapabilityId,
    adapterCapabilityVersion: route.adapterCapabilityVersion,
    ...("profileAuthorityDigest" in route && route.profileAuthorityDigest !== undefined
      ? { profileAuthorityDigest: route.profileAuthorityDigest }
      : {}),
  };
  return {
    projectId: job.projectId,
    jobId: job.id,
    callerId: job.callerId,
    workItemFingerprint: job.requestFingerprint,
    configuredAgentProfileId: job.configuredAgentProfileId,
    admissionProfileId: "foundation-apply-approved-writes",
    routeId: route.routeId,
    providerId: route.providerId,
    model: route.model,
    adapterCapabilityId: route.adapterCapabilityId,
    adapterCapabilityVersion: route.adapterCapabilityVersion,
    authorityDigest: digestManagedEconomicValue({
      kind: "managed-write-authority",
      admissionProfileId: job.admissionProfileId,
      route: routeIdentity,
    }),
    effectDigest: digestManagedEconomicValue({
      kind: "managed-write-effect",
      jobId: job.id,
      requestFingerprint: job.requestFingerprint,
      route: routeIdentity,
    }),
    revisionDigest: digestManagedEconomicValue({
      kind: "managed-write-revision",
      adoptedDecisionAt: job.adoptedDecisionAt,
      dispatch: job.dispatch,
    }),
  };
}

function sanitizeManagedWriteEvidence(
  record: ManagedAgentInvocationRecord,
): readonly ManagedAgentWriteEvidence[] | undefined {
  // Runtime's final result validator owns canonicalization and redaction.
  return record.writeEvidence && record.writeEvidence.length > 0
    ? record.writeEvidence
    : undefined;
}

type OperatorManagedInvocationRoute = NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["routes"][number];

function resolveNativeHarnessRouteForAgent(
  agent: KilnAgentDefinition,
  routes: readonly OperatorManagedInvocationRoute[],
): OperatorManagedInvocationRoute | undefined {
  const route = routes.find((candidate) =>
    agent.targetId ? candidate.routeId === agent.targetId : false);
  if (!route || !route.model || !isNativeHarnessAdapterKind(route.capability.adapter.kind)) return undefined;
  if (route.capability.capacity.kind !== "accountless") return undefined;
  return route;
}

function isNativeHarnessAdapterKind(kind: string): boolean {
  return kind === "native-harness" || kind === "cli-harness" || kind === "governed-external-runtime";
}

function createNativeHarnessProfile(
  agent: KilnAgentDefinition,
  admissionProfileId: AgentTaskNativeHarnessProfile["admissionProfileId"],
  route: OperatorManagedInvocationRoute,
  acknowledgedAt: string,
  deliberationPolicy: ManagedAgentRouteConfigSource["deliberationPolicy"],
): AgentTaskNativeHarnessProfile | undefined {
  const resolvedDeliberation = resolveNativeHarnessDeliberation(agent, route, deliberationPolicy);
  if (resolvedDeliberation?.status === "denied") return undefined;
  const deliberationResolution = toNativeHarnessDeliberationResolution(resolvedDeliberation);
  if ((resolvedDeliberation?.status === "exact" || resolvedDeliberation?.status === "clamped") && !deliberationResolution) return undefined;
  const acknowledgement = {
    version: 1 as const,
    source: "managed-route-admission" as const,
    credentialMode: "credentialless" as const,
    acknowledgedAt,
    routeId: route.routeId,
    routeRevision: route.capability.identity.revision,
    providerId: route.providerId,
    model: route.model!,
    admissionProfileId,
    adapterCapabilityId: route.capability.adapter.capabilityId,
    adapterCapabilityVersion: route.capability.adapter.capabilityVersion,
    ...(deliberationResolution ? { deliberationResolution } : {}),
  };
  return {
    kind: "native-harness",
    id: agent.name,
    authorityProfileId: agent.authorityProfileId!,
    admissionProfileId,
    routeId: route.routeId,
    routeRevision: route.capability.identity.revision,
    providerId: route.providerId,
    model: route.model!,
    adapterCapabilityId: route.capability.adapter.capabilityId,
    adapterCapabilityVersion: route.capability.adapter.capabilityVersion,
    acknowledgement,
    ...(deliberationResolution ? { deliberationResolution } : {}),
  };
}

function nativeHarnessRouteFromProfile(
  profile: AgentTaskNativeHarnessProfile,
  route: OperatorManagedInvocationRoute,
  agent: KilnAgentDefinition,
  deliberationPolicy: ManagedAgentRouteConfigSource["deliberationPolicy"],
): AgentTaskNativeHarnessRoute | undefined {
  const resolvedDeliberation = resolveNativeHarnessDeliberation(agent, route, deliberationPolicy);
  if (resolvedDeliberation?.status === "denied") return undefined;
  const deliberationResolution = toNativeHarnessDeliberationResolution(resolvedDeliberation);
  if ((resolvedDeliberation?.status === "exact" || resolvedDeliberation?.status === "clamped") && !deliberationResolution) return undefined;
  if (!sameNativeHarnessDeliberationResolution(profile.deliberationResolution, deliberationResolution)) return undefined;
  return {
    kind: "native-harness",
    admissionProfileId: profile.admissionProfileId,
    routeId: route.routeId,
    routeRevision: route.capability.identity.revision,
    providerId: route.providerId,
    model: route.model!,
    adapterCapabilityId: route.capability.adapter.capabilityId,
    adapterCapabilityVersion: route.capability.adapter.capabilityVersion,
    acknowledgement: profile.acknowledgement,
    ...(deliberationResolution ? { deliberationResolution } : {}),
  };
}

function resolveNativeHarnessDeliberation(
  agent: KilnAgentDefinition,
  route: OperatorManagedInvocationRoute,
  policy: ManagedAgentRouteConfigSource["deliberationPolicy"],
): DeliberationResolution | undefined {
  const resolution = resolveConfiguredDeliberation({
    policy,
    task: agent.taskAffinity?.[0],
    provider: route.providerId,
    model: route.model,
    capabilities: route.deliberationCapabilities,
  });
  return resolution.status === "omitted" && resolution.reason === "not-requested"
    ? undefined
    : resolution;
}

function toNativeHarnessDeliberationResolution(
  resolution: DeliberationResolution | undefined,
): AgentTaskNativeDeliberationResolution | undefined {
  if (resolution === undefined || (resolution.status !== "exact" && resolution.status !== "clamped")) return undefined;
  if (resolution.status === "clamped") {
    if (resolution.reason !== "preferred-level-outside-bounds") return undefined;
    return {
      status: "clamped",
      selectedLevel: resolution.selectedLevel,
      source: resolution.source,
      reason: resolution.reason,
      capabilityEvidence: resolution.capabilityEvidence!,
    };
  }
  return {
    status: "exact",
    selectedLevel: resolution.selectedLevel,
    source: resolution.source,
    capabilityEvidence: resolution.capabilityEvidence!,
  };
}

function sameNativeHarnessDeliberationResolution(
  left: AgentTaskNativeDeliberationResolution | undefined,
  right: AgentTaskNativeDeliberationResolution | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.status === right.status
    && left.selectedLevel === right.selectedLevel
    && left.source === right.source
    && left.capabilityEvidence.sourceIdentity === right.capabilityEvidence.sourceIdentity
    && left.capabilityEvidence.sourceRevision === right.capabilityEvidence.sourceRevision
    && (left.status !== "clamped" || (right.status === "clamped" && left.reason === right.reason));
}

export function summarizeOperatorProjectManagedAgents(
  configuredAgents: readonly KilnAgentDefinition[],
  resolution: ManagedInvocationRouteResolution["managedInvocation"],
): readonly OperatorProjectManagedAgentSummary[] {
  return configuredAgents.flatMap((agent): readonly OperatorProjectManagedAgentSummary[] => {
    const catalogEntry = resolution?.agentCatalog?.find(
      (candidate) => candidate.name === agent.name,
    );
    const admissionProfileId = catalogEntry?.admissionProfile ?? REQUIRED_ADMISSION_PROFILE_ID;
    const base = {
      configuredAgentProfileId: agent.name,
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.role ? { role: agent.role } : {}),
      admissionProfileId,
    };
    if (!catalogEntry?.economicPolicyId) {
      const nativeRoute = resolveNativeHarnessRouteForAgent(agent, resolution?.routes ?? []);
      if (nativeRoute && catalogEntry
        && resolveConfiguredManagedInvocationRouteProfile(nativeRoute, catalogEntry, admissionProfileId)) {
        return [{
          ...base,
          admissionProfileId,
          availability: "admitted",
          providerFamily: nativeRoute.providerId,
        }];
      }
      return [{
        ...base,
        admissionProfileId,
        availability: "unavailable",
        diagnostic: "route_unavailable",
        operatorAction: "Restore the exact configured native-harness route and its read-only admission profile.",
      }];
    }
    const economicCatalogEntry = catalogEntry;
    const policyRouteIds = new Set(
      economicCatalogEntry?.economicPolicyCandidateRouteIds ?? [],
    );
    const admittedRoutes = (resolution?.routes ?? []).filter(
      (route) =>
        policyRouteIds.has(route.routeId)
        && (!agent.targetId || route.routeId === agent.targetId)
        && economicCatalogEntry !== undefined
        && resolveConfiguredManagedInvocationRouteProfile(route, economicCatalogEntry, admissionProfileId) !== undefined
        && route.economicCapability?.status === "verified",
    );
    if (admittedRoutes.length > 0) {
      const providers = [...new Set(admittedRoutes.map((route) => route.providerId))];
      return [{
        ...base,
        availability: "admitted",
        ...(providers.length === 1 ? { providerFamily: providers[0] } : {}),
      }];
    }
    const unavailable = resolution?.unavailableRoutes?.find((candidate) =>
      policyRouteIds.has(candidate.routeId)
      && candidate.profiles.includes(admissionProfileId));
    if (unavailable) {
      return [{
        ...base,
        availability: "unresolved",
        providerFamily: unavailable.providerId,
        diagnostic: "eligibility_unresolved",
        operatorAction: "Refresh canonical managed-route eligibility evidence before invoking this configured agent.",
      }];
    }
    return [{
      ...base,
      availability: "unavailable",
      diagnostic: "route_unavailable",
      operatorAction: "Restore at least one admitted route for the configured managed-agent intent.",
    }];
  });
}

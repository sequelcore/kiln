// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Shared type/interface declarations: public options/catalog/route shapes plus
// internal parsed-input/result shapes. Nothing executable.
import type {
  ArtifactResourceStore,
  CanonicalSessionEvent,
  CommunicationIntent,
  DeliberationIntent,
  KilnWorkGovernanceEvidence,
  ManagedAgentAdmissionProfile,
  ManagedAgentAuthorityProfile,
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentCredentialRoute,
  ManagedAgentExternalRuntimeAttachmentIdentity,
  ManagedAgentInvocationContextMode,
  ManagedAgentMemoryScope,
  ManagedAgentProviderRoute,
  ManagedAgentRequestedAuthority,
  RouteCapability,
  ResolvedCommunicationIntent,
  ManagedAgentResultField,
  ManagedAgentRouteSource,
  ManagedAgentWorkingDirectory,
  ManagedEconomicCommitment,
  ModelDeliberationCapabilities,
  ModelTaskSuitability,
  ModelTaskSuitabilityTask,
  WorkClassification,
  WorkItemPauseRequirement,
  WorkRecommendedSkillDiagnostic,
  BoundedWorkEffect,
} from "@kilnai/core";
import type { RuntimeBuiltinToolExecutionContext } from "../../../session/runtime-session-orchestrator.types.js";
import type { ManagedAgentRuntimeAdapter, RuntimeManagedAgentInvocationService } from "../index.js";
import type {
  ManagedEconomicDispatchPreparation,
  ManagedEconomicDispatchPrepareInput,
  ManagedEconomicLifecycleEventPort,
} from "../economic-dispatch-coordinator.js";
import type { ManagedEconomicCandidateSet } from "./economic-candidate-collection.js";

export interface ManagedInvocationRouteProfile {
  readonly authorityProfileId: string;
  readonly admissionProfile: ManagedAgentAdmissionProfile;
  readonly permissionProfile: string;
  readonly allowedToolNames: readonly string[];
  /**
   * Roadmap 01 Slice 1 - Evidence Realization Contract. Declares which of
   * this route's own admitted tools can realize a given evidence id (e.g. an
   * MCP-only external-runtime route declaring which of its qualified tools
   * satisfy "tests"/"typecheck"). Every listed tool must also appear in
   * `allowedToolNames` or the declaration is treated as unsatisfied, never
   * silently accepted - see `resolveEvidenceRealization` in `@kilnai/core`.
   */
  readonly evidenceRealizations?: Partial<Record<KilnWorkGovernanceEvidence, readonly string[]>>;
  readonly writeAllowed?: boolean;
  readonly networkAllowed?: boolean;
  readonly workingDirectory: ManagedAgentWorkingDirectory;
  readonly workingDirectoryLease?: ManagedInvocationWorkingDirectoryLease;
  readonly timeoutMs: number;
  readonly timeoutSource?: ManagedAgentAuthorityProfile["timeoutSource"];
  readonly credentialRoute: ManagedAgentCredentialRoute;
  readonly memoryScope: ManagedAgentMemoryScope;
  readonly readAuthority?: ManagedAgentAuthorityProfile["readAuthority"];
  readonly writeAuthority?: ManagedAgentAuthorityProfile["writeAuthority"];
}

export type ManagedEconomicRouteCapability =
  | {
      readonly status: "verified";
      readonly adapterCapabilityId: string;
      readonly adapterCapabilityVersion: string;
    }
  | {
      readonly status: "unverified";
    };

export interface ManagedInvocationToolRoute {
  readonly routeId: string;
  readonly economicPolicyIds?: readonly string[];
  readonly accountPolicyId?: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly providerId: string;
  readonly model?: string;
  /** Canonical, data-only admission envelope. No adapter is materialized here. */
  readonly capability: RouteCapability;
  readonly deliberationCapabilities?: ModelDeliberationCapabilities;
  readonly voiceProfile?: string;
  /** Materialized only after capability admission (and economic commitment when required). */
  readonly createAdapter?: () => Promise<ManagedAgentRuntimeAdapter | undefined>;
  readonly economicCapability?: ManagedEconomicRouteCapability;
  readonly createCommittedAdapter?: (
    request: ManagedCommittedInvocationRequest,
  ) => Promise<ManagedAgentRuntimeAdapter | undefined>;
  readonly surface?: string;
  readonly providerModelProof?: ManagedAgentCapabilitySnapshotInput["providerModelProof"];
  readonly taskSuitability?: readonly ModelTaskSuitability[];
  readonly profiles: readonly ManagedInvocationRouteProfile[];
  /**
   * Roadmap 01 Slice 3.1 - External-runtime target identity. A property of
   * the physical target, so it lives at route level (not per-profile): every
   * admission profile of one route addresses the same attached instance.
   * When declared, every dispatch against this route must request the exact
   * same attachment or be denied - see `evaluateManagedAgentAdmission` in
   * `@kilnai/core`.
   */
  readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
}

export interface ManagedInvocationUnavailableRoute {
  readonly routeId: string;
  readonly economicPolicyIds?: readonly string[];
  readonly accountPolicyId?: string;
  readonly economicCapability?: ManagedEconomicRouteCapability;
  readonly routeSource: ManagedAgentRouteSource;
  readonly providerId: string;
  readonly model?: string;
  readonly profiles: readonly ManagedAgentAdmissionProfile[];
  readonly reason: string;
}

export interface ManagedInvocationToolOptions {
  readonly routes: readonly ManagedInvocationToolRoute[];
  readonly unavailableRoutes?: readonly ManagedInvocationUnavailableRoute[];
  readonly agentCatalog?: readonly ManagedInvocationAgentCatalogEntry[];
  readonly skillCatalog?: readonly ManagedInvocationSkillCatalogEntry[];
  readonly requestedBy?: string;
  readonly requestSource?: string;
  readonly artifactStore?: ArtifactResourceStore;
  readonly invocationService?: RuntimeManagedAgentInvocationService;
  readonly invocationServiceKey?: string;
  readonly sessionEventSink?: ManagedInvocationSessionEventSink;
  readonly contextResolver?: ManagedInvocationContextResolver;
  readonly maxParallelChildren?: number;
  readonly pauseRequirementResolver?: ManagedInvocationPauseRequirementResolver;
  /** Unique in-process owner used to stop only children created by one attached surface. */
  readonly invocationOwner?: object;
  /** Project root used to redact durable economic-lifecycle session events. */
  readonly workspaceRoot?: string;
  readonly economicDispatch?: {
    prepare(input: {
      readonly candidateSet: ManagedEconomicCandidateSet;
      readonly jobId: string;
      readonly economicAttemptId: string;
      readonly intentFingerprint: string;
      readonly adoptedDecisionAt: string;
      readonly parentSessionId: string;
      readonly parentTurnId: string;
      readonly authorityProfileId: string;
      readonly invocationId: string;
      readonly abortSignal?: AbortSignal;
      readonly workLimitDurationMs?: number;
       readonly lifecycleEvents?: ManagedEconomicLifecycleEventPort;
       readonly validateAndConsumeApprovalBeforeFence?: ManagedEconomicDispatchPrepareInput["validateAndConsumeApprovalBeforeFence"];
       readonly validateExecutionProfile?: ManagedEconomicDispatchPrepareInput["validateExecutionProfile"];
     }): Promise<ManagedEconomicDispatchPreparation>;
  };
}

export type ManagedInvocationPauseRequirementResolver = (
  workItemId: string,
) => readonly WorkItemPauseRequirement[] | undefined;

export type ManagedInvocationToolOptionsWithService = ManagedInvocationToolOptions & {
  readonly invocationService: RuntimeManagedAgentInvocationService;
};

export interface ManagedInvocationToolAttachment {
  readonly options: ManagedInvocationToolOptions;
  readonly callerIdentity: ManagedAgentCallerAttachmentIdentity;
  readonly governedScopeAdmission?: ManagedInvocationGovernedScopeAdmission;
  readonly boundedWorkAdmission?: ManagedInvocationBoundedWorkAdmission;
}

export interface ManagedInvocationGovernedScopeAdmissionInput {
  readonly parentSessionId: string;
  readonly goalRunId: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly workItemId?: string;
  readonly attemptId?: string;
}

export type ManagedInvocationGovernedScopeAdmissionResult =
  | { readonly admitted: true }
  | {
      readonly admitted: false;
      readonly code: string;
      readonly message: string;
      readonly suggestedNextTool?: string;
    };

export type ManagedInvocationGovernedScopeAdmission = (
  input: ManagedInvocationGovernedScopeAdmissionInput,
) => ManagedInvocationGovernedScopeAdmissionResult;

export type ManagedInvocationBoundedWorkTerminalOutcome = "completed" | "failed" | "cancelled";

export interface ManagedInvocationBoundedWorkLifecycle {
  markDispatched(dispatchId: string): void;
  releaseBeforeDispatch(): void;
  settleTerminal(outcome: ManagedInvocationBoundedWorkTerminalOutcome, evidenceDigest: string): void;
  settleUnknown(reason: string): void;
}

export interface ManagedInvocationBoundedWorkAdmissionInput {
  readonly parentSessionId: string;
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly attemptId?: string;
  readonly invocationId: string;
  readonly routeId: string;
  readonly harnessId: string;
  readonly workspaceRoot: string;
  readonly routeWriteAllowedPaths: readonly string[];
  readonly routeWriteDeniedPaths: readonly string[];
  readonly writeRequested: boolean;
  readonly requestedEffects: readonly BoundedWorkEffect[];
  /** This attached surface dispatches a direct child of its owning runtime session. */
  readonly childDepth: 1;
}

export type ManagedInvocationBoundedWorkAdmissionResult =
  | {
      readonly admitted: true;
      readonly lifecycle: ManagedInvocationBoundedWorkLifecycle;
      readonly workspaceAuthority: {
        readonly allowedPaths: readonly string[];
        readonly deniedPaths: readonly string[];
      };
    }
  | {
      readonly admitted: false;
      readonly code: string;
      readonly message: string;
      readonly suggestedNextTool?: string;
    };

export type ManagedInvocationBoundedWorkAdmission = (
  input: ManagedInvocationBoundedWorkAdmissionInput,
) => ManagedInvocationBoundedWorkAdmissionResult;

export interface ManagedInvocationAgentCatalogEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly nicknameCandidates?: readonly string[];
  readonly role: string;
  readonly goal: string;
  readonly tier: string;
  readonly authorityProfileId: string;
  readonly admissionProfile: ManagedAgentAdmissionProfile;
  readonly skills?: readonly string[];
  readonly taskAffinity?: readonly ModelTaskSuitabilityTask[];
  readonly economicPolicyId?: string;
  readonly economicPolicyRevision?: string;
  readonly economicPolicyCandidateRouteIds?: readonly string[];
  /** Runtime-enforced admitted limits derived from the bounded operator intent. */
  readonly workLimits?: {
    readonly maxTurns?: number;
    readonly maxDurationMs?: number;
    readonly maxConcurrency?: number;
  };
  /** Nonzero comparable reservations require interactive approval before fencing. */
  readonly economicSpendApproval?: "required";
  readonly routeId?: string;
  readonly providerRoute?: {
    readonly providerId: string;
    readonly model?: string;
    readonly deliberationIntent?: DeliberationIntent;
    readonly communicationIntent?: ResolvedCommunicationIntent;
  };
  readonly voiceProfile?: string;
  readonly communication?: CommunicationIntent;
}

export interface ManagedInvocationWorkingDirectoryLease {
  readonly mode: "git-worktree";
  readonly sourcePath: string;
  readonly rootPath: string;
}

export interface ManagedInvocationSkillCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly origin?: string;
  readonly configured?: boolean;
  readonly builtIn?: boolean;
  readonly sourcePath?: string;
  readonly desiredVisibility?: "implicit" | "explicit-only" | "disabled";
  readonly admission?: {
    readonly state: string;
    readonly reason: string;
  };
  readonly projections?: readonly {
    readonly target: string;
    readonly status: string;
    readonly path: string;
  }[];
  readonly omissionReason?: string;
  readonly tags?: readonly string[];
}

export interface ManagedInvocationSessionEventSink {
  publish(
    events: readonly CanonicalSessionEvent[],
    context: RuntimeBuiltinToolExecutionContext,
  ): void | Promise<void>;
}

export interface ManagedInvocationContextResolverInput {
  readonly agentProfile?: string;
  readonly skills: readonly string[];
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly task: string;
  readonly providerRoute?: {
    readonly providerId: string;
    readonly model?: string;
  };
  readonly taskSuitability?: readonly ModelTaskSuitability[];
  readonly workClassification?: WorkClassification;
}

export interface ManagedInvocationContextResolution {
  readonly promptPrefix?: string;
  readonly admittedAgentProfile?: string;
  readonly admittedSkills?: readonly string[];
  readonly admittedInstructionProfiles?: readonly string[];
  readonly deniedSkills?: readonly string[];
  readonly workClassification?: WorkClassification;
  readonly workRecommendedSkills?: readonly string[];
  readonly workRecommendedSkillDiagnostics?: readonly WorkRecommendedSkillDiagnostic[];
}

export type ManagedInvocationContextResolver = (
  input: ManagedInvocationContextResolverInput,
) => ManagedInvocationContextResolution | Promise<ManagedInvocationContextResolution>;

/**
 * Slice 4 is the sole producer of this postcommit request. Declaring the
 * boundary here prevents adapters from accepting precommit commands.
 */
export interface ManagedCommittedInvocationRequest {
  readonly commitment: ManagedEconomicCommitment;
  readonly dispatchFenceId: string;
  readonly abortSignal: AbortSignal;
  readonly authorityProfileId: string;
  readonly admissionProfile: ManagedAgentAdmissionProfile;
  readonly profileAuthorityDigest: string;
  readonly invocationId: string;
}

export interface ManagedCommittedRouteMismatchEvidence {
  readonly code: "committed-route-mismatch";
  readonly expected: {
    readonly routeId: string;
    readonly providerId: string;
    readonly modelId: string;
  };
  readonly committed: {
    readonly routeId: string;
    readonly providerId: string;
    readonly modelId: string;
  };
}

// Internal request/result shapes shared across the managed-invocation tool
// modules (schema, execution, parsing, projection). Not part of the package
// barrel; only the ManagedInvocation*/ManagedCommitted*/ManagedEconomic*
// option/catalog/candidate types above are public.
export type ManagedInvocationExecutableRoute = ManagedInvocationToolRoute & {
  readonly adapter: ManagedAgentRuntimeAdapter;
};

export interface ManagedInvocationToolInput {
  readonly profile: ManagedAgentAdmissionProfile;
  readonly routeId?: string;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly externalRuntimeAttachment?: { readonly runtimeId: string; readonly attachmentId: string };
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly task: string;
  readonly summary: string;
  readonly resourceUris?: readonly string[];
  readonly agentProfile?: string;
  readonly forbiddenInputFields?: readonly string[];
  readonly skills?: readonly string[];
  readonly workClassification?: WorkClassification;
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly goalRunId?: string;
  readonly workItemId?: string;
  readonly attemptId?: string;
  readonly roleIntent?: string;
  readonly expectedEvidence?: readonly string[];
  readonly requiredToolNames?: readonly string[];
  readonly requiredReadPaths?: readonly string[];
  readonly requiredResultFields?: readonly ManagedAgentResultField[];
  readonly doneCriteria?: readonly string[];
  readonly residualRiskRequired?: boolean;
  readonly outputVerbosity?: "concise" | "standard" | "detailed";
  readonly executionPhase?: Record<string, unknown>;
  readonly boundedWorkEffects?: readonly BoundedWorkEffect[];
}

export interface ManagedInvocationToolResult {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata: Record<string, unknown>;
}

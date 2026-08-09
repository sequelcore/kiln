/**
 * GUI operator surface frame contracts.
 *
 * Outbound frames flow from the browser (operator) to the runtime gateway.
 * Inbound frames flow from the runtime gateway to the browser.
 */

import type { OperatorSurfaceKind } from "./operator-surface-capability.js";
import type { OperatorWorkspaceHomeProjection } from "./operator-workspace-home.js";

// --- Dashboard / HTTP response shapes ---

export interface GuiProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: "subscription" | "harness" | "direct-api";
  readonly models: readonly string[];
  readonly free: boolean;
  readonly available: boolean;
  readonly status?: GuiProviderDiscoveryStatus;
  readonly reason?: string;
  readonly authState?: GuiProviderAuthState;
  readonly lastCheckedAt?: string;
}

export type GuiProviderDiscoveryStatus =
  | "available"
  | "missing_auth"
  | "auth_expired"
  | "cli_missing"
  | "endpoint_timeout"
  | "endpoint_error"
  | "empty_model_list"
  | "model_version_unsupported"
  | "daemon_unreachable"
  | "model_selection_not_required"
  | "stale";

export type GuiProviderAuthState =
  | "authenticated"
  | "missing"
  | "expired"
  | "not_required"
  | "unknown";

export type GuiProviderCatalogStatus = "pending" | "refreshing" | "ready" | "error";

export type GuiDeliberationLevelId = string;
export type GuiDeliberationTarget = "latency-first" | "balanced" | "quality-first";
export type GuiUnsupportedDeliberationPolicy = "deny" | "omit" | "allow-clamp";
export type GuiDeliberationSource =
  | "operator"
  | "work-item"
  | "agent-profile"
  | "route"
  | "task"
  | "project"
  | "provider-default";

export interface GuiDeliberationCapabilityEvidence {
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly observedAt: string;
}

export type GuiDeliberationIntent =
  | { readonly mode: "provider-default"; readonly onUnsupported: GuiUnsupportedDeliberationPolicy }
  | {
      readonly mode: "fixed";
      readonly preferredLevel: GuiDeliberationLevelId;
      readonly bounds?: { readonly min?: GuiDeliberationLevelId; readonly max?: GuiDeliberationLevelId };
      readonly onUnsupported: GuiUnsupportedDeliberationPolicy;
    }
  | {
      readonly mode: "adaptive";
      readonly target: GuiDeliberationTarget;
      readonly bounds?: { readonly min?: GuiDeliberationLevelId; readonly max?: GuiDeliberationLevelId };
      readonly onUnsupported: GuiUnsupportedDeliberationPolicy;
    };

export interface GuiModelDeliberationCapabilities {
  readonly provider: string;
  readonly model: string;
  readonly levels: readonly { readonly id: GuiDeliberationLevelId; readonly nativeId?: string }[];
  readonly defaultLevel?: GuiDeliberationLevelId;
  readonly supportsAdaptive: boolean;
  readonly evidence: GuiDeliberationCapabilityEvidence;
}

export type GuiDeliberationResolution =
  | {
      readonly status: "exact" | "defaulted";
      readonly requested?: GuiDeliberationIntent;
      readonly selectedLevel: GuiDeliberationLevelId;
      readonly source: GuiDeliberationSource;
      readonly capabilityEvidence?: GuiDeliberationCapabilityEvidence;
    }
  | {
      readonly status: "clamped";
      readonly requested?: GuiDeliberationIntent;
      readonly selectedLevel: GuiDeliberationLevelId;
      readonly source: GuiDeliberationSource;
      readonly reason: string;
      readonly capabilityEvidence?: GuiDeliberationCapabilityEvidence;
    }
  | {
      readonly status: "omitted" | "denied";
      readonly requested?: GuiDeliberationIntent;
      readonly source: GuiDeliberationSource;
      readonly reason: string;
      readonly capabilityEvidence?: GuiDeliberationCapabilityEvidence;
    };

export type OperatorExecutionMode = "execute" | "plan";
export type OperatorTurnRequestedAuthority = "auto" | "read_only" | "audited" | "destructive";

export interface OperatorGoalMaterializationRequirement {
  readonly kind: "goal_materialization";
  readonly requiredWorkItemCount: number;
}

export type GuiAuthorityLevel =
  | "fail_closed"
  | "read_only"
  | "idempotent"
  | "audited"
  | "destructive"
  | "unknown";

export type GuiAuthorityCompleteness = "authoritative" | "partial";

export type GuiAuthoritySandboxProjection =
  | "none"
  | "read_only"
  | "workspace_write"
  | "unknown";

export interface GuiAuthorityPolicyInput {
  readonly source: string;
  readonly status: "applied" | "not_applicable" | "unresolved";
  readonly reason: string;
  readonly subjectId?: string;
  readonly requestedAuthority?: "planning" | OperatorTurnRequestedAuthority;
  readonly admittedAuthority?: GuiAuthorityLevel;
}

export interface GuiAuthorityStatus {
  readonly effective: GuiAuthorityLevel;
  readonly admittedAuthority?: GuiAuthorityLevel;
  readonly requestedAuthority?: "planning" | OperatorTurnRequestedAuthority;
  readonly executionMode?: OperatorExecutionMode;
  readonly sandboxProjection?: GuiAuthoritySandboxProjection;
  readonly reason?: string;
  readonly toolCount?: number;
  readonly deniedToolCount?: number;
  readonly policyInputs?: readonly GuiAuthorityPolicyInput[];
  readonly completeness: GuiAuthorityCompleteness;
}

export interface GuiProviderModelCapabilities {
  readonly supportsFunctionTools?: boolean;
  readonly supportsRuntimeTools?: boolean;
  readonly supportsNativeShellTools?: boolean;
  readonly supportsNativePatchTools?: boolean;
  readonly supportsTools?: boolean;
  readonly supportsStreaming?: boolean;
  readonly supportsStructuredOutput?: boolean;
  readonly supportsVision?: boolean;
  readonly supportsParallelToolCalls?: boolean;
  readonly contextWindow?: number;
  readonly deliberation?: GuiModelDeliberationCapabilities;
}

export interface GuiProviderModelRouteHealth {
  readonly healthy: boolean;
  readonly reason?: string;
  readonly cooldownUntil?: number;
}

export interface GuiModelRoutingDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface GuiModelRoutingRankingEvidence {
  readonly source: string;
  readonly task: string;
  readonly provider: string;
  readonly model: string;
  readonly rank: number;
  readonly sampleSize?: number;
  readonly confidence?: number;
  readonly expiresAt?: string;
}

export interface GuiModelRoutingRationale {
  readonly selectedProvider: string;
  readonly selectedModel: string;
  readonly canonicalModel?: string;
  readonly selectionMode: "automatic" | "explicit-operator-only";
  readonly deliberationResolution?: GuiDeliberationResolution;
  readonly routingReason: string;
  readonly confidence: number;
  readonly routingTier: "rule" | "complexity" | "cascade" | "default";
  readonly inputsUsed: {
    readonly tenantId: string;
    readonly complexityClass: string;
    readonly complexityScore: number;
    readonly hasTools: boolean;
    readonly toolCount: number;
    readonly requiresStreaming: boolean;
    readonly deliberationIntent?: GuiDeliberationIntent;
    readonly task?: string;
  };
  readonly rankingEvidence: readonly GuiModelRoutingRankingEvidence[];
  readonly diagnostics: readonly GuiModelRoutingDiagnostic[];
  readonly overrideSource?: string;
}

export interface GuiProviderDiscoveryResult {
  readonly provider: string;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly modelCapabilities?: Readonly<Record<string, GuiProviderModelCapabilities>>;
  readonly modelRouteHealth?: Readonly<Record<string, GuiProviderModelRouteHealth>>;
  readonly status: GuiProviderDiscoveryStatus;
  readonly reason: string;
  readonly authState: GuiProviderAuthState;
  readonly lastCheckedAt: string;
}

export type GuiProviderCatalogEvidenceStatus = "complete" | "partial" | "failed";

export interface GuiProviderCatalogEvidenceSource {
  readonly kind: string;
  readonly id: string;
  readonly version?: string;
}

export interface GuiProviderCatalogEvidenceCounts {
  readonly total: number;
  readonly returned: number;
  readonly omitted: number;
}

export interface GuiProviderCatalogEvidenceFailure {
  readonly classification: string;
  readonly summary: string;
}

export interface GuiProviderCatalogEvidenceSummary {
  readonly status: GuiProviderCatalogEvidenceStatus;
  readonly source: GuiProviderCatalogEvidenceSource;
  readonly observedAt: string;
  readonly counts: GuiProviderCatalogEvidenceCounts;
  readonly failure?: GuiProviderCatalogEvidenceFailure;
}

export interface GuiNormalizedModelIdentity {
  readonly family: string;
  readonly version?: string;
}

export interface GuiProviderModelRouteIdentity {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly scope: string;
}

export interface GuiHarnessModelRouteIdentity {
  readonly harnessId: string;
  readonly reportedProviderId: string;
  readonly reportedModelId: string;
}

export interface GuiProviderModelRawEvidenceSummary {
  readonly rawId: string;
  readonly provenance: string;
}

export interface GuiProviderModelCredentialEvidence {
  readonly state: "authenticated" | "missing" | "expired" | "not-required" | "unknown";
  readonly source: string;
}

export interface GuiProviderModelEntitlementEvidence {
  readonly state: "confirmed" | "denied" | "not-required" | "unknown";
  readonly source: string;
}

export interface GuiProviderModelFreshness {
  readonly status: "fresh" | "stale" | "unknown";
  readonly observedAt: string;
  readonly expiresAt?: string;
}

export interface GuiProviderModelRouteHealthEvidence {
  readonly status: "healthy" | "unhealthy" | "unknown";
  readonly reason?: string;
}

export interface GuiProviderModelPolicyAdmission {
  readonly use: "interactive" | "managed-agent" | "background";
  readonly status: "admitted" | "denied" | "unknown";
}

export type GuiProviderModelEligibilityReasonCode = string;

export interface GuiProviderModelEligibility {
  readonly eligible: boolean;
  readonly reasonCodes: readonly GuiProviderModelEligibilityReasonCode[];
}

export interface GuiProviderModelRouteEntry {
  readonly normalizedModel: GuiNormalizedModelIdentity;
  readonly providerRoute: GuiProviderModelRouteIdentity;
  readonly harnessRoute?: GuiHarnessModelRouteIdentity;
  readonly rawEvidence: GuiProviderModelRawEvidenceSummary;
  readonly credentialEvidence: GuiProviderModelCredentialEvidence;
  readonly entitlementEvidence: GuiProviderModelEntitlementEvidence;
  readonly freshness: GuiProviderModelFreshness;
  readonly routeHealth: GuiProviderModelRouteHealthEvidence;
  readonly policyAdmission: GuiProviderModelPolicyAdmission;
  readonly eligibility: GuiProviderModelEligibility;
}

export interface GuiProviderModelDiscoveryProjection {
  readonly catalogEvidence: GuiProviderCatalogEvidenceSummary;
  readonly entries: readonly GuiProviderModelRouteEntry[];
}

export type GuiProviderAuthMethod = "browser_oauth" | "device_code" | "api_key";

export interface GuiProviderAuthBrowserStarted {
  readonly type: "provider_auth_started";
  readonly provider: string;
  readonly requestId: string;
  readonly method: "browser_oauth";
  readonly authorizationUri: string;
  readonly message?: string;
}

export interface GuiProviderAuthDeviceCodeStarted {
  readonly type: "provider_auth_started";
  readonly provider: string;
  readonly requestId: string;
  readonly method: "device_code";
  readonly verificationUri: string;
  readonly userCode: string;
  readonly message?: string;
}

export interface GuiProviderAuthCompleted {
  readonly type: "provider_auth_completed";
  readonly provider: string;
  readonly requestId: string;
  readonly models: Record<string, string[]>;
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly providers?: readonly GuiProviderDescriptor[];
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection;
}

export interface GuiProviderAuthFailed {
  readonly type: "provider_auth_failed";
  readonly provider: string;
  readonly requestId: string;
  readonly message: string;
}

export type GuiSessionTurnOutcome = "completed" | "failed" | "cancelled" | "paused";

export interface GuiSessionSummary {
  readonly id: string;
  readonly title?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly providersUsed: readonly string[];
  readonly lastProvider?: string;
  readonly lastTurnOutcome?: GuiSessionTurnOutcome;
  readonly completedAt: string;
  readonly cost: number;
  readonly taskSummary: string;
}

export interface GuiSessionListResponse {
  readonly sessions: readonly GuiSessionSummary[];
}

export interface GuiTelemetrySnapshot {
  readonly status: string;
  readonly dominantRegions: readonly string[];
  readonly saturation: number;
  readonly entropy: number;
}

export interface GuiContinuationInfo {
  readonly strategy: string;
  readonly feedbackLabel?: string;
}

export interface GuiProviderThreadMeta {
  readonly provider: string;
  readonly providerSessionId?: string;
  readonly lastModel?: string;
  readonly lastUsedAt?: string;
}

export interface GuiWorkspaceTreeEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
}

export interface GuiWorkspaceTreeSnapshot {
  readonly rootPath: string;
  readonly entries: readonly GuiWorkspaceTreeEntry[];
  readonly truncated?: boolean;
  readonly source?: "gateway";
  readonly worktreePath?: string;
}

export interface GuiAppTenantDescriptor {
  readonly tenantId: string;
  readonly label?: string;
  readonly enabled: boolean;
}

export interface GuiAppDescriptor {
  readonly name: string;
  readonly runtime: "provider-adapter" | "tenant" | "none";
  readonly channels: readonly string[];
  readonly tenants?: readonly GuiAppTenantDescriptor[];
  readonly runtimeCapable: boolean;
}

export interface GuiDashboardSnapshot {
  readonly providers: readonly GuiProviderDescriptor[];
  readonly sessions: readonly GuiSessionSummary[];
  readonly telemetry: GuiTelemetrySnapshot;
  readonly continuationInfoByProvider: Readonly<Record<string, GuiContinuationInfo>>;
  readonly operatorWorkspaceHome?: OperatorWorkspaceHomeProjection;
  readonly apps?: readonly GuiAppDescriptor[];
  readonly activeAppName?: string;
  readonly activeTenantId?: string;
  readonly workingDirectory?: string;
  readonly domainLabel?: string;
  readonly workspaceTree?: GuiWorkspaceTreeSnapshot;
}

// --- Session detail / HTTP response shapes ---

export interface GuiSessionMeta {
  readonly kilnSessionId: string;
  readonly title?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly providersUsed?: readonly string[];
  readonly lastProvider?: string;
  readonly providerThreads?: readonly GuiProviderThreadMeta[];
  readonly task: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly lastTurnOutcome?: GuiSessionTurnOutcome;
  readonly costUsd?: number;
  readonly toolCount?: number;
  readonly turnDepth?: number;
  readonly resumeStrategy?: string;
  readonly resumeFeedback?: {
    readonly sampleSize: number;
    readonly preferredStrategy?: string;
    readonly influencedChoice: boolean;
  };
  readonly resumeOutcome?: {
    readonly succeeded: boolean;
    readonly finalProvider?: string;
    readonly costUsd: number;
    readonly toolCallCount: number;
    readonly durationMs: number;
    readonly verificationPassed?: boolean;
  };
  readonly sessionLedger?: {
    readonly currentPhase: string;
    readonly resumedFrom?: string;
    readonly workingDirectory?: string;
    readonly worktreePath?: string;
    readonly lastError?: string;
    readonly lastProvider?: string;
    readonly toolCallCount?: number;
    readonly turnDepth?: number;
  };
  readonly exactArtifacts?: readonly string[];
}

export type OperatorSessionEventKind =
  | "turn_started"
  | "user_message"
  | "assistant_message"
  | "assistant_delta"
  | "specification_submitted"
  | "clarification_recorded"
  | "plan_submitted"
  | "plan_analysis_reported"
  | "plan_approved"
  | "goal.created"
  | "goal.updated"
  | "goal.completed"
  | "goal.failed"
  | "goal.cancelled"
  | "work_items.materialized"
  | "provider_routed"
  | "multimodal_routed"
  | "tool_call_started"
  | "tool_call_output_delta"
  | "tool_call_completed"
  | "approval_requested"
  | "approval_resolved"
  | "config_change_proposed"
  | "config_change_approved"
  | "config_change_applied"
  | "config_change_failed"
  | "file_changed"
  | "cost_updated"
  | "context_usage_observed"
  | "lifecycle_attribution_recorded"
  | "work_item_updated"
  | "work_item_execution_started"
  | "work_item_execution_finished"
  | "agent_invocation_requested"
  | "agent_invocation_prompt_admitted"
  | "agent_invocation_prompt_recovered"
  | "agent_invocation_started"
  | "agent_invocation_completed"
  | "agent_invocation_failed"
  | "agent_invocation_cancelled"
  | "managed_economic_lifecycle"
  | "browser_operator_evidence"
  | "continuity_decided"
  | "error_recorded"
  | "turn_completed";

export type GuiSessionEventKind = OperatorSessionEventKind;

export type OperatorAgentInvocationSessionEventKind =
  | "agent_invocation_requested"
  | "agent_invocation_prompt_admitted"
  | "agent_invocation_prompt_recovered"
  | "agent_invocation_started"
  | "agent_invocation_completed"
  | "agent_invocation_failed"
  | "agent_invocation_cancelled";

export interface OperatorSessionEventSource {
  readonly actor: "user" | "assistant" | "system" | "tool" | "runtime";
  readonly surface: OperatorSurfaceKind;
  readonly component?: string;
}

export type OperatorExecutionScope =
  | {
      readonly kind: "goal";
      readonly goalRunId: string;
      readonly managedInvocationId?: string;
    }
  | {
      readonly kind: "work_item";
      readonly goalRunId: string;
      readonly workItemId: string;
      readonly attemptId?: string;
      readonly managedInvocationId?: string;
    };

export type GuiSessionEventSource = OperatorSessionEventSource;

export interface OperatorManagedAgentProviderRoute {
  readonly providerId: string;
  readonly surface: string;
  readonly model?: string;
  readonly deliberationIntent?: GuiDeliberationIntent;
}

export interface OperatorManagedAgentRouteHealthSnapshot {
  readonly status: "healthy";
  readonly reason: string;
}

export interface OperatorManagedAgentProviderModelProofSnapshot {
  readonly status: "live-proven" | "configured" | "unproven";
  readonly source: string;
  readonly requiresToolCalls?: boolean;
}

export interface OperatorManagedAgentResourcePlaneSnapshot {
  readonly available: boolean;
  readonly resourceUris: readonly string[];
  readonly reason?: string;
}

export interface OperatorManagedAgentWorktreeReviewSnapshot {
  readonly status: "required";
  readonly reason: "dirty-worktree-preserved";
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
}

export interface OperatorManagedAgentWorktreeConflictSnapshot {
  readonly status: "blocked";
  readonly reason: "same-checkout-write-conflict" | "isolated-worktree-path-conflict";
  readonly requestedInvocationId: string;
  readonly conflictingInvocationId: string;
  readonly workingDirectoryPath: string;
  readonly workingDirectoryMode: "read-only" | "workspace-write" | "isolated-worktree" | "sandbox";
  readonly policyId: "managed-agent.worktree.single-active-writer";
  readonly retryAfterInvocationIds: readonly string[];
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
}

export interface OperatorManagedAgentResourceLeaseSnapshot {
  readonly leaseId: string;
  readonly createdAt: string;
  readonly healthStatus: "healthy" | "stale" | "released" | "leaked";
  readonly cleanupStatus: "not-required" | "pending" | "completed" | "failed" | "unknown";
  readonly workingDirectoryPath: string;
  readonly workingDirectoryMode: "read-only" | "workspace-write" | "isolated-worktree" | "sandbox";
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
  readonly worktreeReview?: OperatorManagedAgentWorktreeReviewSnapshot;
  readonly worktreeConflict?: OperatorManagedAgentWorktreeConflictSnapshot;
}

export interface OperatorManagedAgentChildIdentitySnapshot {
  readonly agentId: string;
  readonly requestedAgentProfile?: string;
  readonly admittedAgentProfile?: string;
  readonly displayName?: string;
}

export type OperatorManagedAgentCallerAttachmentIdentity =
  | {
    readonly kind: "kiln-runtime";
    readonly surface: string;
    readonly attachmentId: string;
  }
  | {
    readonly kind: "external-harness";
    readonly harness: "claude" | "codex" | "opencode";
    readonly attachmentId: string;
    readonly evidenceId: string;
  };

// Roadmap 01 Slice 3.1 - additive projection of
// ManagedAgentExternalRuntimeAttachmentIdentity (@kilnai/core). Mirrors,
// does not import, to keep gateway-contracts free of a core dependency.
export interface OperatorManagedAgentExternalRuntimeAttachmentIdentity {
  readonly kind: "external-runtime";
  readonly runtimeId: string;
  readonly attachmentId: string;
}

export interface OperatorManagedAgentCapabilitySnapshot {
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly routeId: string;
  readonly routeSource: string;
  readonly callerIdentity?: OperatorManagedAgentCallerAttachmentIdentity;
  readonly externalRuntimeAttachment?: OperatorManagedAgentExternalRuntimeAttachmentIdentity;
  readonly routeHealth: OperatorManagedAgentRouteHealthSnapshot;
  readonly providerModelProof: OperatorManagedAgentProviderModelProofSnapshot;
  readonly providerRoute: OperatorManagedAgentProviderRoute;
  readonly adapterKind: "direct" | "harness";
  readonly executionMode: "direct-provider" | "local-harness" | "cli-harness" | "remote-harness";
  readonly adapterDescriptor: Record<string, unknown>;
  readonly authorityProfile: Record<string, unknown>;
  readonly contextMode: "isolated" | "resources" | "fork";
  readonly resourcePlane: OperatorManagedAgentResourcePlaneSnapshot;
  readonly resourceLease: OperatorManagedAgentResourceLeaseSnapshot;
  readonly childIdentity: OperatorManagedAgentChildIdentitySnapshot;
}

export interface OperatorManagedAgentInvocationEventPayload extends Record<string, unknown> {
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentSessionId?: string;
  readonly parentTurnId?: string;
  readonly routeId?: string;
  readonly routeSource?: string;
  readonly lifecycleState?: string;
  readonly profile?: string;
  readonly providerRoute?: OperatorManagedAgentProviderRoute;
  readonly adapterKind?: "direct" | "harness";
  readonly executionMode?: "direct-provider" | "local-harness" | "cli-harness" | "remote-harness";
  readonly requestedAuthority?: "auto" | "read_only" | "audited" | "destructive";
  readonly authorityProfileId?: string;
  readonly capabilitySnapshot?: OperatorManagedAgentCapabilitySnapshot;
  readonly promptAdmissionId?: string;
  readonly deliveryMode?: "steer" | "queue";
  readonly deliveryState?: "available" | "queued" | "delivered" | "stale";
  readonly previousDeliveryState?: "available" | "queued" | "delivered" | "stale";
  readonly admissionState?: "admitted";
  readonly inputSummary?: string;
  readonly promptHash?: string;
  readonly wakeRequested?: boolean;
  readonly recoveryReason?: string;
  readonly recoveredAt?: string;
}

export type OperatorManagedEconomicLifecycleTransition =
  | "denied" | "held" | "dispatch-fenced" | "settlement-pending"
  | "release-failed" | "leaked" | "released";

// Mirrors, does not import, @kilnai/core's SessionManagedEconomicRouteIdentity to keep
// gateway-contracts free of a core dependency.
export interface OperatorManagedEconomicRouteIdentity {
  readonly routeId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
}

// Mirrors, does not import, @kilnai/core's SessionManagedEconomicAccountIdentity.
export interface OperatorManagedEconomicAccountIdentity {
  readonly kind: "account-bound" | "accountless";
  readonly capacityIdentity?: string;
  readonly creditPosture?: "disabled" | "committed";
  readonly overagePosture?: "disabled" | "committed";
}

export type OperatorManagedEconomicSettlementKind =
  | "charged" | "estimated" | "subscription" | "included" | "free" | "unknown" | "pending" | "leaked";

export type OperatorManagedEconomicEvidenceAuthority =
  | "provider-reported"
  | "configured"
  | "calculated-estimate";

export type OperatorManagedEconomicCoreRejectionReason =
  | "quota-evidence-missing"
  | "quota-evidence-stale"
  | "price-evidence-missing"
  | "price-evidence-stale"
  | "comparison-domain-incompatible"
  | "execution-envelope-unbounded"
  | "ceiling-exceeded";

export type OperatorManagedEconomicAccountSelectionRejectionReason =
  | "unhealthy"
  | "incompatible-route"
  | "reserved-for-new-work"
  | "lease-conflict"
  | "dispatcher-unavailable";

export type OperatorManagedEconomicLocalCapacityRejectionReason =
  | "route-capacity-exhausted"
  | "comparison-domain-incompatible";

export type OperatorManagedEconomicCommitmentConflictReason =
  | "idempotency-conflict"
  | "identity-revision-conflict";

// Mirrors Core's sanitized SessionManagedEconomicRejection without importing Core.
export type OperatorManagedEconomicRejection =
  | {
      readonly stage: "economic-selection";
      readonly routeId: string;
      readonly reason: OperatorManagedEconomicCoreRejectionReason;
    }
  | {
      readonly stage: "account-selection";
      readonly routeId: string;
      readonly reason: OperatorManagedEconomicAccountSelectionRejectionReason;
      readonly count: number;
    }
  | {
      readonly stage: "local-capacity";
      readonly routeId: string;
      readonly reason: OperatorManagedEconomicLocalCapacityRejectionReason;
    }
  | {
      readonly stage: "commitment-conflict";
      readonly reason: OperatorManagedEconomicCommitmentConflictReason;
    };

export interface OperatorManagedEconomicLifecycleEventPayload extends Record<string, unknown> {
  readonly evidenceVersion: 1;
  readonly jobId: string;
  readonly economicAttemptId: string;
  /** Best-effort cross-reference to a managed-agent invocation; absent on older events. */
  readonly invocationId?: string;
  readonly transition: OperatorManagedEconomicLifecycleTransition;
  readonly policyId: string;
  readonly policyRevision: string;
  readonly policyDigest: string;
  readonly commitmentId?: string;
  readonly reservationId?: string;
  readonly dispatchFenceId?: string;
  readonly selectedRoute?: OperatorManagedEconomicRouteIdentity;
  readonly selectedAccount?: OperatorManagedEconomicAccountIdentity;
  readonly settlementKind?: OperatorManagedEconomicSettlementKind;
  readonly settlementAuthority?: OperatorManagedEconomicEvidenceAuthority;
  readonly reason?: string;
  readonly rejections?: readonly OperatorManagedEconomicRejection[];
}

export interface OperatorSessionEvent {
  readonly eventId: string;
  readonly kilnSessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly kind: OperatorSessionEventKind;
  readonly turnId?: string;
  readonly parentEventId?: string;
  readonly executionScope?: OperatorExecutionScope;
  readonly source?: OperatorSessionEventSource;
  readonly payload: Record<string, unknown>;
}

export interface OperatorManagedAgentInvocationSessionEvent extends OperatorSessionEvent {
  readonly kind: OperatorAgentInvocationSessionEventKind;
  readonly payload: OperatorManagedAgentInvocationEventPayload;
}

export interface OperatorManagedEconomicLifecycleSessionEvent extends OperatorSessionEvent {
  readonly kind: "managed_economic_lifecycle";
  readonly payload: OperatorManagedEconomicLifecycleEventPayload;
}

export type GuiSessionEvent = OperatorSessionEvent;

export interface GuiSessionDetail {
  readonly id: string;
  readonly meta: GuiSessionMeta;
  readonly events: readonly OperatorSessionEvent[];
}

// --- WebSocket frame shapes ---

export type OperatorThemeScope = "session" | "persisted";

export interface OperatorThemeSetFrame {
  readonly type: "operator_theme_set";
  readonly requestId: string;
  readonly theme: string;
  readonly scope: OperatorThemeScope;
  readonly reason?: string;
}

export interface OperatorThemeSetResultFrame {
  readonly type: "operator_theme_set_result";
  readonly requestId: string;
  readonly ok: boolean;
  readonly appliedTheme?: string;
  readonly error?: string;
}

export type OperatorActivityPhase =
  | "idle"
  | "thinking"
  | "tool_running"
  | "awaiting_approval"
  | "streaming";

export interface OperatorActivityPhaseFrame {
  readonly type: "activity_phase";
  readonly kilnSessionId: string;
  readonly turnId?: string;
  readonly phase: OperatorActivityPhase;
  readonly toolName?: string;
  readonly details?: string;
}

export interface GuiMemoryLatticeInvalidatedFrame {
  readonly type: "memory_lattice_invalidated";
  readonly occurredAt: string;
  readonly reason:
    | "record_created"
    | "record_updated"
    | "record_deleted"
    | "relation_created"
    | "relation_deleted"
    | "revision_created"
    | "context_admitted"
    | "context_deferred";
  readonly scope?: {
    readonly kind: string;
    readonly id: string;
  };
  readonly layer?: string;
  readonly recordId?: string;
  readonly relationId?: string;
  readonly revisionId?: string;
  readonly admissionId?: string;
}

export type GuiInteractiveUseTarget = "browser" | "computer";
export type GuiInteractiveUseStatus = "running" | "succeeded" | "failed";
export type GuiBrowserSessionOwnership = "agent" | "operator" | "released";
export type GuiBrowserSessionViewMode = "snapshot" | "live";
export type GuiBrowserSessionStreamStatus = "unavailable" | "starting" | "live" | "paused" | "ended" | "failed";
export type GuiBrowserSessionControlAction = "takeover" | "release";
export type GuiBrowserLiveViewportTransport =
  | "snapshot-polling"
  | "cdp-screencast"
  | "electron-webcontents"
  | "webrtc"
  | "hosted-url";
export type GuiBrowserLiveViewportFormat = "jpeg" | "png";
export type GuiBrowserOperatorInputAckStatus = "accepted" | "blocked" | "failed" | "stale-session";
export type GuiBrowserOperatorPointerButton = "left" | "middle" | "right" | "back" | "forward" | "none";

export interface GuiInteractiveUseSnapshot {
  readonly target: GuiInteractiveUseTarget;
  readonly status: GuiInteractiveUseStatus;
  readonly updatedAt: string;
  readonly kilnSessionId?: string;
  readonly toolCallId?: string;
  readonly toolCallScopeId?: string;
  readonly toolName?: string;
  readonly provider?: string;
  readonly gatewayTargetId?: string;
  readonly sessionId?: string;
  readonly operation?: string;
  readonly url?: string;
  readonly title?: string;
  readonly visibleText?: string;
  readonly windowTitle?: string;
  readonly application?: string;
  readonly closeMethod?: string;
  readonly screenshotUri?: string;
  readonly screenshotDataUrl?: string;
  readonly actionSummary?: string;
  readonly error?: string;
}

export interface GuiBrowserSessionCapture {
  readonly uri: string;
  readonly label?: string;
  readonly relation?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly transport?: GuiBrowserLiveViewportTransport;
}

export interface GuiBrowserSessionStream {
  readonly status: GuiBrowserSessionStreamStatus;
  readonly reason?: string;
}

export interface GuiBrowserSessionState {
  readonly target: "browser";
  readonly status: GuiInteractiveUseStatus;
  readonly updatedAt: string;
  readonly kilnSessionId?: string;
  readonly toolCallId?: string;
  readonly toolCallScopeId?: string;
  readonly toolName?: string;
  readonly provider?: string;
  readonly gatewayTargetId?: string;
  readonly sessionId?: string;
  readonly operation?: string;
  readonly url?: string;
  readonly title?: string;
  readonly visibleText?: string;
  readonly ownership: GuiBrowserSessionOwnership;
  readonly viewMode: GuiBrowserSessionViewMode;
  readonly stream: GuiBrowserSessionStream;
  readonly latestCapture?: GuiBrowserSessionCapture;
  readonly actionSummary?: string;
  readonly error?: string;
}

export interface GuiInteractiveUseUpdatedFrame {
  readonly type: "interactive_use_updated";
  readonly snapshot: GuiInteractiveUseSnapshot;
  readonly browserSession?: GuiBrowserSessionState;
}

export interface GuiBrowserSessionUpdatedFrame {
  readonly type: "browser_session_updated";
  readonly browserSession: GuiBrowserSessionState;
}

export interface GuiBrowserSessionControlFrame {
  readonly type: "browser_session_control";
  readonly action: GuiBrowserSessionControlAction;
  readonly gatewayTargetId?: string;
  readonly sessionId?: string;
  readonly reason?: string;
  readonly requestId?: string;
}

export type GuiManagedAgentControlAction = "cancel" | "join" | "prompt";

export type GuiManagedAgentControlResultStatus = "accepted" | "failed";

export interface GuiManagedAgentControlFrame {
  readonly type: "managed_agent_control";
  readonly action: GuiManagedAgentControlAction;
  readonly gatewayTargetId?: string;
  readonly sessionId: string;
  readonly invocationId: string;
  readonly prompt?: string;
  readonly deliveryMode?: "steer" | "queue";
  readonly wakeRequested?: boolean;
  readonly reason?: string;
  readonly requestId?: string;
}

export interface GuiManagedAgentControlResultFrame {
  readonly type: "managed_agent_control_result";
  readonly action: GuiManagedAgentControlAction;
  readonly sessionId: string;
  readonly invocationId: string;
  readonly status: GuiManagedAgentControlResultStatus;
  readonly reason?: string;
  readonly requestId?: string;
  readonly handledAt: string;
}

export interface GuiBrowserLiveViewportFrame {
  readonly type: "browser_live_viewport_frame";
  readonly sessionId: string;
  readonly kilnSessionId?: string;
  readonly frameId: string;
  readonly sequence?: number;
  readonly transport: GuiBrowserLiveViewportTransport;
  readonly format: GuiBrowserLiveViewportFormat;
  readonly dataUrl?: string;
  readonly artifactUri?: string;
  readonly width: number;
  readonly height: number;
  readonly scale?: number;
  readonly capturedAt: string;
}

export type GuiBrowserOperatorInput =
  | {
      readonly kind: "pointer";
      readonly phase: "move" | "down" | "up" | "click";
      readonly x: number;
      readonly y: number;
      readonly button?: GuiBrowserOperatorPointerButton;
      readonly clickCount?: number;
      readonly modifiers?: readonly string[];
    }
  | {
      readonly kind: "wheel";
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
      readonly modifiers?: readonly string[];
    }
  | {
      readonly kind: "key";
      readonly phase: "down" | "up" | "press";
      readonly key: string;
      readonly code?: string;
      readonly text?: string;
      readonly modifiers?: readonly string[];
    }
  | {
      readonly kind: "text";
      readonly text: string;
    };

export interface GuiBrowserOperatorInputFrame {
  readonly type: "browser_operator_input";
  readonly requestId: string;
  readonly gatewayTargetId?: string;
  readonly sessionId: string;
  readonly input: GuiBrowserOperatorInput;
}

export interface GuiBrowserOperatorInputAckFrame {
  readonly type: "browser_operator_input_ack";
  readonly requestId: string;
  readonly sessionId?: string;
  readonly status: GuiBrowserOperatorInputAckStatus;
  readonly reason?: string;
  readonly handledAt: string;
}

export interface OperatorTerminalOpenFrame {
  readonly type: "operator_terminal_open";
  readonly requestId: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd?: string;
}

export interface OperatorTerminalWriteFrame {
  readonly type: "operator_terminal_write";
  readonly terminalId: string;
  readonly data: string;
}

export interface OperatorTerminalResizeFrame {
  readonly type: "operator_terminal_resize";
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

export interface OperatorTerminalCloseFrame {
  readonly type: "operator_terminal_close";
  readonly terminalId: string;
}

export interface OperatorTerminalOpenedFrame {
  readonly type: "operator_terminal_opened";
  readonly requestId: string;
  readonly terminalId: string;
  readonly cwd: string;
}

export interface OperatorTerminalOutputFrame {
  readonly type: "operator_terminal_output";
  readonly terminalId: string;
  readonly data: string;
}

export interface OperatorTerminalExitedFrame {
  readonly type: "operator_terminal_exited";
  readonly terminalId: string;
  readonly exitCode: number;
  readonly signal?: number;
}

export interface OperatorTerminalErrorFrame {
  readonly type: "operator_terminal_error";
  readonly code: string;
  readonly message: string;
  readonly requestId?: string;
  readonly terminalId?: string;
}

export type GuiGoalControlAction = "pause" | "resume" | "update_objective" | "cancel";

export interface GuiGoalControlFrame {
  readonly type: "goal_control";
  readonly requestId: string;
  readonly goalRunId: string;
  readonly action: GuiGoalControlAction;
  readonly objective?: string;
  readonly reason?: string;
}

export interface GuiGoalControlResultFrame {
  readonly type: "goal_control_result";
  readonly requestId: string;
  readonly goalRunId: string;
  readonly action: GuiGoalControlAction;
  readonly status: "accepted" | "failed";
  readonly reason?: string;
}

/** Frames sent by the browser (operator) to the gateway. */
export type GuiOutboundFrame =
  | {
      type: "message";
      content: string;
      parts?: readonly unknown[];
      executionMode?: OperatorExecutionMode;
      requestedAuthority?: OperatorTurnRequestedAuthority;
      governedWorkRequirement?: OperatorGoalMaterializationRequirement;
      sessionIntent?: "fresh";
      continuationSessionId?: string;
      deliberationIntent?: GuiDeliberationIntent;
      gatewayTargetId?: string;
      appName?: string;
      tenantId?: string;
    }
  | {
      type: "voice_synthesis_request";
      requestId: string;
      sourceMessageId: string;
    }
  | {
      type: "turn_cancel";
      requestId: string;
      reason?: string;
    }
  | { type: "clear" }
  | { type: "refresh_providers" }
  | {
      type: "provider_auth";
      provider: string;
      requestId: string;
      apiKey?: string;
      tier?: "go" | "zen";
      flow?: "browser" | "device_code";
    }
  | { type: "provider"; provider: string; model?: string; requestId: string }
  | OperatorThemeSetResultFrame
  | { type: "continue"; sessionId: string; gatewayTargetId?: string }
  | GuiBrowserSessionControlFrame
  | GuiManagedAgentControlFrame
  | GuiBrowserOperatorInputFrame
  | OperatorTerminalOpenFrame
  | OperatorTerminalWriteFrame
  | OperatorTerminalResizeFrame
  | OperatorTerminalCloseFrame
  | GuiGoalControlFrame
  | { type: "approve"; approvalId: string; gatewayTargetId?: string }
  | { type: "reject"; reason: string; approvalId: string; gatewayTargetId?: string }
  | {
      type: "execution_mode_transition";
      toMode: OperatorExecutionMode;
      planId?: string;
      residualRiskAcknowledged?: boolean;
      residualRiskAcknowledgement?: string;
      gatewayTargetId?: string;
    };

/** Frames sent by the gateway to the browser (operator). */
export type GuiInboundFrame =
  | { type: "thinking" }
  | {
      type: "turn_cancel_result";
      requestId: string;
      status: "accepted" | "not_active" | "failed";
      reason?: string;
      kilnSessionId?: string;
    }
  | OperatorThemeSetFrame
  | { type: "session_event"; event: OperatorSessionEvent }
  | OperatorActivityPhaseFrame
  | GuiInteractiveUseUpdatedFrame
  | GuiBrowserSessionUpdatedFrame
  | GuiBrowserLiveViewportFrame
  | GuiBrowserOperatorInputAckFrame
  | OperatorTerminalOpenedFrame
  | OperatorTerminalOutputFrame
  | OperatorTerminalExitedFrame
  | OperatorTerminalErrorFrame
  | GuiManagedAgentControlResultFrame
  | GuiGoalControlResultFrame
  | GuiMemoryLatticeInvalidatedFrame
  | {
      type: "done";
      kilnSessionId: string;
      sourceMessageId?: string;
      content: string;
      parts?: readonly unknown[];
      admittedInput?: {
        content: string;
      };
      inputTokens: number;
      outputTokens: number;
      outcome: GuiSessionTurnOutcome;
      routedProvider?: string;
      routedModel?: string;
      routingRationale?: GuiModelRoutingRationale;
      runtimeContinuity?: {
        strategy: string;
        feedbackLabel?: string;
        pressure?: string;
        supportArtifactCount?: number;
        supportArtifactSources?: readonly string[];
        fallbackLabel?: string;
        usedCachedSupport?: boolean;
        selectionReason?: string;
      };
      authorityStatus?: GuiAuthorityStatus;
      }
  | {
      type: "voice_synthesis_completed";
      requestId: string;
      sourceMessageId: string;
      parts: readonly unknown[];
    }
  | {
      type: "voice_synthesis_failed";
      requestId: string;
      sourceMessageId: string;
      message: string;
      code?: string;
    }
  | { type: "error"; message: string; code?: string }
  | {
      type: "welcome";
      providerModelDiscovery: GuiProviderModelDiscoveryProjection;
      greeting?: string;
      models?: Record<string, string[]>;
      providerDiscovery?: readonly GuiProviderDiscoveryResult[];
      providers?: readonly GuiProviderDescriptor[];
      activeProvider?: string;
      activeModel?: string;
      executionMode?: OperatorExecutionMode;
      workingDirectory?: string;
      domainLabel?: string;
      authorityStatus?: GuiAuthorityStatus;
      operatorTerminalAvailable?: boolean;
    }
    | {
        type: "execution_mode_transitioned";
        executionMode: OperatorExecutionMode;
        planId?: string;
        approvalId?: string;
        planHash?: string;
      }
    | { type: "cleared" }
    | GuiProviderAuthBrowserStarted
    | GuiProviderAuthDeviceCodeStarted
    | GuiProviderAuthCompleted
    | GuiProviderAuthFailed
    | {
      type: "providers_refreshed";
      providerModelDiscovery: GuiProviderModelDiscoveryProjection;
      models?: Record<string, string[]>;
      providerDiscovery?: readonly GuiProviderDiscoveryResult[];
      providers?: readonly GuiProviderDescriptor[];
    }
    | { type: "provider_changed"; provider: string; model?: string; requestId: string }
    | { type: "continuation_selected"; sessionId: string; gatewayTargetId?: string };

/** Connection lifecycle states for the GUI session WebSocket client. */
export type GuiSessionConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

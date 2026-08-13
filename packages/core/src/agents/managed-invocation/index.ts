import { defineMemoryScope } from "../../memory/domain/scope.js";
import type { MemoryScope } from "../../memory/domain/scope.js";
import { defineWorkClassification } from "../work-classification.js";
import type { WorkClassification } from "../work-classification.js";
import { admitDeliberationForExecution, defineDeliberationLevelId } from "../deliberation-policy.js";
import type { DeliberationIntent, DeliberationResolution, UnsupportedDeliberationPolicy } from "../deliberation-policy.js";
import { validateResolvedCommunicationIntent } from "../communication-policy.js";
import type { ResolvedCommunicationIntent } from "../communication-policy.js";
import type { SessionExecutionScope } from "../../events/session-execution-scope.js";
import type { ExecutionSessionEphemeralHarnessStateEvidence } from "../../events/execution-session-event.js";
import {
  compareManagedAgentExternalRuntimeAttachment,
  type ManagedAgentExternalRuntimeAttachmentIdentity,
} from "./external-runtime-attachment.js";
import { defineManagedAgentReadAuthority } from "./read-authority.js";
import type { ManagedAgentReadAuthority } from "./read-authority.js";
import {
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteEvidence,
  isManagedAgentWriteAuthorityProfile,
} from "./write-authority.js";
import type {
  ManagedAgentAdapterWriteAuthorityDescriptor,
  ManagedAgentWriteAuthority,
  ManagedAgentWriteEvidence,
} from "./write-authority.js";
import {
  defineStructuredExecutionResult,
  defineVerificationUsageReport,
  type AssistantOutputVerbosity,
  type StructuredExecutionResult,
  type VerificationUsageReport,
} from "../../efficiency/output-verification-allocation.js";
import {
  createAccountPolicyId,
  createAccountRef,
  defineModelGatewayAccountRejection,
  defineModelGatewayAccountUsageEvidence,
  type AccountPolicyId,
  type AccountRef,
  type ModelGatewayAccountRejection,
  type ModelGatewayAccountSelection,
  type ModelGatewayAccountUsageEvidence,
  type ModelGatewayAffinityOutcome,
  type ModelGatewayRoute,
} from "../model-gateway/index.js";

export * from "./write-authority.js";
export * from "./read-authority.js";
export * from "./write-integration.js";
export * from "./orchestration.js";
export * from "./coordination-policy.js";
export * from "./external-runtime-attachment.js";
export * from "./route-capability.js";

export const MANAGED_AGENT_ADMISSION_PROFILES = [
  "foundation-readonly-plan",
  "foundation-propose-writes",
  "foundation-apply-approved-writes",
  "foundation-memory-write-proposals",
  "diagnostic-only",
  "comparison-only",
  "rejected",
] as const;

export type ManagedAgentAdmissionProfile = typeof MANAGED_AGENT_ADMISSION_PROFILES[number];

export const MANAGED_AGENT_ADAPTER_KINDS = ["direct", "harness"] as const;

export type ManagedAgentAdapterKind = typeof MANAGED_AGENT_ADAPTER_KINDS[number];

export const MANAGED_AGENT_EXECUTION_MODES = [
  "direct-provider",
  "local-harness",
  "cli-harness",
  "remote-harness",
] as const;

export type ManagedAgentExecutionMode = typeof MANAGED_AGENT_EXECUTION_MODES[number];

export const MANAGED_AGENT_REQUESTED_AUTHORITIES = [
  "auto",
  "read_only",
  "audited",
  "destructive",
] as const;

export type ManagedAgentRequestedAuthority = typeof MANAGED_AGENT_REQUESTED_AUTHORITIES[number];

export interface ManagedAgentExecutionIntent {
  readonly attendance: "attended" | "unattended";
  readonly lifecycle: "foreground" | "background" | "automation" | "resume" | "scheduled";
}

export type ManagedAgentUnsupportedFieldPolicy = "reject" | "ignore-with-audit" | "unsupported";

export interface ManagedAgentAuthorityApproval {
  readonly approved: true;
  readonly reason?: string;
}

export const MANAGED_AGENT_LIFECYCLE_STATES = [
  "pending",
  "starting",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "stale",
  "recovered",
] as const;

export type ManagedAgentLifecycleState = typeof MANAGED_AGENT_LIFECYCLE_STATES[number];

export interface ManagedAgentProviderRoute {
  readonly providerId: string;
  readonly surface: string;
  readonly model?: string;
  readonly deliberationIntent?: DeliberationIntent;
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationIntent?: ResolvedCommunicationIntent;
}

export interface ManagedAgentToolAuthority {
  readonly allowedToolNames: readonly string[];
  readonly writeAllowed: boolean;
  readonly networkAllowed: boolean;
}

export interface ManagedAgentWorkingDirectory {
  readonly path: string;
  readonly mode: "read-only" | "workspace-write" | "isolated-worktree" | "sandbox";
}

export type ManagedAgentCredentialRoute =
  | {
    readonly mode: "runtime-selected";
    readonly routeId: string;
  }
  | {
    readonly mode: "account-leased";
    readonly routeId: string;
    readonly accountPolicyId: AccountPolicyId;
  }
  | {
    readonly mode: "credentialless";
  };

export interface ManagedAgentMemoryScope {
  readonly scope: MemoryScope;
  readonly access: "none" | "read-only" | "write-proposals";
}

export type ManagedAgentRouteSource =
  | "ordered-routing"
  | "explicit-managed-route"
  | "managed-default-route"
  | "enabled-engine-fallback";

export type ManagedAgentTimeoutSource = "default" | "explicit-route";

export interface ManagedAgentAuthorityProfile {
  readonly authorityProfileId: string;
  readonly permissionProfile: string;
  readonly toolAuthority: ManagedAgentToolAuthority;
  readonly workingDirectory: ManagedAgentWorkingDirectory;
  readonly timeoutMs: number;
  readonly timeoutSource?: ManagedAgentTimeoutSource;
  readonly credentialRoute: ManagedAgentCredentialRoute;
  readonly memoryScope: ManagedAgentMemoryScope;
  readonly readAuthority?: ManagedAgentReadAuthority;
  readonly writeAuthority?: ManagedAgentWriteAuthority;
}

export interface ManagedAgentInvocationInput {
  readonly summary: string;
  readonly prompt?: string;
  readonly resourceUris?: readonly string[];
  readonly context?: ManagedAgentInvocationContextSelection;
  readonly handoff?: ManagedAgentInvocationHandoffContract;
}

export interface ManagedAgentInvocationHandoffContract {
  readonly workItemId?: string;
  readonly roleIntent?: string;
  readonly expectedEvidence?: readonly string[];
  readonly requiredResultFields?: readonly ManagedAgentResultField[];
  readonly doneCriteria?: readonly string[];
  readonly residualRiskRequired?: boolean;
  readonly outputVerbosity?: AssistantOutputVerbosity;
}

export type ManagedAgentResultField =
  | "summary"
  | "resourceUris"
  | "evidence"
  | "verificationResults"
  | "uncertainty"
  | "limitations"
  | "warnings"
  | "approvalRequirements"
  | "residualRisks";

export type ManagedAgentInvocationContextMode = "isolated" | "resources" | "fork";

export interface ManagedAgentInvocationContextSelection {
  readonly mode: ManagedAgentInvocationContextMode;
  readonly agentProfile?: string;
  readonly skills?: readonly string[];
  readonly instructionProfiles?: readonly string[];
  readonly workClassification?: WorkClassification;
  readonly admittedAgentProfile?: string;
  readonly admittedSkills?: readonly string[];
  readonly admittedInstructionProfiles?: readonly string[];
  readonly deniedSkills?: readonly string[];
  readonly resolvedWorkClassification?: WorkClassification;
  readonly workRecommendedSkills?: readonly string[];
  readonly workRecommendedSkillDiagnostics?: readonly WorkRecommendedSkillDiagnostic[];
}

export type WorkRecommendedSkillDiagnosticState = "admitted" | "advisory" | "unavailable";

export interface WorkRecommendedSkillDiagnostic {
  readonly skillName: string;
  readonly state: WorkRecommendedSkillDiagnosticState;
  readonly reason: string;
}

export interface ManagedAgentInvocationRequest {
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly requestedBy: string;
  readonly requestSource: string;
  readonly executionIntent?: ManagedAgentExecutionIntent;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly authorityApproval?: ManagedAgentAuthorityApproval;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly adapterKind: ManagedAgentAdapterKind;
  readonly executionMode: ManagedAgentExecutionMode;
  readonly authority: ManagedAgentAuthorityProfile;
  readonly input: ManagedAgentInvocationInput;
  readonly executionScope?: SessionExecutionScope;
  readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
}

export interface ManagedAgentAdapterDescriptor {
  readonly adapterDescriptorId: string;
  readonly providerId: string;
  readonly adapterKind: ManagedAgentAdapterKind;
  readonly supportedProfiles: readonly ManagedAgentAdmissionProfile[];
  readonly supportedExecutionModes: readonly ManagedAgentExecutionMode[];
  readonly lifecycle: {
    readonly exposesStart: boolean;
    readonly exposesTerminal: boolean;
    readonly exposesCleanup: boolean;
  };
  readonly cancellation: {
    readonly supported: boolean;
  };
  readonly timeout: {
    readonly supported: boolean;
    readonly diagnosticArtifactOnTimeout: boolean;
  };
  readonly transcript: {
    readonly supported: boolean;
    readonly redactionKnown: boolean;
    readonly truncationKnown: boolean;
    readonly persistenceKnown: boolean;
    readonly retentionKnown: boolean;
  };
  readonly usage: {
    readonly supported: boolean;
    readonly preservesProviderTokenClasses: boolean;
    readonly supportsExplicitUnknowns: boolean;
    readonly tokenClasses: readonly ManagedAgentUsageTokenClassCapability[];
    readonly semanticSourceGranularity: ManagedAgentSemanticSourceGranularity;
    readonly evidenceBasis: ManagedAgentUsageEvidenceBasis;
  };
  readonly resultHandoff: {
    readonly boundedSummary: boolean;
    readonly resourcePointers: boolean;
  };
  readonly credentialRoute: {
    readonly supported: boolean;
  };
  readonly memoryContext: {
    readonly governedAdmission: boolean;
  };
  readonly writeAuthority?: ManagedAgentAdapterWriteAuthorityDescriptor;
  readonly unsupportedFieldPolicy: ManagedAgentUnsupportedFieldPolicy;
  readonly cleanup: {
    readonly supported: boolean;
  };
  readonly limitations?: readonly string[];
}

export type ManagedAgentUsageTokenClassCapability =
  | "input"
  | "output"
  | "cache_read"
  | "cache_write";

export type ManagedAgentSemanticSourceGranularity =
  | "provider_reported"
  | "estimated"
  | "unknown";

export type ManagedAgentUsageEvidenceBasis =
  | "provider"
  | "runtime"
  | "adapter"
  | "unknown";

export type ManagedAgentRouteHealthStatus = "healthy";

export interface ManagedAgentRouteHealthSnapshot {
  readonly status: ManagedAgentRouteHealthStatus;
  readonly reason: string;
}

export type ManagedAgentProviderModelProofStatus = "live-proven" | "configured" | "unproven";

export interface ManagedAgentProviderModelProofSnapshot {
  readonly status: ManagedAgentProviderModelProofStatus;
  readonly source: string;
  readonly requiresToolCalls?: boolean;
}

export interface ManagedAgentResourcePlaneSnapshot {
  readonly available: boolean;
  readonly resourceUris: readonly string[];
  readonly reason?: string;
}

export interface ManagedAgentChildIdentitySnapshot {
  readonly agentId: string;
  readonly requestedAgentProfile?: string;
  readonly admittedAgentProfile?: string;
  readonly displayName?: string;
  readonly voiceProfile?: string;
}

export type ManagedAgentCallerAttachmentIdentity =
  | {
    readonly kind: "kiln-runtime";
    readonly surface: string;
    readonly attachmentId: string;
    /** The parent turn's effective requested authority, used to bound child delegation. */
    readonly parentEffectiveRequestedAuthority?: ManagedAgentRequestedAuthority;
  }
  | {
    readonly kind: "external-harness";
    readonly harness: "claude" | "codex" | "opencode";
    readonly attachmentId: string;
    readonly evidenceId: string;
  };

export type ManagedAgentChildAuthorityProof =
  | "proven"
  | "inferred"
  | "unavailable"
  | "contradictory"
  | "failed";

export type ManagedAgentChildAuthorityApproval =
  | "on-request"
  | "never"
  | "untrusted"
  | "unknown";

export type ManagedAgentChildAuthoritySandbox =
  | "read-only"
  | "workspace-write"
  | "danger-full-access"
  | "unknown";

export type ManagedAgentAuthorityEvidenceClassification =
  | "current-verified"
  | "effective-policy-unproven"
  | "runtime-policy-mismatch"
  | "stale-evidence"
  | "partial-observation"
  | "failed-observation";

export interface ManagedAgentRequestedAuthorityEvidence {
  readonly authority: ManagedAgentRequestedAuthority;
  readonly source: "managed-invocation-request" | "parent-authority" | "runtime-default";
  readonly proof: "proven" | "inferred";
  readonly reason?: string;
}

export interface ManagedAgentProjectedAuthorityEvidence {
  readonly permissionProfile: string;
  readonly approval: ManagedAgentChildAuthorityApproval;
  readonly sandbox: ManagedAgentChildAuthoritySandbox;
  readonly source: "managed-authority-profile" | "cli-harness-session-factory" | "direct-provider-adapter" | "remote-harness-adapter";
  readonly proof: "proven" | "inferred";
  readonly reason?: string;
}

export interface ManagedAgentObservedRuntimeAuthorityEvidence {
  readonly approval?: ManagedAgentChildAuthorityApproval;
  readonly sandbox?: ManagedAgentChildAuthoritySandbox;
  readonly source: "not-observed" | "runtime-observation" | "child-session-metadata" | "harness-event";
  readonly proof: ManagedAgentChildAuthorityProof;
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly reason?: string;
}

export interface ManagedAgentAuthorityEvidence {
  readonly requested: ManagedAgentRequestedAuthorityEvidence;
  readonly projected: ManagedAgentProjectedAuthorityEvidence;
  readonly observedRuntime: ManagedAgentObservedRuntimeAuthorityEvidence;
  readonly classification: ManagedAgentAuthorityEvidenceClassification;
  readonly recommendation?: string;
}

export interface ManagedAgentCapabilitySnapshot {
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
  readonly routeHealth: ManagedAgentRouteHealthSnapshot;
  readonly providerModelProof: ManagedAgentProviderModelProofSnapshot;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly adapterKind: ManagedAgentAdapterKind;
  readonly executionMode: ManagedAgentExecutionMode;
  readonly adapterDescriptor: ManagedAgentAdapterDescriptor;
  readonly authorityProfile: ManagedAgentAuthorityProfile;
  readonly authorityEvidence: ManagedAgentAuthorityEvidence;
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly resourcePlane: ManagedAgentResourcePlaneSnapshot;
  readonly resourceLease: ManagedAgentResourceLeaseEvidence;
  readonly accountLease?: ManagedAccountLeaseEvidence;
  readonly childIdentity: ManagedAgentChildIdentitySnapshot;
}

export interface ManagedAgentCapabilitySnapshotInput {
  readonly capturedAt?: string;
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
  readonly routeHealth?: ManagedAgentRouteHealthSnapshot;
  readonly providerModelProof?: ManagedAgentProviderModelProofSnapshot;
  readonly authorityEvidence?: ManagedAgentAuthorityEvidence;
  readonly resourcePlane?: ManagedAgentResourcePlaneSnapshot;
  readonly resourceLease?: ManagedAgentResourceLeaseEvidence;
  readonly childIdentity?: ManagedAgentChildIdentitySnapshot;
}

export interface ManagedAgentTranscriptPointer {
  readonly uri: string;
  readonly redacted: boolean | "unknown";
  readonly truncated: boolean | "unknown";
  readonly persisted: boolean | "unknown";
  readonly retention: "session" | "durable" | "external" | "unknown";
}

export interface ManagedAgentDiagnosticPointer {
  readonly uri: string;
  readonly kind: "timeout" | "failure" | "adapter" | "cleanup";
  readonly classification?: ManagedAgentTerminalFailureClassification;
}

export type ManagedAgentTerminalFailureClassification =
  | "harness_version_mismatch"
  | "structured_handoff_rejected"
  | "model_identity_mismatch"
  | "private_artifact_cleanup_failed"
  | "provider_quota_exhausted"
  | "native_session_error"
  | "write_boundary_violation"
  | "result_handoff_missing"
  | "unknown_failure";

export interface ManagedAgentProviderFailureSignal {
  readonly code?: string;
  readonly message?: string;
}

const PROVIDER_QUOTA_CODES = new Set([
  "402",
  "payment_required",
  "quota",
  "quota_exceeded",
  "quota_exhausted",
  "subscription_limit_reached",
  "usage_limit_exceeded",
]);

/** Classifies only explicit provider exhaustion signals; advisory quota text is not sufficient. */
export function isManagedAgentProviderQuotaFailure(
  signal: ManagedAgentProviderFailureSignal | undefined,
): boolean {
  if (!signal) return false;
  const code = signal.code?.trim().toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
  if (PROVIDER_QUOTA_CODES.has(code)) return true;
  const message = signal.message?.toLowerCase().replace(/\s+/gu, " ").trim() ?? "";
  return /\b(?:weekly|monthly|daily|usage|subscription) limit (?:reached|exceeded|exhausted)\b/u.test(message)
    || /\b(?:hit|reached|exceeded|exhausted) (?:your |the )?(?:weekly |monthly |daily |usage |subscription )?limit\b/u.test(message)
    || /\bquota (?:reached|exceeded|exhausted)\b/u.test(message)
    || /\b(?:reached|exceeded|exhausted) (?:your |the )?quota\b/u.test(message);
}

export interface ManagedAgentTokenClassUsage {
  readonly name: ManagedAgentUsageTokenClassCapability;
  readonly value: number | "unknown";
}

export interface ManagedAgentUsageReport {
  readonly source: "adapter" | "provider" | "runtime" | "unknown";
  readonly tokenClasses: readonly ManagedAgentTokenClassUsage[];
  readonly cost: {
    readonly currency: string | "unknown";
    readonly amount: number | "unknown";
  };
}

export type ManagedAgentCoordinationStage =
  | "parent_prompt"
  | "child_bootstrap"
  | "duplicated_reads"
  | "handoff"
  | "review"
  | "synthesis";

export type ManagedAgentCoordinationMetricSource = "provider_reported" | "estimated" | "unknown";

export interface ManagedAgentCoordinationMetric {
  readonly value: number | "unknown";
  readonly source: ManagedAgentCoordinationMetricSource;
}

export interface ManagedAgentCoordinationComponentUsage {
  readonly stage: ManagedAgentCoordinationStage;
  readonly providerTokenClass: "input" | "output";
  readonly tokens: ManagedAgentCoordinationMetric;
  readonly costUsd: ManagedAgentCoordinationMetric;
  readonly latencyMs: ManagedAgentCoordinationMetric;
  readonly turns: ManagedAgentCoordinationMetric;
  readonly evidenceUris: readonly string[];
}

export interface ManagedAgentCoordinationUsageReport {
  readonly version: "managed-agent-coordination-usage-v1";
  readonly workerId: string;
  readonly coverage: "partial" | "complete";
  readonly reconciliation: "components-may-overlap" | "mutually-exclusive";
  readonly components: readonly ManagedAgentCoordinationComponentUsage[];
}

export interface ManagedAgentResultHandoff {
  readonly provenance: ManagedAgentResultHandoffProvenance;
  readonly summary: string;
  /** Child-produced summaries are evidence, not authority. */
  readonly summaryAuthority?: "runtime-derived" | "child-untrusted";
  readonly resourceUris: readonly string[];
  readonly memoryWriteProposalUris: readonly string[];
  /** Runtime-derived evidence for state that is ephemeral to a native harness. */
  readonly ephemeralHarnessState?: readonly ExecutionSessionEphemeralHarnessStateEvidence[];
  readonly structuredResult?: StructuredExecutionResult;
  readonly verificationUsage?: VerificationUsageReport;
}

export type ManagedAgentResultHandoffDelivery =
  | "native-structured-output"
  | "assistant-text"
  | "submission-tool"
  | "remote-harness"
  | "runtime-generated";

export interface ManagedAgentResultHandoffHarnessProvenance {
  readonly id: string;
  /** Portable executable identity; absolute operator paths are forbidden. */
  readonly executable: string;
  readonly version: string;
}

export interface ManagedAgentResultHandoffProvenance {
  readonly delivery: ManagedAgentResultHandoffDelivery;
  readonly configuredModelId: string;
  /** Exact provider-reported identity of the primary initialized model. */
  readonly primaryObservedModelId?: string;
  /** Every provider-reported model that served the run, including auxiliaries. */
  readonly observedModelIds: readonly string[];
  readonly harness?: ManagedAgentResultHandoffHarnessProvenance;
}

export function assertManagedAgentResultHandoffContract(
  contract: ManagedAgentInvocationHandoffContract | undefined,
  record: ManagedAgentInvocationRecord,
): void {
  if (!contract || record.lifecycleState !== "completed") return;
  const handoff = record.resultHandoff;
  if (!handoff) throw new Error("Managed invocation required result handoff is missing.");
  const missing = (contract.requiredResultFields ?? []).flatMap((field) =>
    hasManagedResultField(field, handoff) ? [] : [field]);
  if (contract.residualRiskRequired === true && (handoff.structuredResult?.residualRisks.length ?? 0) === 0) {
    missing.push("residualRisks");
  }
  if (missing.length > 0) {
    throw new Error(`Managed invocation result handoff is missing required structured fields: ${[...new Set(missing)].join(", ")}`);
  }
}

function hasManagedResultField(field: ManagedAgentResultField, handoff: ManagedAgentResultHandoff): boolean {
  if (field === "summary") return handoff.summary.trim().length > 0;
  if (field === "resourceUris") return handoff.resourceUris.length > 0;
  if (field === "evidence") return (handoff.structuredResult?.evidence.length ?? handoff.resourceUris.length) > 0;
  if (field === "verificationResults") {
    return (handoff.structuredResult?.verificationResults.length ?? 0) > 0;
  }
  if (field === "uncertainty") return handoff.structuredResult?.uncertainty !== undefined;
  if (field === "limitations") return handoff.structuredResult !== undefined;
  if (field === "warnings") return handoff.structuredResult !== undefined;
  if (field === "approvalRequirements") return handoff.structuredResult !== undefined;
  if (field === "residualRisks") {
    return (handoff.structuredResult?.residualRisks.length ?? 0) > 0;
  }
  return false;
}

export interface ManagedAgentReplayResource {
  readonly uri: string;
  readonly title?: string;
  readonly mimeType: string;
  readonly text: string;
}

export type ManagedAgentResourceLeaseHealthStatus = "healthy" | "stale" | "released" | "leaked";

export type ManagedAgentResourceLeaseCleanupStatus = "not-required" | "pending" | "completed" | "failed" | "unknown";

export const MANAGED_ACCOUNT_LEASE_LIFECYCLE_STATES = [
  "held",
  "settlement-pending",
  "released",
  "release-failed",
  "leaked",
] as const;

export type ManagedAccountLeaseLifecycleState = typeof MANAGED_ACCOUNT_LEASE_LIFECYCLE_STATES[number];

export const MANAGED_ACCOUNT_AFFINITY_COMMIT_OUTCOMES = [
  "won",
  "already-matched",
  "conflict",
] as const;

export type ManagedAccountAffinityCommitOutcome =
  typeof MANAGED_ACCOUNT_AFFINITY_COMMIT_OUTCOMES[number];

export type ManagedAccountAffinityPolicy =
  | {
    readonly continuity: "none";
  }
  | {
    readonly continuity: "prefer" | "require";
    readonly scope: "session" | "turn";
    readonly allowRebind?: boolean;
  };

declare const managedAccountAffinityKeyBrand: unique symbol;

export type ManagedAccountAffinityKey = string & {
  readonly [managedAccountAffinityKeyBrand]: true;
};

export function createManagedAccountAffinityKey(value: string): ManagedAccountAffinityKey {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError("Managed account affinity key must be an opaque SHA-256 digest");
  }
  return value as ManagedAccountAffinityKey;
}

export interface ManagedAccountLeaseEvidence {
  readonly leaseId: string;
  readonly accountPolicyId: AccountPolicyId;
  readonly accountRef: AccountRef;
  readonly route: ModelGatewayRoute;
  readonly jobId: string;
  readonly runtimeInvocationId: string;
  readonly credentialRevisionId: string;
  readonly selectionReason: ModelGatewayAccountSelection["reason"];
  readonly candidateRejections: readonly ModelGatewayAccountRejection[];
  /** Absent only when replaying lease evidence written before usage capture existed. */
  readonly usageEvidence?: ModelGatewayAccountUsageEvidence;
  readonly affinityOutcome?: ModelGatewayAffinityOutcome;
  readonly affinityCommitOutcome?: ManagedAccountAffinityCommitOutcome;
  readonly acquiredAt: string;
  readonly lifecycleState: ManagedAccountLeaseLifecycleState;
  readonly releasedAt?: string;
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
}

export interface ManagedAccountLeaseEvidenceInput {
  readonly leaseId: string;
  readonly accountPolicyId: string;
  readonly accountRef: string;
  readonly route: ModelGatewayRoute;
  readonly jobId: string;
  readonly runtimeInvocationId: string;
  readonly credentialRevisionId: string;
  readonly selectionReason: ModelGatewayAccountSelection["reason"];
  readonly candidateRejections?: readonly ModelGatewayAccountRejection[];
  readonly usageEvidence?: ModelGatewayAccountUsageEvidence;
  readonly affinityOutcome?: ModelGatewayAffinityOutcome;
  readonly affinityCommitOutcome?: ManagedAccountAffinityCommitOutcome;
  readonly acquiredAt: string;
  readonly lifecycleState: ManagedAccountLeaseLifecycleState;
  readonly releasedAt?: string;
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
}

export function defineManagedAccountLeaseEvidence(
  input: ManagedAccountLeaseEvidenceInput,
): ManagedAccountLeaseEvidence {
  const leaseId = requirePortableLeaseIdentifier(input.leaseId, "Managed account lease id is required");
  const accountRef = requireCanonicalAccountReference(input.accountRef);
  const acquiredAt = requireIsoTimestamp(input.acquiredAt, "Managed account lease acquired timestamp is required");
  const lifecycleState = requireManagedAccountLeaseLifecycleState(input.lifecycleState);
  const releasedAt = input.releasedAt === undefined
    ? undefined
    : requireIsoTimestamp(input.releasedAt, "Managed account lease released timestamp is invalid");
  if (lifecycleState === "released" && releasedAt === undefined) {
    throw new Error("Managed account lease released timestamp is required for released state");
  }
  if (lifecycleState !== "released" && releasedAt !== undefined) {
    throw new Error("Managed account lease released timestamp requires a terminal release state");
  }
  if (releasedAt !== undefined && Date.parse(releasedAt) < Date.parse(acquiredAt)) {
    throw new Error("Managed account lease released timestamp cannot precede acquisition");
  }
  if (input.affinityCommitOutcome !== undefined && lifecycleState !== "released") {
    throw new Error("Managed account lease affinity commit outcome requires released state");
  }
  if (!/^[a-f0-9]{64}$/.test(input.credentialRevisionId)) {
    throw new Error("Managed account lease credential revision identity must be a SHA-256 digest");
  }
  const resourceUri = `kiln://managed-accounts/leases/${encodeURIComponent(leaseId)}`;
  if (input.resourceUris.length !== 1) {
    throw new Error("Managed account lease must expose exactly one canonical resource URI");
  }
  if (new Set(input.diagnosticUris).size !== input.diagnosticUris.length) {
    throw new Error("Managed account lease diagnostic URIs must be unique");
  }
  const diagnosticUris = input.diagnosticUris
    .map((uri) => requireManagedAccountDiagnosticUri(uri, resourceUri))
    .sort((left, right) => left.localeCompare(right));
  requireManagedAccountLifecycleDiagnostics(input.lifecycleState, diagnosticUris, resourceUri);
  return {
    leaseId,
    accountPolicyId: createAccountPolicyId(requirePortableLeaseIdentifier(
      input.accountPolicyId,
      "Managed account lease policy id is required",
    )),
    accountRef,
    route: requireManagedAccountRoute(input.route),
    jobId: requirePortableLeaseIdentifier(input.jobId, "Managed account lease job id is required"),
    runtimeInvocationId: requirePortableLeaseIdentifier(
      input.runtimeInvocationId,
      "Managed account lease runtime invocation id is required",
    ),
    credentialRevisionId: input.credentialRevisionId,
    selectionReason: requireManagedAccountSelectionReason(input.selectionReason),
    candidateRejections: (input.candidateRejections ?? []).map((rejection) => defineModelGatewayAccountRejection({
      ...rejection,
      account: requireCanonicalAccountReference(rejection.account),
    })),
    ...(input.usageEvidence !== undefined
      ? { usageEvidence: defineModelGatewayAccountUsageEvidence(input.usageEvidence) }
      : {}),
    ...(input.affinityOutcome !== undefined
      ? { affinityOutcome: requireManagedAccountAffinityOutcome(input.affinityOutcome) }
      : {}),
    ...(input.affinityCommitOutcome !== undefined
      ? { affinityCommitOutcome: requireManagedAccountAffinityCommitOutcome(input.affinityCommitOutcome) }
      : {}),
    acquiredAt,
    lifecycleState,
    ...(releasedAt !== undefined ? { releasedAt } : {}),
    resourceUris: input.resourceUris.map((uri) => {
      if (uri !== resourceUri) throw new Error("Managed account lease resource URI is outside its canonical namespace");
      return uri;
    }),
    diagnosticUris,
  };
}

function requireCanonicalAccountReference(value: string): AccountRef {
  if (
    value.length === 0
    || value.length > 512
    || value !== value.trim()
    || !/^configured:[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+){0,3}$/.test(value)
  ) {
    throw new Error("Managed account lease account reference must be canonical");
  }
  return createAccountRef(value);
}

function requirePortableLeaseIdentifier(value: string, message: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || value !== value.trim()
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new Error(message);
  }
  return value;
}

function requireManagedAccountDiagnosticUri(value: string, resourceUri: string): string {
  const allowed = new Set([
    `${resourceUri}/settlement-pending`,
    `${resourceUri}/release-failed`,
    `${resourceUri}/settlement-unknown`,
    `${resourceUri}/recovery-unmatchable`,
  ]);
  if (!allowed.has(value)) {
    throw new Error("Managed account lease diagnostic URI is outside its canonical namespace");
  }
  return value;
}

function requireManagedAccountLifecycleDiagnostics(
  lifecycleState: ManagedAccountLeaseLifecycleState,
  diagnosticUris: readonly string[],
  resourceUri: string,
): void {
  const suffixes = diagnosticUris.map((uri) => uri.slice(resourceUri.length));
  const allowedSuffixes = lifecycleState === "held"
    ? []
    : lifecycleState === "settlement-pending"
      ? ["/settlement-pending", "/settlement-unknown"]
      : lifecycleState === "release-failed"
        ? ["/settlement-pending", "/settlement-unknown", "/release-failed"]
        : lifecycleState === "released"
          ? ["/settlement-pending", "/settlement-unknown", "/release-failed"]
          : ["/settlement-pending", "/settlement-unknown", "/release-failed", "/recovery-unmatchable"];
  if (suffixes.some((suffix) => !allowedSuffixes.includes(suffix))) {
    throw new Error(`Managed account lease ${lifecycleState} state has incompatible diagnostic evidence`);
  }
  const requiredSuffix = lifecycleState === "settlement-pending"
    ? ["/settlement-pending", "/settlement-unknown"]
    : lifecycleState === "release-failed"
      ? ["/release-failed"]
      : lifecycleState === "leaked"
        ? ["/recovery-unmatchable"]
        : [];
  if (
    requiredSuffix.length > 0
    && !diagnosticUris.some((uri) => requiredSuffix.some((suffix) => uri === `${resourceUri}${suffix}`))
  ) {
    throw new Error(`Managed account lease ${lifecycleState} state requires canonical diagnostic evidence`);
  }
}

function requireManagedAccountRoute(route: ModelGatewayRoute): ModelGatewayRoute {
  return {
    providerId: requireText(route.providerId, "Managed account lease provider id is required"),
    providerModelId: requireText(route.providerModelId, "Managed account lease provider model id is required"),
    scope: requireText(route.scope, "Managed account lease route scope is required"),
  };
}

function requireManagedAccountLeaseLifecycleState(
  value: ManagedAccountLeaseLifecycleState,
): ManagedAccountLeaseLifecycleState {
  if (!MANAGED_ACCOUNT_LEASE_LIFECYCLE_STATES.includes(value)) {
    throw new Error(`Unsupported managed account lease lifecycle state: ${String(value)}`);
  }
  return value;
}

function requireManagedAccountSelectionReason(
  value: ModelGatewayAccountSelection["reason"],
): ModelGatewayAccountSelection["reason"] {
  if (value !== "existing-affinity" && value !== "least-pressure" && value !== "affinity-rebind") {
    throw new Error(`Unsupported managed account lease selection reason: ${String(value)}`);
  }
  return value;
}

function requireManagedAccountAffinityOutcome(
  value: ModelGatewayAffinityOutcome,
): ModelGatewayAffinityOutcome {
  if (value !== "honored" && value !== "missing" && value !== "rejected" && value !== "rebound") {
    throw new Error(`Unsupported managed account lease affinity outcome: ${String(value)}`);
  }
  return value;
}

function requireManagedAccountAffinityCommitOutcome(
  value: ManagedAccountAffinityCommitOutcome,
): ManagedAccountAffinityCommitOutcome {
  if (!MANAGED_ACCOUNT_AFFINITY_COMMIT_OUTCOMES.includes(value)) {
    throw new Error(`Unsupported managed account affinity commit outcome: ${String(value)}`);
  }
  return value;
}

export type ManagedAgentWorktreeReviewStatus = "required";

export type ManagedAgentWorktreeReviewReason = "dirty-worktree-preserved";

export type ManagedAgentWorktreeConflictStatus = "blocked";

export type ManagedAgentWorktreeConflictReason =
  | "same-checkout-write-conflict"
  | "isolated-worktree-path-conflict";

export interface ManagedAgentWorktreeReviewEvidence {
  readonly status: ManagedAgentWorktreeReviewStatus;
  readonly reason: ManagedAgentWorktreeReviewReason;
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
}

export interface ManagedAgentWorktreeConflictEvidence {
  readonly status: ManagedAgentWorktreeConflictStatus;
  readonly reason: ManagedAgentWorktreeConflictReason;
  readonly requestedInvocationId: string;
  readonly conflictingInvocationId: string;
  readonly workingDirectoryPath: string;
  readonly workingDirectoryMode: ManagedAgentWorkingDirectory["mode"];
  readonly policyId: "managed-agent.worktree.single-active-writer";
  readonly retryAfterInvocationIds: readonly string[];
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
}

export interface ManagedAgentResourceLeaseEvidence {
  readonly leaseId: string;
  readonly createdAt: string;
  readonly healthStatus: ManagedAgentResourceLeaseHealthStatus;
  readonly cleanupStatus: ManagedAgentResourceLeaseCleanupStatus;
  readonly workingDirectoryPath: string;
  readonly workingDirectoryMode: ManagedAgentWorkingDirectory["mode"];
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
  readonly worktreeReview?: ManagedAgentWorktreeReviewEvidence;
  readonly worktreeConflict?: ManagedAgentWorktreeConflictEvidence;
}

export interface ManagedAgentLifecycleEvidence {
  readonly lifecycleState: ManagedAgentLifecycleState;
  readonly invocationId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly providerId: string;
  readonly model?: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly authorityProfileId: string;
  readonly resourceLease: ManagedAgentResourceLeaseEvidence;
  readonly sourceResourceUris: readonly string[];
  readonly transcriptUri?: string;
  readonly heartbeatAt?: string;
  readonly resultSummary?: string;
  readonly diagnosticUris: readonly string[];
  readonly usage?: ManagedAgentUsageReport;
  readonly coordinationUsage?: ManagedAgentCoordinationUsageReport;
  readonly handoffResourceUris: readonly string[];
}

export interface ManagedAgentInvocationRecord {
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly lifecycleState: ManagedAgentLifecycleState;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly adapterKind: ManagedAgentAdapterKind;
  readonly executionMode: ManagedAgentExecutionMode;
  readonly authority: ManagedAgentAuthorityProfile;
  readonly capabilitySnapshot: ManagedAgentCapabilitySnapshot;
  readonly resourceLease?: ManagedAgentResourceLeaseEvidence;
  readonly accountLease?: ManagedAccountLeaseEvidence;
  readonly childSessionId?: string;
  readonly childTurnId?: string;
  readonly transcript?: ManagedAgentTranscriptPointer;
  readonly diagnostics?: readonly ManagedAgentDiagnosticPointer[];
  readonly usage?: ManagedAgentUsageReport;
  readonly coordinationUsage?: ManagedAgentCoordinationUsageReport;
  readonly resultHandoff?: ManagedAgentResultHandoff;
  readonly replayResources?: readonly ManagedAgentReplayResource[];
  readonly writeEvidence?: readonly ManagedAgentWriteEvidence[];
}

export type ManagedAgentAdmissionDecision =
  | {
    readonly status: "admitted";
    readonly invocationId: string;
    readonly profile: ManagedAgentAdmissionProfile;
    readonly adapterDescriptorId: string;
    readonly authorityProfileId: string;
    readonly credentialRouteId?: string;
    readonly memoryScope: MemoryScope;
    readonly writeAuthority?: ManagedAgentWriteAuthority;
    readonly capabilitySnapshot: ManagedAgentCapabilitySnapshot;
  }
  | {
    readonly status: "denied";
    readonly invocationId?: string;
    readonly profile?: ManagedAgentAdmissionProfile;
    readonly routeId: string;
    readonly routeSource: ManagedAgentRouteSource;
    readonly reason: string;
    readonly missingCapabilities: readonly string[];
    readonly resourceLease?: ManagedAgentResourceLeaseEvidence;
  };

export function defineManagedAgentInvocationRequest(input: ManagedAgentInvocationRequest): ManagedAgentInvocationRequest {
  const authority = requireAuthority(input.authority);
  return {
    invocationId: requireText(input.invocationId, "Managed invocation id is required"),
    agentId: requireText(input.agentId, "Managed invocation agent id is required"),
    parentSessionId: requireText(input.parentSessionId, "Managed invocation parent session id is required"),
    parentTurnId: requireText(input.parentTurnId, "Managed invocation parent turn id is required"),
    profile: requireAdmissionProfile(input.profile),
    requestedBy: requireText(input.requestedBy, "Managed invocation requester is required"),
    requestSource: requireText(input.requestSource, "Managed invocation request source is required"),
    executionIntent: requireExecutionIntent(input.executionIntent ?? {
      attendance: "attended",
      lifecycle: "foreground",
    }),
    requestedAuthority: requireRequestedAuthority(input.requestedAuthority ?? "auto"),
    ...(input.authorityApproval !== undefined ? { authorityApproval: requireAuthorityApproval(input.authorityApproval) } : {}),
    providerRoute: requireProviderRoute(input.providerRoute),
    adapterKind: requireAdapterKind(input.adapterKind),
    executionMode: requireExecutionMode(input.executionMode),
    authority,
    ...(input.executionScope ? { executionScope: requireSessionExecutionScope(input.executionScope) } : {}),
    ...(input.externalRuntimeAttachment
      ? { externalRuntimeAttachment: requireExternalRuntimeAttachmentIdentity(input.externalRuntimeAttachment) }
      : {}),
    input: {
      summary: requireText(input.input?.summary, "Managed invocation input summary is required"),
      ...(input.input?.prompt !== undefined ? { prompt: input.input.prompt } : {}),
      ...(input.input?.resourceUris !== undefined ? { resourceUris: input.input.resourceUris.map((uri) => requireText(uri, "Managed invocation resource uri is required")) } : {}),
      ...(input.input?.context !== undefined ? { context: requireInvocationContext(input.input.context) } : {}),
      ...(input.input?.handoff !== undefined ? { handoff: requireHandoffContract(input.input.handoff) } : {}),
    },
  };
}

export function defineManagedAgentAdapterDescriptor(input: ManagedAgentAdapterDescriptor): ManagedAgentAdapterDescriptor {
  return {
    adapterDescriptorId: requireText(input.adapterDescriptorId, "Managed adapter descriptor id is required"),
    providerId: requireText(input.providerId, "Managed adapter provider id is required"),
    adapterKind: requireAdapterKind(input.adapterKind),
    supportedProfiles: input.supportedProfiles.map(requireAdmissionProfile),
    supportedExecutionModes: input.supportedExecutionModes.map(requireExecutionMode),
    lifecycle: {
      exposesStart: input.lifecycle.exposesStart === true,
      exposesTerminal: input.lifecycle.exposesTerminal === true,
      exposesCleanup: input.lifecycle.exposesCleanup === true,
    },
    cancellation: { supported: input.cancellation.supported === true },
    timeout: {
      supported: input.timeout.supported === true,
      diagnosticArtifactOnTimeout: input.timeout.diagnosticArtifactOnTimeout === true,
    },
    transcript: {
      supported: input.transcript.supported === true,
      redactionKnown: input.transcript.redactionKnown === true,
      truncationKnown: input.transcript.truncationKnown === true,
      persistenceKnown: input.transcript.persistenceKnown === true,
      retentionKnown: input.transcript.retentionKnown === true,
    },
    usage: {
      supported: input.usage.supported === true,
      preservesProviderTokenClasses: input.usage.preservesProviderTokenClasses === true,
      supportsExplicitUnknowns: input.usage.supportsExplicitUnknowns === true,
      tokenClasses: input.usage.tokenClasses.map(requireUsageTokenClassCapability),
      semanticSourceGranularity: requireSemanticSourceGranularity(
        input.usage.semanticSourceGranularity,
        input.usage.evidenceBasis,
      ),
      evidenceBasis: requireUsageEvidenceBasis(input.usage.evidenceBasis),
    },
    resultHandoff: {
      boundedSummary: input.resultHandoff.boundedSummary === true,
      resourcePointers: input.resultHandoff.resourcePointers === true,
    },
    credentialRoute: { supported: input.credentialRoute.supported === true },
    memoryContext: { governedAdmission: input.memoryContext.governedAdmission === true },
    writeAuthority: defineManagedAgentAdapterWriteAuthorityDescriptor(input.writeAuthority),
    unsupportedFieldPolicy: requireUnsupportedFieldPolicy(input.unsupportedFieldPolicy),
    cleanup: { supported: input.cleanup.supported === true },
    ...(input.limitations !== undefined
      ? { limitations: input.limitations.map((limitation) => requireText(limitation, "Managed adapter limitation is required")) }
      : {}),
  };
}

function requireSessionExecutionScope(input: SessionExecutionScope): SessionExecutionScope {
  const goalRunId = requireText(input.goalRunId, "Managed invocation execution scope goal run id is required");
  if (input.kind === "goal") {
    return {
      kind: "goal",
      goalRunId,
      ...(input.managedInvocationId ? { managedInvocationId: requireText(input.managedInvocationId, "Managed invocation execution scope invocation id is required") } : {}),
    };
  }
  if (input.kind === "work_item") {
    return {
      kind: "work_item",
      goalRunId,
      workItemId: requireText(input.workItemId, "Managed invocation execution scope work item id is required"),
      ...(input.attemptId ? { attemptId: requireText(input.attemptId, "Managed invocation execution scope attempt id is required") } : {}),
      ...(input.managedInvocationId ? { managedInvocationId: requireText(input.managedInvocationId, "Managed invocation execution scope invocation id is required") } : {}),
    };
  }
  throw new Error(`Unsupported managed invocation execution scope: ${String((input as { readonly kind?: unknown }).kind)}`);
}

export function defineManagedAgentCapabilitySnapshot(input: ManagedAgentCapabilitySnapshot): ManagedAgentCapabilitySnapshot {
  return {
    snapshotId: requireText(input.snapshotId, "Managed capability snapshot id is required"),
    capturedAt: requireIsoTimestamp(input.capturedAt, "Managed capability snapshot timestamp is required"),
    routeId: requireText(input.routeId, "Managed capability snapshot route id is required"),
    routeSource: requireRouteSource(input.routeSource),
    ...(input.callerIdentity !== undefined
      ? { callerIdentity: requireCallerAttachmentIdentity(input.callerIdentity) }
      : {}),
    ...(input.externalRuntimeAttachment !== undefined
      ? { externalRuntimeAttachment: requireExternalRuntimeAttachmentIdentity(input.externalRuntimeAttachment) }
      : {}),
    routeHealth: {
      status: requireRouteHealthStatus(input.routeHealth.status),
      reason: requireText(input.routeHealth.reason, "Managed capability snapshot route health reason is required"),
    },
    providerModelProof: {
      status: requireProviderModelProofStatus(input.providerModelProof.status),
      source: requireText(input.providerModelProof.source, "Managed capability snapshot provider proof source is required"),
      ...(input.providerModelProof.requiresToolCalls !== undefined
        ? { requiresToolCalls: input.providerModelProof.requiresToolCalls === true }
        : {}),
    },
    providerRoute: requireProviderRoute(input.providerRoute),
    adapterKind: requireAdapterKind(input.adapterKind),
    executionMode: requireExecutionMode(input.executionMode),
    adapterDescriptor: defineManagedAgentAdapterDescriptor(input.adapterDescriptor),
    authorityProfile: requireAuthority(input.authorityProfile),
    authorityEvidence: requireAuthorityEvidence(input.authorityEvidence),
    contextMode: requireContextMode(input.contextMode),
    resourcePlane: {
      available: input.resourcePlane.available === true,
      resourceUris: input.resourcePlane.resourceUris.map((uri) => requireText(uri, "Managed capability snapshot resource uri is required")),
      ...(input.resourcePlane.reason !== undefined
        ? { reason: requireText(input.resourcePlane.reason, "Managed capability snapshot resource reason is required") }
        : {}),
    },
    resourceLease: requireResourceLease(input.resourceLease),
    childIdentity: {
      agentId: requireText(input.childIdentity.agentId, "Managed capability snapshot child agent id is required"),
      ...(input.childIdentity.requestedAgentProfile !== undefined
        ? { requestedAgentProfile: requireText(input.childIdentity.requestedAgentProfile, "Managed capability snapshot requested agent profile is required") }
        : {}),
      ...(input.childIdentity.admittedAgentProfile !== undefined
        ? { admittedAgentProfile: requireText(input.childIdentity.admittedAgentProfile, "Managed capability snapshot admitted agent profile is required") }
        : {}),
      ...(input.childIdentity.displayName !== undefined
        ? { displayName: requireText(input.childIdentity.displayName, "Managed capability snapshot display name is required") }
        : {}),
      ...(input.childIdentity.voiceProfile !== undefined
        ? { voiceProfile: requireText(input.childIdentity.voiceProfile, "Managed capability snapshot voice profile is required") }
        : {}),
    },
  };
}

function requireCallerAttachmentIdentity(
  input: ManagedAgentCallerAttachmentIdentity,
): ManagedAgentCallerAttachmentIdentity {
  if (input.kind === "kiln-runtime") {
    return {
      kind: input.kind,
      surface: requireText(input.surface, "Managed invocation caller surface is required"),
      attachmentId: requireText(input.attachmentId, "Managed invocation caller attachment id is required"),
    };
  }
  if (input.kind === "external-harness") {
    return {
      kind: input.kind,
      harness: requireCallerHarness(input.harness),
      attachmentId: requireText(input.attachmentId, "Managed invocation caller attachment id is required"),
      evidenceId: requireText(input.evidenceId, "Managed invocation caller evidence id is required"),
    };
  }
  throw new Error(`Unsupported managed invocation caller identity kind: ${String((input as { readonly kind?: string }).kind ?? "")}`);
}

function requireExternalRuntimeAttachmentIdentity(
  input: ManagedAgentExternalRuntimeAttachmentIdentity,
): ManagedAgentExternalRuntimeAttachmentIdentity {
  if (input.kind !== "external-runtime") {
    throw new Error(`Unsupported managed invocation external runtime attachment kind: ${String((input as { readonly kind?: string }).kind ?? "")}`);
  }
  return {
    kind: "external-runtime",
    runtimeId: requireOpaqueAttachmentIdentity(input.runtimeId, "Managed invocation external runtime attachment runtimeId is required"),
    attachmentId: requireOpaqueAttachmentIdentity(input.attachmentId, "Managed invocation external runtime attachment attachmentId is required"),
  };
}

/**
 * runtimeId and attachmentId are opaque external-runtime identifiers, not
 * Kiln-owned names. Whitespace-only values are invalid, but any other value
 * must be persisted and compared byte-for-byte: trimming would let a
 * dispatch silently match a different physical instance than the caller
 * addressed. This is deliberately not `requireText`, which normalises.
 */
function requireOpaqueAttachmentIdentity(value: string | undefined, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function requireCallerHarness(
  harness: "claude" | "codex" | "opencode",
): "claude" | "codex" | "opencode" {
  if (harness === "claude" || harness === "codex" || harness === "opencode") {
    return harness;
  }
  throw new Error(`Unsupported managed invocation caller harness: ${String(harness)}`);
}

export function buildManagedAgentAuthorityEvidence(input: {
  readonly request: ManagedAgentInvocationRequest;
  readonly projectedSource: ManagedAgentProjectedAuthorityEvidence["source"];
  readonly observedRuntime?: ManagedAgentObservedRuntimeAuthorityEvidence;
  readonly evaluatedAt?: string;
}): ManagedAgentAuthorityEvidence {
  const observedRuntime = input.observedRuntime ?? {
    source: "not-observed" as const,
    proof: "unavailable" as const,
    reason: "Managed child runtime authority is not observable from the admission snapshot.",
  };
  const evidence = requireAuthorityEvidence({
    requested: {
      authority: input.request.requestedAuthority ?? "auto",
      source: "managed-invocation-request",
      proof: "proven",
    },
    projected: {
      permissionProfile: input.request.authority.permissionProfile,
      approval: approvalEvidenceFromAuthority(input.request.authority),
      sandbox: sandboxEvidenceFromAuthority(input.request.authority),
      source: input.projectedSource,
      proof: "proven",
    },
    observedRuntime,
    classification: "effective-policy-unproven",
  });
  return classifyManagedAgentAuthorityEvidence(evidence, input.evaluatedAt);
}

export function classifyManagedAgentAuthorityEvidence(
  input: ManagedAgentAuthorityEvidence,
  evaluatedAt = new Date().toISOString(),
): ManagedAgentAuthorityEvidence {
  const evidence = requireAuthorityEvidence(input);
  const now = requireTimestamp(evaluatedAt, "Managed authority evaluation timestamp is invalid");
  const observed = evidence.observedRuntime;
  let classification: ManagedAgentAuthorityEvidenceClassification;
  if (observed.proof === "contradictory") {
    classification = "runtime-policy-mismatch";
  } else if (observed.proof === "failed") {
    classification = "failed-observation";
  } else if (observed.source === "not-observed") {
    classification = "effective-policy-unproven";
  } else if (observed.proof === "unavailable" || observed.proof === "inferred") {
    classification = "effective-policy-unproven";
  } else if (
    observed.approval === undefined || observed.sandbox === undefined ||
    observed.observedAt === undefined || observed.validUntil === undefined
  ) {
    classification = "partial-observation";
  } else if (
    (observed.validUntil !== undefined && requireTimestamp(observed.validUntil, "Managed authority validity timestamp is invalid") < now) ||
    requireTimestamp(observed.observedAt, "Managed authority observation timestamp is invalid") > now
  ) {
    classification = "stale-evidence";
  } else if (
    observed.approval !== evidence.projected.approval ||
    observed.sandbox !== evidence.projected.sandbox
  ) {
    classification = "runtime-policy-mismatch";
  } else {
    classification = "current-verified";
  }
  return {
    ...evidence,
    classification,
    recommendation: authorityRecommendation(classification),
  };
}

function authorityRecommendation(classification: ManagedAgentAuthorityEvidenceClassification): string {
  if (classification === "current-verified") return "Child runtime authority matches the admitted projection.";
  if (classification === "runtime-policy-mismatch") return "Stop the child invocation and re-run only after projected and observed authority match.";
  if (classification === "failed-observation") return "Retry runtime authority observation before execution or replay; do not infer child authority from the projection.";
  if (classification === "stale-evidence") return "Observe child runtime authority again before execution or replay.";
  if (classification === "partial-observation") return "Require complete approval and sandbox observations before execution.";
  return "Do not treat projected child authority as effective until the runtime observer provides proof.";
}

function requireAuthorityEvidence(input: ManagedAgentAuthorityEvidence): ManagedAgentAuthorityEvidence {
  return {
    requested: {
      authority: requireRequestedAuthority(input.requested.authority),
      source: requireRequestedAuthorityEvidenceSource(input.requested.source),
      proof: requireRequestedAuthorityProof(input.requested.proof),
      ...(input.requested.reason !== undefined
        ? { reason: requireText(input.requested.reason, "Managed authority requested evidence reason is required") }
        : {}),
    },
    projected: {
      permissionProfile: requireText(input.projected.permissionProfile, "Managed projected authority permission profile is required"),
      approval: requireAuthorityEvidenceApproval(input.projected.approval),
      sandbox: requireAuthorityEvidenceSandbox(input.projected.sandbox),
      source: requireProjectedAuthorityEvidenceSource(input.projected.source),
      proof: requireProjectedAuthorityProof(input.projected.proof),
      ...(input.projected.reason !== undefined
        ? { reason: requireText(input.projected.reason, "Managed projected authority evidence reason is required") }
        : {}),
    },
    observedRuntime: {
      ...(input.observedRuntime.approval !== undefined
        ? { approval: requireAuthorityEvidenceApproval(input.observedRuntime.approval) }
        : {}),
      ...(input.observedRuntime.sandbox !== undefined
        ? { sandbox: requireAuthorityEvidenceSandbox(input.observedRuntime.sandbox) }
        : {}),
      source: requireObservedRuntimeAuthoritySource(input.observedRuntime.source),
      proof: requireAuthorityEvidenceProof(input.observedRuntime.proof),
      ...(input.observedRuntime.observedAt !== undefined
        ? { observedAt: new Date(requireTimestamp(input.observedRuntime.observedAt, "Managed authority observation timestamp is invalid")).toISOString() }
        : {}),
      ...(input.observedRuntime.validUntil !== undefined
        ? { validUntil: new Date(requireTimestamp(input.observedRuntime.validUntil, "Managed authority validity timestamp is invalid")).toISOString() }
        : {}),
      ...(input.observedRuntime.reason !== undefined
        ? { reason: requireText(input.observedRuntime.reason, "Managed observed runtime authority evidence reason is required") }
        : {}),
    },
    classification: requireAuthorityEvidenceClassification(input.classification),
    ...(input.recommendation !== undefined
      ? { recommendation: requireText(input.recommendation, "Managed authority evidence recommendation is required") }
      : {}),
  };
}

function sandboxEvidenceFromAuthority(authority: ManagedAgentAuthorityProfile): ManagedAgentChildAuthoritySandbox {
  return authority.toolAuthority.writeAllowed === true && authority.workingDirectory.mode !== "read-only"
    ? "workspace-write"
    : "read-only";
}

function approvalEvidenceFromAuthority(authority: ManagedAgentAuthorityProfile): ManagedAgentChildAuthorityApproval {
  const profile = authority.permissionProfile.toLowerCase();
  return profile.includes("trusted") || profile.includes("full-access") || profile.includes("danger-full-access")
    ? "never"
    : "on-request";
}

function collectAuthorityEvidenceGaps(
  request: ManagedAgentInvocationRequest,
  authorityEvidence: ManagedAgentAuthorityEvidence | undefined,
  missingCapabilities: string[],
  evaluatedAt?: string,
): void {
  const classified = authorityEvidence === undefined
    ? undefined
    : classifyManagedAgentAuthorityEvidence(authorityEvidence, evaluatedAt);
  if (classified?.classification === "runtime-policy-mismatch") {
    missingCapabilities.push("authorityEvidence.runtimePolicyMismatch");
  }
  if (
    requiresProvenManagedRuntimeAuthority(request) &&
    classified?.classification !== "current-verified" &&
    classified?.classification !== "runtime-policy-mismatch"
  ) {
    missingCapabilities.push(`authorityEvidence.${classified?.classification ?? "effective-policy-unproven"}`);
  }
}

function requiresProvenManagedRuntimeAuthority(request: ManagedAgentInvocationRequest): boolean {
  return request.executionIntent?.attendance === "unattended" || request.executionIntent?.lifecycle !== "foreground";
}

function requireRequestedAuthorityEvidenceSource(
  source: ManagedAgentRequestedAuthorityEvidence["source"],
): ManagedAgentRequestedAuthorityEvidence["source"] {
  if (source === "managed-invocation-request" || source === "parent-authority" || source === "runtime-default") {
    return source;
  }
  throw new Error(`Unsupported managed requested authority evidence source: ${String(source)}`);
}

function requireProjectedAuthorityEvidenceSource(
  source: ManagedAgentProjectedAuthorityEvidence["source"],
): ManagedAgentProjectedAuthorityEvidence["source"] {
  if (
    source === "managed-authority-profile" ||
    source === "cli-harness-session-factory" ||
    source === "direct-provider-adapter" ||
    source === "remote-harness-adapter"
  ) {
    return source;
  }
  throw new Error(`Unsupported managed projected authority evidence source: ${String(source)}`);
}

function requireObservedRuntimeAuthoritySource(
  source: ManagedAgentObservedRuntimeAuthorityEvidence["source"],
): ManagedAgentObservedRuntimeAuthorityEvidence["source"] {
  if (
    source === "not-observed" ||
    source === "runtime-observation" ||
    source === "child-session-metadata" ||
    source === "harness-event"
  ) {
    return source;
  }
  throw new Error(`Unsupported managed observed runtime authority evidence source: ${String(source)}`);
}

function requireAuthorityEvidenceApproval(
  approval: ManagedAgentChildAuthorityApproval,
): ManagedAgentChildAuthorityApproval {
  if (approval === "on-request" || approval === "never" || approval === "untrusted" || approval === "unknown") {
    return approval;
  }
  throw new Error(`Unsupported managed authority evidence approval: ${String(approval)}`);
}

function requireAuthorityEvidenceSandbox(
  sandbox: ManagedAgentChildAuthoritySandbox,
): ManagedAgentChildAuthoritySandbox {
  if (sandbox === "read-only" || sandbox === "workspace-write" || sandbox === "danger-full-access" || sandbox === "unknown") {
    return sandbox;
  }
  throw new Error(`Unsupported managed authority evidence sandbox: ${String(sandbox)}`);
}

function requireAuthorityEvidenceProof(proof: ManagedAgentChildAuthorityProof): ManagedAgentChildAuthorityProof {
  if (proof === "proven" || proof === "inferred" || proof === "unavailable" || proof === "contradictory" || proof === "failed") {
    return proof;
  }
  throw new Error(`Unsupported managed authority evidence proof: ${String(proof)}`);
}

function requireRequestedAuthorityProof(
  proof: ManagedAgentRequestedAuthorityEvidence["proof"],
): ManagedAgentRequestedAuthorityEvidence["proof"] {
  if (proof === "proven" || proof === "inferred") {
    return proof;
  }
  throw new Error(`Unsupported managed requested authority evidence proof: ${String(proof)}`);
}

function requireProjectedAuthorityProof(
  proof: ManagedAgentProjectedAuthorityEvidence["proof"],
): ManagedAgentProjectedAuthorityEvidence["proof"] {
  if (proof === "proven" || proof === "inferred") {
    return proof;
  }
  throw new Error(`Unsupported managed projected authority evidence proof: ${String(proof)}`);
}

function requireAuthorityEvidenceClassification(
  classification: ManagedAgentAuthorityEvidenceClassification,
): ManagedAgentAuthorityEvidenceClassification {
  if (
    classification === "current-verified" ||
    classification === "effective-policy-unproven" ||
    classification === "runtime-policy-mismatch" ||
    classification === "stale-evidence" ||
    classification === "partial-observation" ||
    classification === "failed-observation"
  ) {
    return classification;
  }
  throw new Error(`Unsupported managed authority evidence classification: ${String(classification)}`);
}

export function defineManagedAgentInvocationRecord(input: ManagedAgentInvocationRecord): ManagedAgentInvocationRecord {
  const capabilitySnapshot = defineManagedAgentCapabilitySnapshot(input.capabilitySnapshot);
  return {
    invocationId: requireText(input.invocationId, "Managed invocation record id is required"),
    agentId: requireText(input.agentId, "Managed invocation record agent id is required"),
    parentSessionId: requireText(input.parentSessionId, "Managed invocation record parent session id is required"),
    parentTurnId: requireText(input.parentTurnId, "Managed invocation record parent turn id is required"),
    profile: requireAdmissionProfile(input.profile),
    lifecycleState: requireLifecycleState(input.lifecycleState),
    providerRoute: requireInvocationRecordProviderRoute(input.providerRoute, capabilitySnapshot.providerRoute),
    adapterKind: requireMatchingAdapterKind(input.adapterKind, capabilitySnapshot.adapterKind),
    executionMode: requireMatchingExecutionMode(input.executionMode, capabilitySnapshot.executionMode),
    authority: requireAuthority(input.authority),
    capabilitySnapshot,
    ...(input.resourceLease !== undefined ? { resourceLease: requireResourceLease(input.resourceLease) } : {}),
    ...(input.accountLease !== undefined ? { accountLease: defineManagedAccountLeaseEvidence(input.accountLease) } : {}),
    ...(input.childSessionId !== undefined ? { childSessionId: requireText(input.childSessionId, "Managed invocation child session id is required") } : {}),
    ...(input.childTurnId !== undefined ? { childTurnId: requireText(input.childTurnId, "Managed invocation child turn id is required") } : {}),
    ...(input.transcript !== undefined ? { transcript: requireTranscript(input.transcript) } : {}),
    ...(input.diagnostics !== undefined ? { diagnostics: input.diagnostics.map(requireDiagnosticPointer) } : {}),
    ...(input.usage !== undefined ? { usage: requireUsageReport(input.usage, capabilitySnapshot.adapterDescriptor) } : {}),
    ...(input.coordinationUsage !== undefined
      ? { coordinationUsage: defineManagedAgentCoordinationUsageReport(input.coordinationUsage) }
      : {}),
    ...(input.resultHandoff !== undefined ? { resultHandoff: requireResultHandoff(input.resultHandoff) } : {}),
    ...(input.replayResources !== undefined ? { replayResources: input.replayResources.map(requireReplayResource) } : {}),
    ...(input.writeEvidence !== undefined ? { writeEvidence: input.writeEvidence.map(defineManagedAgentWriteEvidence) } : {}),
  };
}

export function evaluateManagedAgentAdmission(
  request: ManagedAgentInvocationRequest,
  descriptor: ManagedAgentAdapterDescriptor,
  snapshotInput: ManagedAgentCapabilitySnapshotInput,
  options: { readonly evaluatedAt?: string } = {},
): ManagedAgentAdmissionDecision {
  const missingCapabilities: string[] = [];
  const routeId = requireText(snapshotInput.routeId, "Managed capability snapshot route id is required");
  const routeSource = requireRouteSource(snapshotInput.routeSource);
  collectRequestGaps(request, missingCapabilities);
  collectAuthorityEvidenceGaps(request, snapshotInput.authorityEvidence, missingCapabilities, options.evaluatedAt);
  collectExternalRuntimeAttachmentGaps(request, snapshotInput, missingCapabilities);

  const profile = request.profile;
  if (profile === "foundation-readonly-plan") {
    collectReadonlyAuthorityGaps(request, missingCapabilities);
  } else if (isManagedAgentWriteAuthorityProfile(profile)) {
    collectWriteAuthorityGaps(request, descriptor, missingCapabilities);
  } else {
    missingCapabilities.push("profile.foundation-managed-invocation");
  }

  if (!descriptor.supportedProfiles?.includes(profile)) {
    missingCapabilities.push(`descriptor.supportedProfiles.${profile}`);
  }
  if (request.executionMode && !descriptor.supportedExecutionModes?.includes(request.executionMode)) {
    missingCapabilities.push("descriptor.supportedExecutionModes");
  }
  if (request.adapterKind && descriptor.adapterKind !== request.adapterKind) {
    missingCapabilities.push("descriptor.adapterKind");
  }
  if (request.providerRoute?.providerId && descriptor.providerId !== request.providerRoute.providerId) {
    missingCapabilities.push("descriptor.providerId");
  }

  collectDescriptorGaps(descriptor, missingCapabilities);

  if (missingCapabilities.length > 0) {
    return {
      status: "denied",
      invocationId: request.invocationId,
      profile: request.profile,
      routeId,
      routeSource,
      reason: `foundation-readonly-plan denied: ${missingCapabilities.join(", ")}`,
      missingCapabilities,
    };
  }

  return {
    status: "admitted",
    invocationId: request.invocationId,
    profile,
    adapterDescriptorId: descriptor.adapterDescriptorId,
    authorityProfileId: request.authority.authorityProfileId,
    ...(request.authority.credentialRoute.mode !== "credentialless"
      ? { credentialRouteId: request.authority.credentialRoute.routeId }
      : {}),
    memoryScope: request.authority.memoryScope.scope,
    ...(request.authority.writeAuthority !== undefined ? { writeAuthority: request.authority.writeAuthority } : {}),
    capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, descriptor, snapshotInput),
  };
}

export function buildManagedAgentCapabilitySnapshot(
  request: ManagedAgentInvocationRequest,
  descriptor: ManagedAgentAdapterDescriptor,
  input: ManagedAgentCapabilitySnapshotInput,
): ManagedAgentCapabilitySnapshot {
  const resourcePlane = input.resourcePlane ?? {
    available: true,
    resourceUris: request.input.resourceUris ?? [],
  };
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  return defineManagedAgentCapabilitySnapshot({
    snapshotId: `${request.invocationId}:capability-snapshot`,
    capturedAt,
    routeId: input.routeId,
    routeSource: input.routeSource,
    ...(input.callerIdentity ? { callerIdentity: input.callerIdentity } : {}),
    ...(input.externalRuntimeAttachment ? { externalRuntimeAttachment: input.externalRuntimeAttachment } : {}),
    routeHealth: input.routeHealth ?? {
      status: "healthy",
      reason: "Route descriptor admitted by managed invocation policy.",
    },
    providerModelProof: input.providerModelProof ?? {
      status: "configured",
      source: "managed-invocation-admission",
    },
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    adapterDescriptor: descriptor,
    authorityProfile: request.authority,
    authorityEvidence: input.authorityEvidence ?? buildManagedAgentAuthorityEvidence({
      request,
      projectedSource: "managed-authority-profile",
    }),
    contextMode: request.input.context?.mode ?? "isolated",
    resourcePlane,
    resourceLease: input.resourceLease ?? {
      leaseId: `${request.invocationId}:resource-lease`,
      createdAt: capturedAt,
      healthStatus: "healthy",
      cleanupStatus: request.authority.workingDirectory.mode === "read-only" ? "not-required" : "pending",
      workingDirectoryPath: request.authority.workingDirectory.path,
      workingDirectoryMode: request.authority.workingDirectory.mode,
      resourceUris: resourcePlane.resourceUris,
      diagnosticUris: [],
    },
    childIdentity: input.childIdentity ?? {
      agentId: request.agentId,
      ...(request.input.context?.agentProfile ? { requestedAgentProfile: request.input.context.agentProfile } : {}),
      ...(request.input.context?.admittedAgentProfile ? { admittedAgentProfile: request.input.context.admittedAgentProfile } : {}),
    },
  });
}

function collectExternalRuntimeAttachmentGaps(
  request: ManagedAgentInvocationRequest,
  snapshotInput: ManagedAgentCapabilitySnapshotInput,
  missingCapabilities: string[],
): void {
  const comparison = compareManagedAgentExternalRuntimeAttachment(
    snapshotInput.externalRuntimeAttachment,
    request.externalRuntimeAttachment,
  );
  if (comparison === "missing") {
    missingCapabilities.push("externalRuntimeAttachment.missing");
  } else if (comparison === "mismatch") {
    missingCapabilities.push("externalRuntimeAttachment.mismatch");
  } else if (comparison === "unsupported-route") {
    missingCapabilities.push("externalRuntimeAttachment.unsupported-route");
  }
}

function collectRequestGaps(request: ManagedAgentInvocationRequest, missingCapabilities: string[]): void {
  if (!hasText(request.invocationId)) missingCapabilities.push("request.invocationId");
  if (!hasText(request.agentId)) missingCapabilities.push("request.agentId");
  if (!hasText(request.parentSessionId)) missingCapabilities.push("request.parentSessionId");
  if (!hasText(request.parentTurnId)) missingCapabilities.push("request.parentTurnId");
  if (!request.providerRoute || !hasText(request.providerRoute.providerId) || !hasText(request.providerRoute.surface)) {
    missingCapabilities.push("request.providerRoute");
  }
  if (!MANAGED_AGENT_ADAPTER_KINDS.includes(request.adapterKind)) missingCapabilities.push("request.adapterKind");
  if (!MANAGED_AGENT_EXECUTION_MODES.includes(request.executionMode)) missingCapabilities.push("request.executionMode");
  collectRequestedAuthorityGaps(request, missingCapabilities);
  if (!request.authority) {
    missingCapabilities.push("request.authority");
    return;
  }
  if (!hasText(request.authority.permissionProfile)) missingCapabilities.push("request.authority.permissionProfile");
  if (!request.authority.toolAuthority) {
    missingCapabilities.push("request.authority.toolAuthority");
  } else {
    if (request.profile === "foundation-apply-approved-writes") {
      if (request.authority.toolAuthority.writeAllowed !== true) missingCapabilities.push("request.authority.toolAuthority.writeAllowed.true");
    } else if (request.authority.toolAuthority.writeAllowed !== false) {
      missingCapabilities.push("request.authority.toolAuthority.writeAllowed.false");
    }
    if (request.profile !== "foundation-readonly-plan" && request.authority.toolAuthority.networkAllowed !== false) {
      missingCapabilities.push("request.authority.toolAuthority.networkAllowed.false");
    }
  }
  if (!request.authority.workingDirectory || !hasText(request.authority.workingDirectory.path)) {
    missingCapabilities.push("request.authority.workingDirectory");
  }
  if (typeof request.authority.timeoutMs !== "number" || request.authority.timeoutMs <= 0) {
    missingCapabilities.push("request.authority.timeoutMs");
  }
  if (!request.authority.credentialRoute) {
    missingCapabilities.push("request.authority.credentialRoute");
  } else if (request.authority.credentialRoute.mode !== "credentialless" && !hasText(request.authority.credentialRoute.routeId)) {
    missingCapabilities.push("request.authority.credentialRoute.routeId");
  } else if (
    request.authority.credentialRoute.mode !== "runtime-selected"
    && request.authority.credentialRoute.mode !== "account-leased"
    && request.authority.credentialRoute.mode !== "credentialless"
  ) {
    missingCapabilities.push("request.authority.credentialRoute.mode");
  }
  if (!request.authority.memoryScope?.scope) {
    missingCapabilities.push("request.authority.memoryScope");
  }
}

function collectRequestedAuthorityGaps(request: ManagedAgentInvocationRequest, missingCapabilities: string[]): void {
  if (!MANAGED_AGENT_REQUESTED_AUTHORITIES.includes((request.requestedAuthority ?? "auto") as ManagedAgentRequestedAuthority)) {
    missingCapabilities.push("request.requestedAuthority");
    return;
  }
  if (request.requestedAuthority === "destructive") {
    if (request.authorityApproval?.approved !== true) {
      missingCapabilities.push("request.requestedAuthority.destructiveApprovalFlow");
    }
  }
  if (request.requestedAuthority === "read_only" && request.profile !== "foundation-readonly-plan") {
    missingCapabilities.push("request.requestedAuthority.readOnlyProfile");
  }
}

function collectReadonlyAuthorityGaps(request: ManagedAgentInvocationRequest, missingCapabilities: string[]): void {
  if (request.authority?.writeAuthority !== undefined) {
    missingCapabilities.push("request.authority.writeAuthority.none");
  }
  if (request.authority?.memoryScope?.access === "write-proposals") {
    missingCapabilities.push("request.authority.memoryScope.readOnly");
  }
}

function collectWriteAuthorityGaps(
  request: ManagedAgentInvocationRequest,
  descriptor: ManagedAgentAdapterDescriptor,
  missingCapabilities: string[],
): void {
  const writeAuthority = request.authority?.writeAuthority;
  const descriptorWriteAuthority = defineManagedAgentAdapterWriteAuthorityDescriptor(descriptor.writeAuthority);

  if (writeAuthority === undefined) {
    missingCapabilities.push("request.authority.writeAuthority");
    return;
  }

  if (writeAuthority.profile !== request.profile) {
    missingCapabilities.push("request.authority.writeAuthority.profile");
  }
  if (!descriptorWriteAuthority.proposalSupported) {
    missingCapabilities.push("writeAuthority.proposalSupported");
  }
  if (!descriptorWriteAuthority.scopeReduction) {
    missingCapabilities.push("writeAuthority.scopeReduction");
  }

  const requiresMemoryProposal =
    request.profile === "foundation-memory-write-proposals" ||
    writeAuthority.scope.memory.mode !== "none" ||
    request.authority.memoryScope.access === "write-proposals";
  if (requiresMemoryProposal && !descriptorWriteAuthority.memoryProposalSupported) {
    missingCapabilities.push("writeAuthority.memoryProposalSupported");
  }

  if (request.profile === "foundation-propose-writes") {
    if (writeAuthority.scope.workspace.mode === "apply-approved") {
      missingCapabilities.push("request.authority.writeAuthority.workspace.proposeOnly");
    }
    if (writeAuthority.approval.evidenceRequired !== true) {
      missingCapabilities.push("request.authority.writeAuthority.approval.evidenceRequired");
    }
  }

  if (request.profile === "foundation-memory-write-proposals") {
    if (writeAuthority.scope.memory.mode !== "propose") {
      missingCapabilities.push("request.authority.writeAuthority.memory.propose");
    }
  }

  if (request.profile === "foundation-apply-approved-writes") {
    if (!descriptorWriteAuthority.approvedApplySupported) {
      missingCapabilities.push("writeAuthority.approvedApplySupported");
    }
    if (!descriptorWriteAuthority.rollbackEvidence) {
      missingCapabilities.push("writeAuthority.rollbackEvidence");
    }
    if (!descriptorWriteAuthority.cleanupEvidence) {
      missingCapabilities.push("writeAuthority.cleanupEvidence");
    }
    if (request.authority.workingDirectory.mode === "read-only") {
      missingCapabilities.push("request.authority.workingDirectory.writable");
    }
    if (writeAuthority.scope.workspace.mode !== "apply-approved") {
      missingCapabilities.push("request.authority.writeAuthority.workspace.applyApproved");
    }
    if (writeAuthority.approval.mode === "none" || writeAuthority.approval.evidenceRequired !== true) {
      missingCapabilities.push("request.authority.writeAuthority.approval.requiredBeforeApply");
    }
  }
}

function collectDescriptorGaps(descriptor: ManagedAgentAdapterDescriptor, missingCapabilities: string[]): void {
  if (descriptor.lifecycle?.exposesStart !== true) missingCapabilities.push("lifecycle.exposesStart");
  if (descriptor.lifecycle?.exposesTerminal !== true) missingCapabilities.push("lifecycle.exposesTerminal");
  if (descriptor.lifecycle?.exposesCleanup !== true) missingCapabilities.push("lifecycle.exposesCleanup");
  if (descriptor.cancellation?.supported !== true) missingCapabilities.push("cancellation.supported");
  if (descriptor.timeout?.supported !== true) missingCapabilities.push("timeout.supported");
  if (descriptor.transcript?.supported !== true) missingCapabilities.push("transcript.supported");
  if (descriptor.transcript?.redactionKnown !== true) missingCapabilities.push("transcript.redactionKnown");
  if (descriptor.transcript?.truncationKnown !== true) missingCapabilities.push("transcript.truncationKnown");
  if (descriptor.transcript?.persistenceKnown !== true) missingCapabilities.push("transcript.persistenceKnown");
  if (descriptor.transcript?.retentionKnown !== true) missingCapabilities.push("transcript.retentionKnown");
  if (descriptor.usage?.supported !== true) missingCapabilities.push("usage.supported");
  if (descriptor.usage?.preservesProviderTokenClasses !== true) missingCapabilities.push("usage.preservesProviderTokenClasses");
  if (descriptor.usage?.supportsExplicitUnknowns !== true) missingCapabilities.push("usage.supportsExplicitUnknowns");
  if (descriptor.resultHandoff?.boundedSummary !== true) missingCapabilities.push("resultHandoff.boundedSummary");
  if (descriptor.resultHandoff?.resourcePointers !== true) missingCapabilities.push("resultHandoff.resourcePointers");
  if (descriptor.credentialRoute?.supported !== true) missingCapabilities.push("credentialRoute.supported");
  if (descriptor.memoryContext?.governedAdmission !== true) missingCapabilities.push("memoryContext.governedAdmission");
  if (descriptor.unsupportedFieldPolicy !== "reject") missingCapabilities.push("unsupportedFieldPolicy.reject");
  if (descriptor.cleanup?.supported !== true) missingCapabilities.push("cleanup.supported");
}

function requireAuthorityApproval(input: ManagedAgentAuthorityApproval): ManagedAgentAuthorityApproval {
  if (input.approved !== true) {
    throw new Error("Managed invocation destructive authority approval is required");
  }
  return {
    approved: true,
    ...(hasText(input.reason) ? { reason: input.reason } : {}),
  };
}

export function buildManagedAgentLifecycleEvidence(
  record: ManagedAgentInvocationRecord,
  input: { readonly heartbeatAt?: string } = {},
): ManagedAgentLifecycleEvidence {
  return {
    lifecycleState: record.lifecycleState,
    invocationId: record.invocationId,
    parentSessionId: record.parentSessionId,
    parentTurnId: record.parentTurnId,
    routeId: record.capabilitySnapshot.routeId,
    routeSource: record.capabilitySnapshot.routeSource,
    providerId: record.providerRoute.providerId,
    ...(record.providerRoute.model !== undefined ? { model: record.providerRoute.model } : {}),
    profile: record.profile,
    ...(record.capabilitySnapshot.externalRuntimeAttachment !== undefined
      ? { externalRuntimeAttachment: record.capabilitySnapshot.externalRuntimeAttachment }
      : {}),
    contextMode: record.capabilitySnapshot.contextMode,
    authorityProfileId: record.authority.authorityProfileId,
    resourceLease: record.resourceLease ?? record.capabilitySnapshot.resourceLease,
    ...(record.accountLease !== undefined ? { accountLease: defineManagedAccountLeaseEvidence(record.accountLease) } : {}),
    sourceResourceUris: record.capabilitySnapshot.resourcePlane.resourceUris,
    ...(record.transcript?.uri !== undefined ? { transcriptUri: record.transcript.uri } : {}),
    ...(input.heartbeatAt !== undefined ? { heartbeatAt: requireIsoTimestamp(input.heartbeatAt, "Managed invocation heartbeat timestamp is required") } : {}),
    ...(record.resultHandoff?.summary !== undefined ? { resultSummary: record.resultHandoff.summary } : {}),
    diagnosticUris: record.diagnostics?.map((diagnostic) => diagnostic.uri) ?? [],
    ...(record.usage !== undefined ? { usage: record.usage } : {}),
    ...(record.coordinationUsage !== undefined ? { coordinationUsage: record.coordinationUsage } : {}),
    handoffResourceUris: record.resultHandoff?.resourceUris ?? [],
  };
}

function requireAuthority(input: ManagedAgentAuthorityProfile): ManagedAgentAuthorityProfile {
  const workingDirectoryPath = requireText(
    input.workingDirectory.path,
    "Managed invocation working directory is required",
  );
  if (isManagedAgentWorkspaceVolumeRoot(workingDirectoryPath)) {
    throw new Error("Managed invocation working directory must not be a filesystem volume root");
  }
  const credentialRoute = input.credentialRoute;
  if (credentialRoute.mode === "runtime-selected") {
    requireText(credentialRoute.routeId, "Managed invocation credential route id is required");
  } else if (credentialRoute.mode === "account-leased") {
    requireText(credentialRoute.routeId, "Managed invocation credential route id is required");
    createAccountPolicyId(credentialRoute.accountPolicyId);
  } else if (credentialRoute.mode !== "credentialless") {
    throw new Error(`Unsupported managed invocation credential route mode: ${(credentialRoute as { readonly mode?: string }).mode ?? ""}`);
  }

  return {
    authorityProfileId: requireText(input.authorityProfileId, "Managed invocation authority profile id is required"),
    permissionProfile: requireText(input.permissionProfile, "Managed invocation permission profile is required"),
    toolAuthority: {
      allowedToolNames: input.toolAuthority.allowedToolNames.map((name) => requireText(name, "Managed invocation tool name is required")),
      writeAllowed: input.toolAuthority.writeAllowed === true,
      networkAllowed: input.toolAuthority.networkAllowed === true,
    },
    workingDirectory: {
      path: workingDirectoryPath,
      mode: requireWorkingDirectoryMode(input.workingDirectory.mode),
    },
    timeoutMs: requirePositiveNumber(input.timeoutMs, "Managed invocation timeout must be greater than zero"),
    ...(input.timeoutSource !== undefined ? { timeoutSource: requireTimeoutSource(input.timeoutSource) } : {}),
    credentialRoute: credentialRoute.mode === "runtime-selected"
      ? {
          mode: "runtime-selected",
          routeId: requireText(credentialRoute.routeId, "Managed invocation credential route id is required"),
        }
      : credentialRoute.mode === "account-leased"
        ? {
          mode: "account-leased",
          routeId: requireText(credentialRoute.routeId, "Managed invocation credential route id is required"),
          accountPolicyId: createAccountPolicyId(credentialRoute.accountPolicyId),
        }
      : { mode: "credentialless" },
    memoryScope: {
      scope: defineMemoryScope(input.memoryScope.scope),
      access: input.memoryScope.access,
    },
    ...(input.readAuthority !== undefined ? { readAuthority: defineManagedAgentReadAuthority(input.readAuthority) } : {}),
    ...(input.writeAuthority !== undefined ? { writeAuthority: defineManagedAgentWriteAuthority(input.writeAuthority) } : {}),
  };
}

export function isManagedAgentWorkspaceVolumeRoot(path: string): boolean {
  const normalized = path.trim()
    .replaceAll("\\", "/")
    .replace(/^\/\/\?\/UNC\//iu, "//")
    .replace(/^\/\/\?\//u, "");
  if (/^\/(?!\/)/u.test(normalized) || /^\/{3,}/u.test(normalized)) {
    return collapsesToFilesystemRoot(normalized.replace(/^\/+/u, "").split("/"));
  }
  if (/^[A-Za-z]:\//u.test(normalized)) {
    return collapsesToFilesystemRoot(normalized.slice(3).split("/"));
  }
  if (normalized.startsWith("//")) {
    const segments = normalized.slice(2).split("/").filter(Boolean);
    return segments.length < 2
      ? collapsesToFilesystemRoot(segments)
      : collapsesToFilesystemRoot(segments.slice(2));
  }
  return false;
}

function collapsesToFilesystemRoot(segments: readonly string[]): boolean {
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.length === 0;
}

function requireTimeoutSource(source: ManagedAgentTimeoutSource): ManagedAgentTimeoutSource {
  if (source === "default" || source === "explicit-route") {
    return source;
  }
  throw new Error(`Unsupported managed invocation timeout source: ${String(source)}`);
}

function requireRouteSource(source: ManagedAgentRouteSource): ManagedAgentRouteSource {
  if (
    source === "ordered-routing" ||
    source === "explicit-managed-route" ||
    source === "managed-default-route" ||
    source === "enabled-engine-fallback"
  ) {
    return source;
  }
  throw new Error(`Unsupported managed capability snapshot route source: ${String(source)}`);
}

function requireProviderRoute(input: ManagedAgentProviderRoute): ManagedAgentProviderRoute {
  return {
    providerId: requireText(input.providerId, "Managed invocation provider id is required"),
    surface: requireText(input.surface, "Managed invocation provider surface is required"),
    ...(input.model !== undefined ? { model: requireText(input.model, "Managed invocation model is required") } : {}),
    ...(input.deliberationIntent !== undefined ? { deliberationIntent: requireDeliberationIntent(input.deliberationIntent) } : {}),
    ...(input.deliberationResolution !== undefined
      ? { deliberationResolution: requireDeliberationResolution(input.deliberationResolution) }
      : {}),
    ...(input.communicationIntent !== undefined
      ? { communicationIntent: requireResolvedCommunicationIntent(input.communicationIntent) }
      : {}),
  };
}

function requireResolvedCommunicationIntent(input: ResolvedCommunicationIntent): ResolvedCommunicationIntent {
  try {
    return validateResolvedCommunicationIntent(input);
  } catch {
    throw new Error("Managed invocation communication intent must be a resolved v1 contract.");
  }
}

function requireDeliberationResolution(input: DeliberationResolution): DeliberationResolution {
  if (input.status === "denied") {
    throw new Error("Denied deliberation cannot enter a managed invocation request.");
  }
  admitDeliberationForExecution(input);
  return input;
}

function requireDeliberationIntent(input: DeliberationIntent): DeliberationIntent {
  const onUnsupported = requireUnsupportedDeliberationPolicy(input.onUnsupported);
  if (input.mode === "provider-default") {
    return { mode: "provider-default", onUnsupported };
  }
  const bounds = input.bounds
    ? {
        ...(input.bounds.min ? { min: defineDeliberationLevelId(input.bounds.min) } : {}),
        ...(input.bounds.max ? { max: defineDeliberationLevelId(input.bounds.max) } : {}),
      }
    : undefined;
  if (input.mode === "fixed") {
    return {
      mode: "fixed",
      preferredLevel: defineDeliberationLevelId(input.preferredLevel),
      ...(bounds ? { bounds } : {}),
      onUnsupported,
    };
  }
  if (input.mode === "adaptive") {
    if (input.target !== "latency-first" && input.target !== "balanced" && input.target !== "quality-first") {
      throw new Error(`Unsupported managed invocation deliberation target: ${String(input.target)}`);
    }
    return {
      mode: "adaptive",
      target: input.target,
      ...(bounds ? { bounds } : {}),
      onUnsupported,
    };
  }
  throw new Error(`Unsupported managed invocation deliberation mode: ${String((input as { mode?: unknown }).mode)}`);
}

function requireUnsupportedDeliberationPolicy(value: UnsupportedDeliberationPolicy): UnsupportedDeliberationPolicy {
  if (value === "deny" || value === "omit" || value === "allow-clamp") return value;
  throw new Error(`Unsupported managed invocation deliberation policy: ${String(value)}`);
}

function requireInvocationContext(input: ManagedAgentInvocationContextSelection): ManagedAgentInvocationContextSelection {
  return {
    mode: requireContextMode(input.mode),
    ...(input.agentProfile !== undefined ? { agentProfile: requireText(input.agentProfile, "Managed invocation agent profile is required") } : {}),
    ...(input.skills !== undefined ? { skills: input.skills.map((skill) => requireText(skill, "Managed invocation skill is required")) } : {}),
    ...(input.instructionProfiles !== undefined ? { instructionProfiles: input.instructionProfiles.map((profile) => requireText(profile, "Managed invocation instruction profile is required")) } : {}),
    ...(input.workClassification !== undefined ? { workClassification: defineWorkClassification(input.workClassification) } : {}),
    ...(input.admittedAgentProfile !== undefined ? { admittedAgentProfile: requireText(input.admittedAgentProfile, "Managed invocation admitted agent profile is required") } : {}),
    ...(input.admittedSkills !== undefined ? { admittedSkills: input.admittedSkills.map((skill) => requireText(skill, "Managed invocation admitted skill is required")) } : {}),
    ...(input.admittedInstructionProfiles !== undefined ? { admittedInstructionProfiles: input.admittedInstructionProfiles.map((profile) => requireText(profile, "Managed invocation admitted instruction profile is required")) } : {}),
    ...(input.deniedSkills !== undefined ? { deniedSkills: input.deniedSkills.map((skill) => requireText(skill, "Managed invocation denied skill is required")) } : {}),
    ...(input.resolvedWorkClassification !== undefined ? { resolvedWorkClassification: defineWorkClassification(input.resolvedWorkClassification) } : {}),
    ...(input.workRecommendedSkills !== undefined ? { workRecommendedSkills: input.workRecommendedSkills.map((skill) => requireText(skill, "Managed invocation work recommended skill is required")) } : {}),
    ...(input.workRecommendedSkillDiagnostics !== undefined ? { workRecommendedSkillDiagnostics: input.workRecommendedSkillDiagnostics.map(requireWorkRecommendedSkillDiagnostic) } : {}),
  };
}

function requireWorkRecommendedSkillDiagnostic(
  input: WorkRecommendedSkillDiagnostic,
): WorkRecommendedSkillDiagnostic {
  if (
    input.state !== "admitted" &&
    input.state !== "advisory" &&
    input.state !== "unavailable"
  ) {
    throw new Error(`Unsupported work recommended skill diagnostic state: ${String(input.state)}`);
  }
  return {
    skillName: requireText(input.skillName, "Managed invocation work recommended skill diagnostic skill name is required"),
    state: input.state,
    reason: requireText(input.reason, "Managed invocation work recommended skill diagnostic reason is required"),
  };
}

function requireHandoffContract(input: ManagedAgentInvocationHandoffContract): ManagedAgentInvocationHandoffContract {
  return {
    ...(input.workItemId !== undefined ? { workItemId: requireText(input.workItemId, "Managed invocation handoff work item id is required") } : {}),
    ...(input.roleIntent !== undefined ? { roleIntent: requireText(input.roleIntent, "Managed invocation handoff role intent is required") } : {}),
    ...(input.expectedEvidence !== undefined ? { expectedEvidence: input.expectedEvidence.map((evidence) => requireText(evidence, "Managed invocation handoff evidence is required")) } : {}),
    ...(input.requiredResultFields !== undefined
      ? { requiredResultFields: input.requiredResultFields.map(requireManagedResultField) }
      : {}),
    ...(input.doneCriteria !== undefined ? { doneCriteria: input.doneCriteria.map((criterion) => requireText(criterion, "Managed invocation handoff done criterion is required")) } : {}),
    ...(input.residualRiskRequired !== undefined ? { residualRiskRequired: input.residualRiskRequired === true } : {}),
    ...(input.outputVerbosity !== undefined
      ? { outputVerbosity: requireAssistantOutputVerbosity(input.outputVerbosity) }
      : {}),
  };
}

function requireManagedResultField(field: ManagedAgentResultField): ManagedAgentResultField {
  if (
    field === "summary"
    || field === "resourceUris"
    || field === "evidence"
    || field === "verificationResults"
    || field === "uncertainty"
    || field === "limitations"
    || field === "warnings"
    || field === "approvalRequirements"
    || field === "residualRisks"
  ) {
    return field;
  }
  throw new Error(`Unsupported managed invocation handoff result field: ${String(field)}`);
}

function requireAssistantOutputVerbosity(input: AssistantOutputVerbosity): AssistantOutputVerbosity {
  if (input === "concise" || input === "standard" || input === "detailed") return input;
  throw new Error("Managed invocation handoff output verbosity is not supported");
}

function requireContextMode(input: ManagedAgentInvocationContextMode): ManagedAgentInvocationContextMode {
  if (input === "isolated" || input === "resources" || input === "fork") {
    return input;
  }
  throw new Error("Managed invocation context mode is not supported");
}

function requireTranscript(input: ManagedAgentTranscriptPointer): ManagedAgentTranscriptPointer {
  return {
    uri: requireText(input.uri, "Managed invocation transcript uri is required"),
    redacted: input.redacted,
    truncated: input.truncated,
    persisted: input.persisted,
    retention: input.retention,
  };
}

function requireDiagnosticPointer(input: ManagedAgentDiagnosticPointer): ManagedAgentDiagnosticPointer {
  return {
    uri: requireText(input.uri, "Managed invocation diagnostic uri is required"),
    kind: input.kind,
    ...(input.classification !== undefined
      ? { classification: requireTerminalFailureClassification(input.classification) }
      : {}),
  };
}

function requireTerminalFailureClassification(
  input: ManagedAgentTerminalFailureClassification,
): ManagedAgentTerminalFailureClassification {
  if (
    input === "harness_version_mismatch"
    || input === "structured_handoff_rejected"
    || input === "model_identity_mismatch"
    || input === "private_artifact_cleanup_failed"
    || input === "provider_quota_exhausted"
    || input === "native_session_error"
    || input === "write_boundary_violation"
    || input === "result_handoff_missing"
    || input === "unknown_failure"
  ) {
    return input;
  }
  throw new Error("Managed invocation terminal failure classification is not supported");
}

function requireInvocationRecordProviderRoute(
  input: ManagedAgentProviderRoute,
  admitted: ManagedAgentProviderRoute,
): ManagedAgentProviderRoute {
  const providerRoute = requireProviderRoute(input);
  if (
    providerRoute.providerId !== admitted.providerId
    || providerRoute.surface !== admitted.surface
    || providerRoute.model !== admitted.model
    || JSON.stringify(providerRoute.deliberationIntent) !== JSON.stringify(admitted.deliberationIntent)
    || JSON.stringify(providerRoute.deliberationResolution) !== JSON.stringify(admitted.deliberationResolution)
    || JSON.stringify(providerRoute.communicationIntent) !== JSON.stringify(admitted.communicationIntent)
  ) {
    throw new Error("Managed invocation usage route must match the admitted capability snapshot");
  }
  return providerRoute;
}

function requireMatchingAdapterKind(
  value: ManagedAgentAdapterKind,
  admitted: ManagedAgentAdapterKind,
): ManagedAgentAdapterKind {
  const adapterKind = requireAdapterKind(value);
  if (adapterKind !== admitted) {
    throw new Error("Managed invocation adapter kind must match the admitted capability snapshot");
  }
  return adapterKind;
}

function requireMatchingExecutionMode(
  value: ManagedAgentExecutionMode,
  admitted: ManagedAgentExecutionMode,
): ManagedAgentExecutionMode {
  const executionMode = requireExecutionMode(value);
  if (executionMode !== admitted) {
    throw new Error("Managed invocation execution mode must match the admitted capability snapshot");
  }
  return executionMode;
}

function requireUsageReport(
  input: ManagedAgentUsageReport,
  descriptor: ManagedAgentAdapterDescriptor,
): ManagedAgentUsageReport {
  if (!descriptor.usage.supported) {
    throw new Error("Managed invocation usage report is not supported by the admitted adapter descriptor");
  }
  const source = requireUsageReportSource(input.source);
  if (source !== descriptor.usage.evidenceBasis) {
    throw new Error("Managed invocation usage evidence source must match the admitted adapter descriptor");
  }
  const supportedTokenClasses = new Set(descriptor.usage.tokenClasses);
  const observedTokenClasses = new Set<ManagedAgentUsageTokenClassCapability>();
  const tokenClasses = input.tokenClasses.map((entry) => {
    const name = requireSupportedUsageTokenClass(entry.name, supportedTokenClasses);
    if (observedTokenClasses.has(name)) {
      throw new Error(`Managed invocation usage token class must be unique: ${name}`);
    }
    observedTokenClasses.add(name);
    return { name, value: requireUsageTokenValue(entry.value, name) };
  });
  return {
    source,
    tokenClasses,
    cost: {
      currency: input.cost.currency === "unknown"
        ? "unknown"
        : requireText(input.cost.currency, "Managed invocation usage cost currency is required"),
      amount: input.cost.amount === "unknown"
        ? "unknown"
        : requireNonNegativeFiniteNumber(input.cost.amount, "Managed invocation usage cost amount"),
    },
  };
}

function requireUsageTokenValue(
  value: ManagedAgentTokenClassUsage["value"],
  name: ManagedAgentUsageTokenClassCapability,
): ManagedAgentTokenClassUsage["value"] {
  if (value === "unknown") return value;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Managed invocation usage token value must be a non-negative safe integer: ${name}`);
  }
  return value;
}

function requireNonNegativeFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number`);
  return value;
}

function requireUsageReportSource(source: ManagedAgentUsageReport["source"]): ManagedAgentUsageReport["source"] {
  if (source === "adapter" || source === "provider" || source === "runtime" || source === "unknown") {
    return source;
  }
  throw new Error(`Unsupported managed invocation usage source: ${String(source)}`);
}

export function defineManagedAgentCoordinationUsageReport(
  input: ManagedAgentCoordinationUsageReport,
): ManagedAgentCoordinationUsageReport {
  const expectedStages: readonly ManagedAgentCoordinationStage[] = [
    "parent_prompt",
    "child_bootstrap",
    "duplicated_reads",
    "handoff",
    "review",
    "synthesis",
  ];
  if (input.version !== "managed-agent-coordination-usage-v1") {
    throw new Error("Managed coordination usage version is unsupported");
  }
  if (input.coverage !== "partial" && input.coverage !== "complete") {
    throw new Error("Managed coordination usage coverage is unsupported");
  }
  if (input.reconciliation !== "components-may-overlap" && input.reconciliation !== "mutually-exclusive") {
    throw new Error("Managed coordination usage reconciliation is unsupported");
  }
  const byStage = new Map(input.components.map((component) => [component.stage, component]));
  if (byStage.size !== expectedStages.length || expectedStages.some((stage) => !byStage.has(stage))) {
    throw new Error("Managed coordination usage must report every coordination stage exactly once");
  }
  return {
    version: input.version,
    workerId: requireText(input.workerId, "Managed coordination worker id is required"),
    coverage: input.coverage,
    reconciliation: input.reconciliation,
    components: expectedStages.map((stage) => {
      const component = byStage.get(stage)!;
      return {
        stage,
        providerTokenClass: requireCoordinationProviderTokenClass(
          component.providerTokenClass,
          stage,
        ),
        tokens: requireCoordinationMetric(component.tokens, `${stage}.tokens`),
        costUsd: requireCoordinationMetric(component.costUsd, `${stage}.costUsd`),
        latencyMs: requireCoordinationMetric(component.latencyMs, `${stage}.latencyMs`),
        turns: requireCoordinationMetric(component.turns, `${stage}.turns`),
        evidenceUris: component.evidenceUris.map((uri) =>
          requireText(uri, `Managed coordination ${stage} evidence uri is required`)),
      };
    }),
  };
}

function requireCoordinationMetric(
  metric: ManagedAgentCoordinationMetric,
  field: string,
): ManagedAgentCoordinationMetric {
  if (metric.source === "unknown") {
    if (metric.value !== "unknown") {
      throw new Error(`Managed coordination ${field} unknown source requires unknown value`);
    }
    return metric;
  }
  if (metric.source !== "provider_reported" && metric.source !== "estimated") {
    throw new Error(`Managed coordination ${field} source is unsupported`);
  }
  if (typeof metric.value !== "number" || !Number.isFinite(metric.value) || metric.value < 0) {
    throw new Error(`Managed coordination ${field} must be a non-negative finite number`);
  }
  return metric;
}

function requireCoordinationProviderTokenClass(
  value: unknown,
  stage: ManagedAgentCoordinationStage,
): "input" | "output" {
  if (value === "input" || value === "output") return value;
  throw new Error(`Managed coordination ${stage}.providerTokenClass is unsupported`);
}

function requireSupportedUsageTokenClass(
  value: ManagedAgentUsageTokenClassCapability,
  supportedTokenClasses: ReadonlySet<ManagedAgentUsageTokenClassCapability>,
): ManagedAgentUsageTokenClassCapability {
  const tokenClass = requireUsageTokenClassCapability(value);
  if (!supportedTokenClasses.has(tokenClass)) {
    throw new Error(`Managed invocation usage token class is not supported by the admitted adapter descriptor: ${tokenClass}`);
  }
  return tokenClass;
}

function requireResultHandoff(input: ManagedAgentResultHandoff): ManagedAgentResultHandoff {
  return {
    provenance: requireResultHandoffProvenance(input.provenance),
    summary: requireText(input.summary, "Managed invocation result handoff summary is required"),
    ...(input.summaryAuthority !== undefined
      ? { summaryAuthority: requireSummaryAuthority(input.summaryAuthority) }
      : {}),
    resourceUris: input.resourceUris.map((uri) => requireText(uri, "Managed invocation result resource uri is required")),
    memoryWriteProposalUris: input.memoryWriteProposalUris.map((uri) => requireText(uri, "Managed invocation memory proposal uri is required")),
    ...(input.ephemeralHarnessState !== undefined
      ? { ephemeralHarnessState: input.ephemeralHarnessState.map(requireEphemeralHarnessStateEvidence) }
      : {}),
    ...(input.structuredResult !== undefined
      ? { structuredResult: defineStructuredExecutionResult(input.structuredResult) }
      : {}),
    ...(input.verificationUsage !== undefined
      ? { verificationUsage: defineVerificationUsageReport(input.verificationUsage) }
      : {}),
  };
}

function requireSummaryAuthority(
  value: ManagedAgentResultHandoff["summaryAuthority"],
): NonNullable<ManagedAgentResultHandoff["summaryAuthority"]> {
  if (value === "runtime-derived" || value === "child-untrusted") {
    return value;
  }
  throw new Error(`Unsupported managed invocation summary authority: ${String(value)}`);
}

function requireEphemeralHarnessStateEvidence(
  input: ExecutionSessionEphemeralHarnessStateEvidence,
): ExecutionSessionEphemeralHarnessStateEvidence {
  if (input.capabilityId !== "claude-code-private-plan-artifacts-v1") {
    throw new Error(`Unsupported managed ephemeral harness capability: ${String(input.capabilityId)}`);
  }
  if (input.harness !== "claude-code") {
    throw new Error(`Unsupported managed ephemeral harness: ${String(input.harness)}`);
  }
  for (const [name, value] of [
    ["artifactCount", input.artifactCount],
    ["createdCount", input.createdCount],
    ["modifiedCount", input.modifiedCount],
    ["deletedCount", input.deletedCount],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Managed ephemeral harness ${name} must be a non-negative integer`);
    }
  }
  if (input.artifactCount !== input.createdCount + input.modifiedCount + input.deletedCount) {
    throw new Error("Managed ephemeral harness artifact count must equal its delta counts");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.artifactDigest)) {
    throw new Error("Managed ephemeral harness artifact digest must be a SHA-256 digest");
  }
  if (input.cleanupStatus !== "completed" && input.cleanupStatus !== "failed") {
    throw new Error(`Unsupported managed ephemeral harness cleanup status: ${String(input.cleanupStatus)}`);
  }
  if (typeof input.unexpectedDelta !== "boolean") {
    throw new Error("Managed ephemeral harness unexpected delta must be boolean");
  }
  return {
    capabilityId: input.capabilityId,
    harness: input.harness,
    artifactCount: input.artifactCount,
    createdCount: input.createdCount,
    modifiedCount: input.modifiedCount,
    deletedCount: input.deletedCount,
    artifactDigest: input.artifactDigest,
    cleanupStatus: input.cleanupStatus,
    unexpectedDelta: input.unexpectedDelta,
  };
}

function requireResultHandoffProvenance(
  input: ManagedAgentResultHandoffProvenance | undefined,
): ManagedAgentResultHandoffProvenance {
  if (input === undefined) {
    throw new Error("Managed invocation result handoff provenance is required");
  }
  const delivery = input.delivery;
  if (
    delivery !== "native-structured-output"
    && delivery !== "assistant-text"
    && delivery !== "submission-tool"
    && delivery !== "remote-harness"
    && delivery !== "runtime-generated"
  ) {
    throw new Error(`Unsupported managed invocation result handoff delivery: ${String(delivery)}`);
  }
  const harness = input.harness === undefined
    ? undefined
    : {
        id: requireText(input.harness.id, "Managed invocation result handoff harness id is required"),
        executable: requirePortableHarnessExecutable(input.harness.executable),
        version: requireText(input.harness.version, "Managed invocation result handoff harness version is required"),
      };
  const observedModelIds = input.observedModelIds.map((modelId) =>
    requireText(modelId, "Managed invocation result handoff observed model id is required"));
  const primaryObservedModelId = input.primaryObservedModelId === undefined
    ? undefined
    : requireText(
        input.primaryObservedModelId,
        "Managed invocation result handoff primary observed model id is required",
      );
  if (primaryObservedModelId !== undefined && !observedModelIds.includes(primaryObservedModelId)) {
    throw new Error("Managed invocation primary observed model id must be included in observed model ids");
  }
  return {
    delivery,
    configuredModelId: requireText(
      input.configuredModelId,
      "Managed invocation result handoff configured model id is required",
    ),
    ...(primaryObservedModelId !== undefined ? { primaryObservedModelId } : {}),
    observedModelIds,
    ...(harness ? { harness } : {}),
  };
}

function requirePortableHarnessExecutable(value: string): string {
  const executable = requireText(value, "Managed invocation result handoff harness executable is required");
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(executable)) {
    throw new Error("Managed invocation result handoff harness executable must be a portable identity");
  }
  return executable;
}

function requireReplayResource(input: ManagedAgentReplayResource): ManagedAgentReplayResource {
  return {
    uri: requireText(input.uri, "Managed invocation replay resource uri is required"),
    ...(input.title !== undefined ? { title: requireText(input.title, "Managed invocation replay resource title is required") } : {}),
    mimeType: requireText(input.mimeType, "Managed invocation replay resource MIME type is required"),
    text: requireText(input.text, "Managed invocation replay resource text is required"),
  };
}

function requireResourceLease(input: ManagedAgentResourceLeaseEvidence): ManagedAgentResourceLeaseEvidence {
  return {
    leaseId: requireText(input.leaseId, "Managed capability snapshot lease id is required"),
    createdAt: requireIsoTimestamp(input.createdAt, "Managed capability snapshot lease created timestamp is required"),
    healthStatus: requireResourceLeaseHealthStatus(input.healthStatus),
    cleanupStatus: requireResourceLeaseCleanupStatus(input.cleanupStatus),
    workingDirectoryPath: requireText(input.workingDirectoryPath, "Managed capability snapshot lease working directory is required"),
    workingDirectoryMode: requireWorkingDirectoryMode(input.workingDirectoryMode),
    resourceUris: input.resourceUris.map((uri) => requireText(uri, "Managed capability snapshot lease resource uri is required")),
    diagnosticUris: input.diagnosticUris.map((uri) => requireText(uri, "Managed capability snapshot lease diagnostic uri is required")),
    ...(input.worktreeReview !== undefined ? { worktreeReview: requireWorktreeReview(input.worktreeReview) } : {}),
    ...(input.worktreeConflict !== undefined ? { worktreeConflict: requireWorktreeConflict(input.worktreeConflict) } : {}),
  };
}

function requireWorktreeReview(input: ManagedAgentWorktreeReviewEvidence): ManagedAgentWorktreeReviewEvidence {
  return {
    status: requireWorktreeReviewStatus(input.status),
    reason: requireWorktreeReviewReason(input.reason),
    resourceUris: input.resourceUris.map((uri) =>
      requireText(uri, "Managed capability snapshot worktree review resource uri is required")
    ),
    diagnosticUris: input.diagnosticUris.map((uri) =>
      requireText(uri, "Managed capability snapshot worktree review diagnostic uri is required")
    ),
  };
}

function requireWorktreeConflict(input: ManagedAgentWorktreeConflictEvidence): ManagedAgentWorktreeConflictEvidence {
  return {
    status: requireWorktreeConflictStatus(input.status),
    reason: requireWorktreeConflictReason(input.reason),
    requestedInvocationId: requireText(input.requestedInvocationId, "Managed capability snapshot worktree conflict requested invocation is required"),
    conflictingInvocationId: requireText(input.conflictingInvocationId, "Managed capability snapshot worktree conflict active invocation is required"),
    workingDirectoryPath: requireText(input.workingDirectoryPath, "Managed capability snapshot worktree conflict working directory is required"),
    workingDirectoryMode: requireWorkingDirectoryMode(input.workingDirectoryMode),
    policyId: requireWorktreeConflictPolicyId(input.policyId),
    retryAfterInvocationIds: input.retryAfterInvocationIds.map((invocationId) =>
      requireText(invocationId, "Managed capability snapshot worktree conflict retry invocation is required")
    ),
    resourceUris: input.resourceUris.map((uri) =>
      requireText(uri, "Managed capability snapshot worktree conflict resource uri is required")
    ),
    diagnosticUris: input.diagnosticUris.map((uri) =>
      requireText(uri, "Managed capability snapshot worktree conflict diagnostic uri is required")
    ),
  };
}

function requireAdmissionProfile(value: ManagedAgentAdmissionProfile): ManagedAgentAdmissionProfile {
  if (!MANAGED_AGENT_ADMISSION_PROFILES.includes(value)) {
    throw new Error(`Unsupported managed invocation profile: ${value as string}`);
  }
  return value;
}

function requireAdapterKind(value: ManagedAgentAdapterKind): ManagedAgentAdapterKind {
  if (!MANAGED_AGENT_ADAPTER_KINDS.includes(value)) {
    throw new Error(`Unsupported managed invocation adapter kind: ${value as string}`);
  }
  return value;
}

function requireExecutionMode(value: ManagedAgentExecutionMode): ManagedAgentExecutionMode {
  if (!MANAGED_AGENT_EXECUTION_MODES.includes(value)) {
    throw new Error(`Unsupported managed invocation execution mode: ${value as string}`);
  }
  return value;
}

function requireRequestedAuthority(value: ManagedAgentRequestedAuthority): ManagedAgentRequestedAuthority {
  if (!MANAGED_AGENT_REQUESTED_AUTHORITIES.includes(value)) {
    throw new Error(`Unsupported managed invocation requested authority: ${value as string}`);
  }
  return value;
}

function requireExecutionIntent(input: ManagedAgentExecutionIntent): ManagedAgentExecutionIntent {
  if (input.attendance !== "attended" && input.attendance !== "unattended") {
    throw new Error(`Unsupported managed invocation attendance intent: ${String(input.attendance)}`);
  }
  if (
    input.lifecycle !== "foreground" && input.lifecycle !== "background" &&
    input.lifecycle !== "automation" && input.lifecycle !== "resume" &&
    input.lifecycle !== "scheduled"
  ) {
    throw new Error(`Unsupported managed invocation lifecycle intent: ${String(input.lifecycle)}`);
  }
  return { attendance: input.attendance, lifecycle: input.lifecycle };
}

function requireTimestamp(value: string, message: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(message);
  return timestamp;
}

function requireWorkingDirectoryMode(value: ManagedAgentWorkingDirectory["mode"]): ManagedAgentWorkingDirectory["mode"] {
  if (value === "read-only" || value === "workspace-write" || value === "isolated-worktree" || value === "sandbox") {
    return value;
  }
  throw new Error(`Unsupported managed invocation working directory mode: ${value as string}`);
}

function requireResourceLeaseHealthStatus(value: ManagedAgentResourceLeaseHealthStatus): ManagedAgentResourceLeaseHealthStatus {
  if (value === "healthy" || value === "stale" || value === "released" || value === "leaked") {
    return value;
  }
  throw new Error(`Unsupported managed capability snapshot lease health status: ${value as string}`);
}

function requireResourceLeaseCleanupStatus(value: ManagedAgentResourceLeaseCleanupStatus): ManagedAgentResourceLeaseCleanupStatus {
  if (value === "not-required" || value === "pending" || value === "completed" || value === "failed" || value === "unknown") {
    return value;
  }
  throw new Error(`Unsupported managed capability snapshot lease cleanup status: ${value as string}`);
}

function requireWorktreeReviewStatus(value: string): ManagedAgentWorktreeReviewStatus {
  if (value === "required") {
    return value;
  }
  throw new Error(`Unsupported managed capability snapshot worktree review status: ${value as string}`);
}

function requireWorktreeReviewReason(value: string): ManagedAgentWorktreeReviewReason {
  if (value === "dirty-worktree-preserved") {
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Managed capability snapshot worktree review reason is required");
  }
  throw new Error(`Unsupported managed capability snapshot worktree review reason: ${value as string}`);
}

function requireWorktreeConflictStatus(value: string): ManagedAgentWorktreeConflictStatus {
  if (value === "blocked") {
    return value;
  }
  throw new Error(`Unsupported managed capability snapshot worktree conflict status: ${value as string}`);
}

function requireWorktreeConflictReason(value: string): ManagedAgentWorktreeConflictReason {
  if (value === "same-checkout-write-conflict" || value === "isolated-worktree-path-conflict") {
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Managed capability snapshot worktree conflict reason is required");
  }
  throw new Error(`Unsupported managed capability snapshot worktree conflict reason: ${value as string}`);
}

function requireWorktreeConflictPolicyId(value: string): ManagedAgentWorktreeConflictEvidence["policyId"] {
  if (value === "managed-agent.worktree.single-active-writer") {
    return value;
  }
  throw new Error(`Unsupported managed capability snapshot worktree conflict policy: ${value as string}`);
}

function requireUnsupportedFieldPolicy(value: ManagedAgentUnsupportedFieldPolicy): ManagedAgentUnsupportedFieldPolicy {
  if (value !== "reject" && value !== "ignore-with-audit" && value !== "unsupported") {
    throw new Error(`Unsupported managed invocation unsupported-field policy: ${value as string}`);
  }
  return value;
}

function requireUsageTokenClassCapability(
  value: ManagedAgentUsageTokenClassCapability,
): ManagedAgentUsageTokenClassCapability {
  if (value === "input" || value === "output" || value === "cache_read" || value === "cache_write") {
    return value;
  }
  throw new Error(`Unsupported managed invocation usage token class: ${String(value)}`);
}

function requireSemanticSourceGranularity(
  value: ManagedAgentSemanticSourceGranularity,
  evidenceBasis: ManagedAgentUsageEvidenceBasis,
): ManagedAgentSemanticSourceGranularity {
  if (value !== "provider_reported" && value !== "estimated" && value !== "unknown") {
    throw new Error(`Unsupported managed invocation semantic source granularity: ${String(value)}`);
  }
  if (value === "provider_reported" && evidenceBasis !== "provider") {
    throw new Error("Managed invocation provider-reported semantic source granularity requires provider usage evidence");
  }
  return value;
}

function requireUsageEvidenceBasis(value: ManagedAgentUsageEvidenceBasis): ManagedAgentUsageEvidenceBasis {
  if (value === "provider" || value === "runtime" || value === "adapter" || value === "unknown") {
    return value;
  }
  throw new Error(`Unsupported managed invocation usage evidence basis: ${String(value)}`);
}

function requireRouteHealthStatus(value: ManagedAgentRouteHealthStatus): ManagedAgentRouteHealthStatus {
  if (value !== "healthy") {
    throw new Error(`Unsupported managed invocation route health status: ${value as string}`);
  }
  return value;
}

function requireProviderModelProofStatus(value: ManagedAgentProviderModelProofStatus): ManagedAgentProviderModelProofStatus {
  if (value !== "live-proven" && value !== "configured" && value !== "unproven") {
    throw new Error(`Unsupported managed invocation provider proof status: ${value as string}`);
  }
  return value;
}

function requireLifecycleState(value: ManagedAgentLifecycleState): ManagedAgentLifecycleState {
  if (!MANAGED_AGENT_LIFECYCLE_STATES.includes(value)) {
    throw new Error(`Unsupported managed invocation lifecycle state: ${value as string}`);
  }
  return value;
}

function requireIsoTimestamp(value: string | undefined, message: string): string {
  const text = requireText(value, message);
  if (Number.isNaN(Date.parse(text))) {
    throw new Error(message);
  }
  return text;
}

function requirePositiveNumber(value: number, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(message);
  }
  return value;
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}

function hasText(value: string | undefined): boolean {
  return (value?.trim() ?? "").length > 0;
}

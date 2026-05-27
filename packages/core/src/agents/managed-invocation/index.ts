import { defineMemoryScope } from "../../memory/domain/scope.js";
import type { MemoryScope } from "../../memory/domain/scope.js";
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

export * from "./write-authority.js";
export * from "./write-integration.js";
export * from "./orchestration.js";

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
  readonly reasoningEffort?: string;
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
    readonly mode: "credentialless";
  };

export interface ManagedAgentMemoryScope {
  readonly scope: MemoryScope;
  readonly access: "none" | "read-only" | "write-proposals";
}

export type ManagedAgentTimeoutSource = "default" | "explicit-route" | "request";

export interface ManagedAgentAuthorityProfile {
  readonly authorityProfileId: string;
  readonly permissionProfile: string;
  readonly toolAuthority: ManagedAgentToolAuthority;
  readonly workingDirectory: ManagedAgentWorkingDirectory;
  readonly timeoutMs: number;
  readonly timeoutSource?: ManagedAgentTimeoutSource;
  readonly credentialRoute: ManagedAgentCredentialRoute;
  readonly memoryScope: ManagedAgentMemoryScope;
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
  readonly requiredResultFields?: readonly string[];
  readonly doneCriteria?: readonly string[];
  readonly residualRiskRequired?: boolean;
}

export type ManagedAgentInvocationContextMode = "isolated" | "resources" | "fork";

export interface ManagedAgentInvocationContextSelection {
  readonly mode: ManagedAgentInvocationContextMode;
  readonly agentProfile?: string;
  readonly skills?: readonly string[];
  readonly instructionProfiles?: readonly string[];
  readonly admittedAgentProfile?: string;
  readonly admittedSkills?: readonly string[];
  readonly admittedInstructionProfiles?: readonly string[];
  readonly deniedSkills?: readonly string[];
}

export interface ManagedAgentInvocationRequest {
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly requestedBy: string;
  readonly requestSource: string;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly authorityApproval?: ManagedAgentAuthorityApproval;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly adapterKind: ManagedAgentAdapterKind;
  readonly executionMode: ManagedAgentExecutionMode;
  readonly authority: ManagedAgentAuthorityProfile;
  readonly input: ManagedAgentInvocationInput;
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

export interface ManagedAgentCapabilitySnapshot {
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly routeId: string;
  readonly routeHealth: ManagedAgentRouteHealthSnapshot;
  readonly providerModelProof: ManagedAgentProviderModelProofSnapshot;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly adapterKind: ManagedAgentAdapterKind;
  readonly executionMode: ManagedAgentExecutionMode;
  readonly adapterDescriptor: ManagedAgentAdapterDescriptor;
  readonly authorityProfile: ManagedAgentAuthorityProfile;
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly resourcePlane: ManagedAgentResourcePlaneSnapshot;
  readonly resourceLease: ManagedAgentResourceLeaseEvidence;
  readonly childIdentity: ManagedAgentChildIdentitySnapshot;
}

export interface ManagedAgentCapabilitySnapshotInput {
  readonly capturedAt?: string;
  readonly routeId?: string;
  readonly routeHealth?: ManagedAgentRouteHealthSnapshot;
  readonly providerModelProof?: ManagedAgentProviderModelProofSnapshot;
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
}

export interface ManagedAgentTokenClassUsage {
  readonly name: string;
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

export interface ManagedAgentResultHandoff {
  readonly summary: string;
  readonly resourceUris: readonly string[];
  readonly memoryWriteProposalUris: readonly string[];
}

export type ManagedAgentResourceLeaseHealthStatus = "healthy" | "stale" | "released" | "leaked";

export type ManagedAgentResourceLeaseCleanupStatus = "not-required" | "pending" | "completed" | "failed" | "unknown";

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
  readonly providerId: string;
  readonly model?: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly contextMode: ManagedAgentInvocationContextMode;
  readonly authorityProfileId: string;
  readonly resourceLease: ManagedAgentResourceLeaseEvidence;
  readonly transcriptUri?: string;
  readonly heartbeatAt?: string;
  readonly resultSummary?: string;
  readonly diagnosticUris: readonly string[];
  readonly usage?: ManagedAgentUsageReport;
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
  readonly childSessionId?: string;
  readonly childTurnId?: string;
  readonly transcript?: ManagedAgentTranscriptPointer;
  readonly diagnostics?: readonly ManagedAgentDiagnosticPointer[];
  readonly usage?: ManagedAgentUsageReport;
  readonly resultHandoff?: ManagedAgentResultHandoff;
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
    requestedAuthority: requireRequestedAuthority(input.requestedAuthority ?? "auto"),
    ...(input.authorityApproval !== undefined ? { authorityApproval: requireAuthorityApproval(input.authorityApproval) } : {}),
    providerRoute: requireProviderRoute(input.providerRoute),
    adapterKind: requireAdapterKind(input.adapterKind),
    executionMode: requireExecutionMode(input.executionMode),
    authority,
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

export function defineManagedAgentCapabilitySnapshot(input: ManagedAgentCapabilitySnapshot): ManagedAgentCapabilitySnapshot {
  return {
    snapshotId: requireText(input.snapshotId, "Managed capability snapshot id is required"),
    capturedAt: requireIsoTimestamp(input.capturedAt, "Managed capability snapshot timestamp is required"),
    routeId: requireText(input.routeId, "Managed capability snapshot route id is required"),
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

export function defineManagedAgentInvocationRecord(input: ManagedAgentInvocationRecord): ManagedAgentInvocationRecord {
  return {
    invocationId: requireText(input.invocationId, "Managed invocation record id is required"),
    agentId: requireText(input.agentId, "Managed invocation record agent id is required"),
    parentSessionId: requireText(input.parentSessionId, "Managed invocation record parent session id is required"),
    parentTurnId: requireText(input.parentTurnId, "Managed invocation record parent turn id is required"),
    profile: requireAdmissionProfile(input.profile),
    lifecycleState: requireLifecycleState(input.lifecycleState),
    providerRoute: requireProviderRoute(input.providerRoute),
    adapterKind: requireAdapterKind(input.adapterKind),
    executionMode: requireExecutionMode(input.executionMode),
    authority: requireAuthority(input.authority),
    capabilitySnapshot: defineManagedAgentCapabilitySnapshot(input.capabilitySnapshot),
    ...(input.resourceLease !== undefined ? { resourceLease: requireResourceLease(input.resourceLease) } : {}),
    ...(input.childSessionId !== undefined ? { childSessionId: requireText(input.childSessionId, "Managed invocation child session id is required") } : {}),
    ...(input.childTurnId !== undefined ? { childTurnId: requireText(input.childTurnId, "Managed invocation child turn id is required") } : {}),
    ...(input.transcript !== undefined ? { transcript: requireTranscript(input.transcript) } : {}),
    ...(input.diagnostics !== undefined ? { diagnostics: input.diagnostics.map(requireDiagnosticPointer) } : {}),
    ...(input.usage !== undefined ? { usage: requireUsageReport(input.usage) } : {}),
    ...(input.resultHandoff !== undefined ? { resultHandoff: requireResultHandoff(input.resultHandoff) } : {}),
    ...(input.writeEvidence !== undefined ? { writeEvidence: input.writeEvidence.map(defineManagedAgentWriteEvidence) } : {}),
  };
}

export function evaluateManagedAgentAdmission(
  request: ManagedAgentInvocationRequest,
  descriptor: ManagedAgentAdapterDescriptor,
  snapshotInput: ManagedAgentCapabilitySnapshotInput = {},
): ManagedAgentAdmissionDecision {
  const missingCapabilities: string[] = [];
  collectRequestGaps(request, missingCapabilities);

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
    ...(request.authority.credentialRoute.mode === "runtime-selected"
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
  input: ManagedAgentCapabilitySnapshotInput = {},
): ManagedAgentCapabilitySnapshot {
  const resourcePlane = input.resourcePlane ?? {
    available: true,
    resourceUris: request.input.resourceUris ?? [],
  };
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  return defineManagedAgentCapabilitySnapshot({
    snapshotId: `${request.invocationId}:capability-snapshot`,
    capturedAt,
    routeId: input.routeId ?? `${request.providerRoute.providerId}:${request.profile}`,
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
  } else if (request.authority.credentialRoute.mode === "runtime-selected" && !hasText(request.authority.credentialRoute.routeId)) {
    missingCapabilities.push("request.authority.credentialRoute.routeId");
  } else if (request.authority.credentialRoute.mode !== "runtime-selected" && request.authority.credentialRoute.mode !== "credentialless") {
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
    providerId: record.providerRoute.providerId,
    ...(record.providerRoute.model !== undefined ? { model: record.providerRoute.model } : {}),
    profile: record.profile,
    contextMode: record.capabilitySnapshot.contextMode,
    authorityProfileId: record.authority.authorityProfileId,
    resourceLease: record.resourceLease ?? record.capabilitySnapshot.resourceLease,
    ...(record.transcript?.uri !== undefined ? { transcriptUri: record.transcript.uri } : {}),
    ...(input.heartbeatAt !== undefined ? { heartbeatAt: requireIsoTimestamp(input.heartbeatAt, "Managed invocation heartbeat timestamp is required") } : {}),
    ...(record.resultHandoff?.summary !== undefined ? { resultSummary: record.resultHandoff.summary } : {}),
    diagnosticUris: record.diagnostics?.map((diagnostic) => diagnostic.uri) ?? [],
    ...(record.usage !== undefined ? { usage: record.usage } : {}),
    handoffResourceUris: record.resultHandoff?.resourceUris ?? [],
  };
}

function requireAuthority(input: ManagedAgentAuthorityProfile): ManagedAgentAuthorityProfile {
  const credentialRoute = input.credentialRoute;
  if (credentialRoute.mode === "runtime-selected") {
    requireText(credentialRoute.routeId, "Managed invocation credential route id is required");
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
      path: requireText(input.workingDirectory.path, "Managed invocation working directory is required"),
      mode: requireWorkingDirectoryMode(input.workingDirectory.mode),
    },
    timeoutMs: requirePositiveNumber(input.timeoutMs, "Managed invocation timeout must be greater than zero"),
    ...(input.timeoutSource !== undefined ? { timeoutSource: requireTimeoutSource(input.timeoutSource) } : {}),
    credentialRoute,
    memoryScope: {
      scope: defineMemoryScope(input.memoryScope.scope),
      access: input.memoryScope.access,
    },
    ...(input.writeAuthority !== undefined ? { writeAuthority: defineManagedAgentWriteAuthority(input.writeAuthority) } : {}),
  };
}

function requireTimeoutSource(source: ManagedAgentTimeoutSource): ManagedAgentTimeoutSource {
  if (source === "default" || source === "explicit-route" || source === "request") {
    return source;
  }
  throw new Error(`Unsupported managed invocation timeout source: ${String(source)}`);
}

function requireProviderRoute(input: ManagedAgentProviderRoute): ManagedAgentProviderRoute {
  return {
    providerId: requireText(input.providerId, "Managed invocation provider id is required"),
    surface: requireText(input.surface, "Managed invocation provider surface is required"),
    ...(input.model !== undefined ? { model: requireText(input.model, "Managed invocation model is required") } : {}),
    ...(input.reasoningEffort !== undefined ? { reasoningEffort: requireText(input.reasoningEffort, "Managed invocation reasoning effort is required") } : {}),
  };
}

function requireInvocationContext(input: ManagedAgentInvocationContextSelection): ManagedAgentInvocationContextSelection {
  return {
    mode: requireContextMode(input.mode),
    ...(input.agentProfile !== undefined ? { agentProfile: requireText(input.agentProfile, "Managed invocation agent profile is required") } : {}),
    ...(input.skills !== undefined ? { skills: input.skills.map((skill) => requireText(skill, "Managed invocation skill is required")) } : {}),
    ...(input.instructionProfiles !== undefined ? { instructionProfiles: input.instructionProfiles.map((profile) => requireText(profile, "Managed invocation instruction profile is required")) } : {}),
    ...(input.admittedAgentProfile !== undefined ? { admittedAgentProfile: requireText(input.admittedAgentProfile, "Managed invocation admitted agent profile is required") } : {}),
    ...(input.admittedSkills !== undefined ? { admittedSkills: input.admittedSkills.map((skill) => requireText(skill, "Managed invocation admitted skill is required")) } : {}),
    ...(input.admittedInstructionProfiles !== undefined ? { admittedInstructionProfiles: input.admittedInstructionProfiles.map((profile) => requireText(profile, "Managed invocation admitted instruction profile is required")) } : {}),
    ...(input.deniedSkills !== undefined ? { deniedSkills: input.deniedSkills.map((skill) => requireText(skill, "Managed invocation denied skill is required")) } : {}),
  };
}

function requireHandoffContract(input: ManagedAgentInvocationHandoffContract): ManagedAgentInvocationHandoffContract {
  return {
    ...(input.workItemId !== undefined ? { workItemId: requireText(input.workItemId, "Managed invocation handoff work item id is required") } : {}),
    ...(input.roleIntent !== undefined ? { roleIntent: requireText(input.roleIntent, "Managed invocation handoff role intent is required") } : {}),
    ...(input.expectedEvidence !== undefined ? { expectedEvidence: input.expectedEvidence.map((evidence) => requireText(evidence, "Managed invocation handoff evidence is required")) } : {}),
    ...(input.requiredResultFields !== undefined ? { requiredResultFields: input.requiredResultFields.map((field) => requireText(field, "Managed invocation handoff result field is required")) } : {}),
    ...(input.doneCriteria !== undefined ? { doneCriteria: input.doneCriteria.map((criterion) => requireText(criterion, "Managed invocation handoff done criterion is required")) } : {}),
    ...(input.residualRiskRequired !== undefined ? { residualRiskRequired: input.residualRiskRequired === true } : {}),
  };
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
  };
}

function requireUsageReport(input: ManagedAgentUsageReport): ManagedAgentUsageReport {
  return {
    source: input.source,
    tokenClasses: input.tokenClasses.map((entry) => ({
      name: requireText(entry.name, "Managed invocation token class name is required"),
      value: entry.value,
    })),
    cost: input.cost,
  };
}

function requireResultHandoff(input: ManagedAgentResultHandoff): ManagedAgentResultHandoff {
  return {
    summary: requireText(input.summary, "Managed invocation result handoff summary is required"),
    resourceUris: input.resourceUris.map((uri) => requireText(uri, "Managed invocation result resource uri is required")),
    memoryWriteProposalUris: input.memoryWriteProposalUris.map((uri) => requireText(uri, "Managed invocation memory proposal uri is required")),
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

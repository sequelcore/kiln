import type {
  AdmittedExecutionTarget,
  ArtifactResourceStore,
  AuditLog,
  AuthorityDescriptor,
  AuxiliaryModalityRoute,
  Capability,
  CommunicationResolution,
  ContentPart,
  ContextAuditEntry,
  ConversationToolResultProjectionPolicy,
  DeliberationIntent,
  DeliberationResolution,
  DeliberationSource,
  EffectiveTurnAuthoritySnapshot,
  EventBus,
  ExecutionBillingMode,
  ExecutionSessionBindingEvidence,
  KilnMcpClient,
  InvocationAdmission,
  ManagedAgentAdmissionProfile,
  ManagedAgentAuthorityProfile,
  ManagedAgentInvocationContextMode,
  ManagedAgentObservedRuntimeAuthorityEvidence,
  ManagedAgentProviderRoute,
  ManagedAgentRequestedAuthority,
  ModelCapabilityRegistry,
  ModelCommunicationCapabilities,
  ModelDeliberationCapabilities,
  ModelRouter,
  ModelRoutingRankingEvidence,
  ModelRoutingRationale,
  MultimodalArtifact,
  MultimodalCapability,
  MultimodalTransformCandidate,
  MultimodalTransportModality,
  OperatorAdoptionDecisionAuthority,
  ProviderAdapter,
  ProviderRequestEvidence,
  ProviderTransportObserver,
  ProviderTransportWatchdog,
  RateLimiter,
  ResolvedCommunicationIntent,
  ResolvedInvocationEffect,
  SessionExecutionScope,
  ToolAuthorizer,
  ToolCache,
  ToolCall,
  ToolChoiceOption,
  ToolDefinition,
  ToolResultSanitizer,
  TurnTemporalContext,
} from "@kilnai/core";
import type {
  RuntimeTurnTerminalDisposition,
  TurnConvergencePolicyInput,
} from "@kilnai/core/agents";
import type { BoundHostToolSandboxAdmission } from "@kilnai/core/sandbox";
import type { ManagedAttendedTrustedExecutionContext } from "../agents/managed-invocation/attended-trusted-execution.js";
import type { ManagedExternalInvocationActionClaimContext } from "../agents/managed-invocation/external-invocation-action-claim.js";
import type { ManagedAgentRuntimeAdapter } from "../agents/managed-invocation/index.js";
import type { AttendedTrustedExecutionLeaseSessionAuthority } from "../execution-kernel/attended-trusted-execution-lease-session-authority.js";
import type { RuntimeMediaActionClaimContext } from "../execution-kernel/runtime-media-action-claim.js";
import type {
  RuntimeModelRoundActionClaimStore,
  RuntimeModelRoundAdmissionReceipt,
  RuntimeModelRoundDigest,
  RuntimeModelRoundDispatchState,
} from "../execution-kernel/runtime-model-round-action-claim.js";
import type { RuntimeToolActionClaimsContext } from "../execution-kernel/runtime-tool-action-claim.js";
import type { RuntimeFormalVerificationObservation } from "../work-governance/formal-verification-observations.js";
import type { EffectiveAuthorityAdmissionBundle } from "./effective-authority-admission-bundle.js";
import type { RuntimeConfigurationRevisionSnapshot } from "./runtime-configuration-revision-pin.js";
import type { RuntimeSession } from "./runtime-session.js";
import type { RuntimeHostToolEnforcement } from "./runtime-host-tool-enforcement.js";
import type { RuntimeSessionTurnBudgetAuthority } from "./session-turn-budget-authority.js";
import type { EscalationDetector, EscalationSignal } from "./support/escalation/escalation-detector.js";
import type { RuntimeCapabilityGeneration } from "../capabilities/runtime-capability-composition.js";
import type { PortableInvocationSettlement } from "../capabilities/portable-execution.js";

export type {
  EffectiveTurnAuthorityCompleteness,
  EffectiveTurnAuthorityLevel,
  EffectiveTurnAuthorityPolicyInput,
  EffectiveTurnAuthorityPolicyInputSource,
  EffectiveTurnAuthorityPolicyInputStatus,
  EffectiveTurnAuthoritySandboxProjection,
  EffectiveTurnAuthoritySnapshot,
  EffectiveTurnAuthoritySourcePolicy,
} from "@kilnai/core";

export interface RuntimeExecutionEnvelope {
  readonly convergence?: TurnConvergencePolicyInput;
  readonly conversation?: RuntimeConversationExecutionEnvelope;
}

export interface RuntimeConversationExecutionEnvelope {
  readonly toolResults?: ConversationToolResultProjectionPolicy;
}

export interface RuntimeBuiltinToolExecutionContext {
  readonly session: RuntimeSession;
  readonly turnId?: string;
  readonly toolCall: ToolCall;
  /** Runtime-owned correlation scope for portable invocation settlement. */
  readonly toolCallScopeId?: string;
  /** Runtime-owned scope; tool input cannot override or remove this attribution. */
  readonly executionScope?: SessionExecutionScope;
  /** Formal-verification facts for this exact work-item execution scope only. */
  readonly formalVerificationObservations?: readonly RuntimeFormalVerificationObservation[];
  readonly abortSignal?: AbortSignal;
  readonly emitOutput?: (output: { readonly stream: "stdout" | "stderr"; readonly delta: string }) => void;
  readonly sandbox?: unknown;
  readonly allowedToolNames?: readonly string[];
  readonly authority?: AuthorityDescriptor;
  /** Exact invocation effect resolved and admitted by the Runtime owner. */
  readonly resolvedEffect?: ResolvedInvocationEffect;
  /** Process-local attended authority evidence; never persisted or cloned. */
  readonly attendedTrustedExecution?: ManagedAttendedTrustedExecutionContext;
  /** Process-local attended session owner; forwarded without consumption. */
  readonly attendedTrustedExecutionSessionAuthority?: AttendedTrustedExecutionLeaseSessionAuthority;
  readonly effectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot;
  /** Runtime-owned A1 adoption authority; never derived from tool input. */
  readonly operatorAdoptionDecision?: OperatorAdoptionDecisionAuthority;
  readonly requestApproval?: (description: string) => Promise<{ approved: boolean; reason?: string }>;
}

export type RuntimeBuiltinToolExecutor = (
  input: Record<string, unknown>,
  context?: RuntimeBuiltinToolExecutionContext,
) => Promise<unknown>;

export interface OrchestratorDeps {
  readonly provider: ProviderAdapter;
  readonly model?: string;
  readonly maxTokens?: number;
  /** Monotonic clock injected for deterministic turn-convergence accounting. */
  readonly monotonicNow?: () => number;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
  readonly tools?: readonly ToolDefinition[];
  readonly materializableTools?: ReadonlyMap<string, ToolDefinition>;
  /** Runtime-owned immutable capability generation for deferred selection. */
  readonly capabilityGeneration?: RuntimeCapabilityGeneration;
  readonly mcpClients?: readonly KilnMcpClient[];
  readonly builtinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly eventBus?: EventBus;
  readonly escalationDetector?: EscalationDetector;
  readonly capabilityMap?: ReadonlyMap<string, Capability>;
  readonly toolAuthorizer?: ToolAuthorizer;
  readonly toolResultSanitizer?: ToolResultSanitizer;
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  readonly auditLog?: AuditLog;
  readonly toolCache?: ToolCache;
  readonly modelRouter?: ModelRouter;
  readonly modelCapabilityRegistry?: ModelCapabilityRegistry;
  readonly providerPool?: ReadonlyMap<string, ProviderAdapter>;
  readonly multimodalDelegationRoutes?: readonly RuntimeMultimodalDelegationRoute[];
  /** Workload-owned claim context for external CLI/remote multimodal adapters. */
  readonly externalActionClaim?: ManagedExternalInvocationActionClaimContext;
  /** Full persisted parent admission bound to the external multimodal claim. */
  readonly externalAuthorityAdmission?: EffectiveAuthorityAdmissionBundle;
  readonly multimodalTransformRoutes?: readonly RuntimeMultimodalTransformRoute[];
  readonly dangerousCommandDetector?: DangerousCommandDetectorLike;
}

export interface RuntimeMultimodalDelegationRoute {
  readonly route: AuxiliaryModalityRoute;
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly observedRuntimeAuthority?: ManagedAgentObservedRuntimeAuthorityEvidence;
  readonly authority: ManagedAgentAuthorityProfile;
  readonly contextMode?: ManagedAgentInvocationContextMode;
  readonly agentProfile?: string;
  readonly skills?: readonly string[];
}

export type RuntimeMultimodalTransformKind = Extract<
  MultimodalTransformCandidate["transform"],
  "ocr" | "document-extraction" | "downsample"
>;

export type RuntimeMultimodalTransformSourcePart = Extract<ContentPart, { readonly type: "image" | "file" }>;

export interface RuntimeMultimodalTransformExecutionInput {
  readonly requestedCapability: MultimodalCapability;
  readonly sourceArtifacts: readonly MultimodalArtifact[];
  readonly sourceParts: readonly RuntimeMultimodalTransformSourcePart[];
  readonly userParts: readonly ContentPart[];
  /** Present for trusted consequential routes such as the local OCR command. */
  readonly mediaActionClaims?: RuntimeMediaActionClaimContext;
  readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
  readonly attemptId?: string;
  readonly callerId?: string;
  readonly idempotencyKey?: string;
  readonly logicalSendSlotPrefix?: string;
  readonly abortSignal?: AbortSignal;
}

export interface RuntimeMultimodalTransformExecutionResult {
  readonly parts: readonly ContentPart[];
  readonly summary: string;
  readonly outputArtifactUris?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface RuntimeMultimodalTransformRoute {
  readonly transform: RuntimeMultimodalTransformKind;
  readonly sourceModalities: readonly MultimodalTransportModality[];
  readonly outputModality: MultimodalTransportModality;
  readonly provenance: string;
  readonly degradation: string;
  /** Closed implementation identity; callers cannot inject an opaque runner. */
  readonly implementation: "runtime-built-in";
  readonly artifactStore?: ArtifactResourceStore;
  readonly artifactNamespace?: string;
  readonly ocrLanguage?: string;
  readonly maxImageEdge?: number;
  readonly jpegQuality?: number;
}

export interface ToolExecutionSummary {
  readonly toolCallScopeId?: string;
  readonly toolCallId?: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly capabilitySettlement?: PortableInvocationSettlement;
  readonly resolvedEffect?: ResolvedInvocationEffect;
  readonly authority?: AuthorityDescriptor;
  readonly durationMs: number;
  readonly success: boolean;
  readonly output?: string;
  readonly resultSummary: string;
  readonly executionScope?: SessionExecutionScope;
  readonly fileChanges?: readonly {
    readonly path: string;
    readonly changeType: "created" | "modified" | "deleted";
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly diffPreview?: string;
    readonly diffTruncated?: boolean;
  }[];
}

type OrchestrateResultCommon = {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly providerRequests?: readonly ProviderRequestEvidence[];
  readonly queued: boolean;
  readonly escalation?: EscalationSignal;
  readonly contextSummary?: string;
  readonly toolExecutions?: readonly ToolExecutionSummary[];
  readonly routingDecision?: {
    readonly provider: string;
    readonly model: string;
    readonly canonicalModel?: string;
    readonly billingMode?: ExecutionBillingMode;
    readonly routingTier: string;
    readonly reasoning: string;
    readonly selectionMode?: "automatic" | "explicit-operator-only";
    readonly deliberationResolution?: DeliberationResolution;
    readonly rationale?: ModelRoutingRationale;
  };
  readonly communicationResolution?: CommunicationResolution;
};

/** Every Runtime result carries one Core-owned terminal disposition. */
export type OrchestrateResult = OrchestrateResultCommon & RuntimeTurnTerminalDisposition;

export interface GovernedRuntimeContext {
  readonly directives?: readonly import("@kilnai/core").ProjectedContextBlock[];
  readonly guidance?: readonly import("@kilnai/core").ProjectedContextBlock[];
  readonly evidence?: readonly import("@kilnai/core").ProjectedContextBlock[];
  readonly audit?: ContextAuditEntry;
}

export type EffectiveTurnAuthorityPolicyMaximum = "read_only" | "audited" | "destructive";

export interface EffectiveTurnAuthorityPolicyBound {
  readonly maximumAuthority: EffectiveTurnAuthorityPolicyMaximum;
  readonly reason: string;
  readonly subjectId?: string;
}

export interface GoalAuthorityEnvelopePolicyBound extends EffectiveTurnAuthorityPolicyBound {
  readonly goalRunId: string;
}

export interface WorkItemAuthorityPolicyBound extends EffectiveTurnAuthorityPolicyBound {
  readonly workItemId: string;
}

export interface EffectiveTurnAuthorityAdmissionContext {
  readonly executionUse?: "operator_interactive" | "managed_unattended";
  readonly sessionPolicy?: EffectiveTurnAuthorityPolicyBound;
  readonly tenantPolicy?: EffectiveTurnAuthorityPolicyBound;
  readonly routePolicy?: EffectiveTurnAuthorityPolicyBound;
  readonly parentAuthority?: EffectiveTurnAuthoritySnapshot;
  readonly goalEnvelope?: GoalAuthorityEnvelopePolicyBound;
  readonly workItemAuthority?: WorkItemAuthorityPolicyBound;
}

export interface ModelRoutingRouteCapabilities {
  readonly deliberation?: ModelDeliberationCapabilities;
  readonly communication?: ModelCommunicationCapabilities;
}

export interface ModelRoutingPolicyConfig {
  readonly task?: string;
  readonly phase?: "orient" | "plan" | "execute" | "verify" | "handoff";
  readonly uncertainty?: number;
  readonly verificationNeed?: number;
  readonly retryRisk?: number;
  readonly cacheInvalidationCostUsd?: number;
  readonly verifierCostUsd?: number;
  readonly rankingEvidence?: readonly ModelRoutingRankingEvidence[];
  readonly routeCapabilities?: ReadonlyMap<string, ModelRoutingRouteCapabilities>;
  readonly now?: Date;
}

/**
 * Canonical direct-provider model-round context. Each workload owns the
 * durable store and admission readback; Runtime owns sequencing only.
 */
export interface RuntimeModelRoundDispatchContext {
  readonly admission: RuntimeModelRoundAdmissionReceipt;
  readonly intentFingerprint: RuntimeModelRoundDigest;
  readonly attemptId: string;
  readonly routeId: string;
  readonly accountId: string;
  readonly credentialRevision: string;
  /** Persisted parent-turn identity when this context executes in a child session. */
  readonly admissionReadbackSessionId?: string;
  readonly admissionReadbackTurnId?: string;
  readonly readAdmission: () => RuntimeModelRoundAdmissionReceipt | Promise<RuntimeModelRoundAdmissionReceipt>;
  readonly store: RuntimeModelRoundActionClaimStore;
  readonly state?: RuntimeModelRoundDispatchState;
}

export interface PerCallToolConfig {
  /** Sole Runtime execution-authority source. Omitted only by non-dispatching construction seams. */
  readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
  /** Correlation-only ingress identity; never used for authority or replay. */
  readonly turnCorrelationId?: string;
  /** Per-turn temporal reference, derived at the operator surface rather than persisted in the session prompt. */
  readonly temporalContext?: TurnTemporalContext;
  readonly executionScope?: SessionExecutionScope;
  /** Credential material resolved after the dispatch fence. */
  readonly executionCredential?: unknown;
  /** Process-local attended authority evidence; never persisted or cloned. */
  readonly attendedTrustedExecution?: ManagedAttendedTrustedExecutionContext;
  /** Process-local attended session owner; forwarded without consumption. */
  readonly attendedTrustedExecutionSessionAuthority?: AttendedTrustedExecutionLeaseSessionAuthority;
  readonly workingDirectory?: string;
  /** Sandbox policy and validators applied to builtin tool execution for this call. */
  readonly sandbox?: unknown;
  /** Persistable projection of the exact bound host sandbox supplied for this call. */
  readonly hostToolSandboxAdmission?: BoundHostToolSandboxAdmission;
  /** Process-local capability tying the persisted bundle to the sandbox and invocation policy. */
  readonly runtimeHostToolEnforcement?: RuntimeHostToolEnforcement;
  readonly governedWorkRequirement?: {
    readonly kind: "goal_materialization";
    readonly requiredWorkItemCount: number;
  };
  readonly toolAllowlist?: ReadonlySet<string>;
  readonly rateLimiter?: RateLimiter;
  readonly abortSignal?: AbortSignal;
  readonly providerTransport?: RuntimeProviderTransportConfig;
  readonly tenantId?: string;
  readonly additionalTools?: readonly ToolDefinition[];
  readonly initialToolChoice?: ToolChoiceOption;
  readonly perCallCapabilities?: ReadonlyMap<string, Capability>;
  readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  /** Input-sensitive configured policy evaluated by Runtime before any action claim. */
  readonly toolInvocationAdmission?: InvocationAdmission;
  readonly toolCallMetadata?: ReadonlyMap<string, RuntimeToolCallMetadataResolver>;
  readonly modelOverride?: {
    readonly provider: string;
    readonly model: string;
    readonly canonicalModel?: string;
    readonly billingMode?: ExecutionBillingMode;
    readonly source?: "operator";
  };
  readonly deliberationIntent?: DeliberationIntent;
  readonly deliberationSource?: Exclude<DeliberationSource, "provider-default">;
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationIntent?: ResolvedCommunicationIntent;
  readonly communicationResolution?: CommunicationResolution;
  readonly modelRoutingPolicy?: ModelRoutingPolicyConfig;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
  readonly contextPolicy?: {
    readonly policyId: string;
    readonly configurationHash: string;
    readonly contextAllocationMode: "whole-block" | "segmented" | "retrieval-on-demand";
  };
  /**
   * Workload-owned one-claim boundary for each direct-provider model round.
   * Account capacity remains a separate resource commitment.
   */
  readonly runtimeModelRoundDispatch?: RuntimeModelRoundDispatchContext;
  /**
   * Workload-owned one-claim boundary for each consequential tool/MCP effect.
   * Observe calls with a trusted resolved envelope may execute without it.
   */
  readonly runtimeToolActionClaims?: RuntimeToolActionClaimsContext;
  /** Workload-owned owner for consequential STT/TTS/multimodal effects. */
  readonly runtimeMediaActionClaims?: RuntimeMediaActionClaimContext;
  /** Full persisted bundle and stable identities for a consequential transform. */
  readonly runtimeMediaActionAdmission?: EffectiveAuthorityAdmissionBundle;
  readonly runtimeMediaActionAttemptId?: string;
  readonly runtimeMediaActionCallerId?: string;
  readonly runtimeMediaActionIdempotencyKey?: string;
}

/**
 * Mutable pre-admission candidates. These values exist only while the Runtime
 * owner computes and persists an EffectiveAuthorityAdmissionBundle; they are
 * never accepted by consequential execution APIs.
 */
export interface RuntimeAuthorityAdmissionCandidateConfig extends Omit<PerCallToolConfig, "authorityAdmission"> {
  readonly turnId?: string;
  readonly operatorAdoptionDecision?: OperatorAdoptionDecisionAuthority;
  readonly executionBinding?: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
  readonly admittedExecutionTarget?: AdmittedExecutionTarget;
  readonly effectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot;
  readonly authorityContext?: EffectiveTurnAuthorityAdmissionContext;
  readonly runtimeConfigurationRevision?: RuntimeConfigurationRevisionSnapshot;
  readonly runtimeSessionConfigurationRevision?: RuntimeConfigurationRevisionSnapshot;
}

export interface RuntimeProviderTransportConfig {
  readonly projectId?: string;
  readonly requestIdPrefix?: string;
  readonly watchdog?: ProviderTransportWatchdog;
  readonly observer?: ProviderTransportObserver;
}

export type RuntimeToolCallMetadataResolver = (input: Record<string, unknown>) => Record<string, unknown> | undefined;

export type CommandShell = "bash" | "sh" | "zsh" | "powershell" | "cmd" | "any";
export type DangerousCommandAction = "allow" | "ask" | "deny";

export interface DangerousCommandRequestLike {
  readonly command: string;
  readonly shell?: CommandShell;
}

export interface DangerousCommandDecisionLike {
  readonly action: DangerousCommandAction;
  readonly reasonCode: string;
  readonly reason: string;
}

export interface DangerousCommandDetectorLike {
  evaluate(request: DangerousCommandRequestLike): DangerousCommandDecisionLike;
}

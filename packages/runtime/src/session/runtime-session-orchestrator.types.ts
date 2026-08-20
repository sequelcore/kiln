import type {
  ExecutionBillingMode,
  AuxiliaryModalityRoute,
  MultimodalArtifact,
  MultimodalCapability,
  MultimodalTransportModality,
  MultimodalTransformCandidate,
  ModelRoutingRationale,
  ModelRoutingRankingEvidence,
  ProviderAdapter,
  ContentPart,
  ToolDefinition,
  ToolChoiceOption,
  DeliberationIntent,
  DeliberationResolution,
  DeliberationSource,
  ModelDeliberationCapabilities,
  ToolCall,
  ManagedAgentAdmissionProfile,
  ManagedAgentAuthorityProfile,
  ManagedAgentInvocationContextMode,
  ManagedAgentObservedRuntimeAuthorityEvidence,
  ManagedAgentProviderRoute,
  ManagedAgentRequestedAuthority,
  SessionExecutionScope,
  SessionTurnOutcome,
  ConversationToolResultProjectionPolicy,
  TurnTemporalContext,
  ProviderTransportObserver,
  ProviderTransportWatchdog,
  ExecutionSessionBindingEvidence,
  CommunicationResolution,
  ResolvedCommunicationIntent,
  ModelCommunicationCapabilities,
} from "@kilnai/core";
import type { ProviderRequestEvidence } from "@kilnai/core";
import type { KilnMcpClient } from "@kilnai/core";
import type { EventBus } from "@kilnai/core";
import type { ContextAuditEntry } from "@kilnai/core";
import type {
  Capability,
  ToolAuthorizer,
  AuthorityDescriptor,
  ResolvedInvocationEffect,
} from "@kilnai/core";
import type { AuditLog } from "@kilnai/core";
import type { ToolResultSanitizer } from "@kilnai/core";
import type { ToolRAG } from "@kilnai/core";
import type { RateLimiter } from "@kilnai/core";
import type { ToolCache } from "@kilnai/core";
import type { ModelRouter } from "@kilnai/core";
import type { ModelCapabilityRegistry } from "@kilnai/core";
import type { ManagedAgentRuntimeAdapter } from "../agents/managed-invocation/index.js";
import type { RuntimeSessionTurnBudgetAuthority } from "./session-turn-budget-authority.js";
import type { EscalationDetector, EscalationSignal } from "./support/escalation/escalation-detector.js";
import type { ContextSummarizer } from "./support/summarization/context-summarizer.js";
import type { RuntimeSession } from "./runtime-session.js";
import type { RuntimeFormalVerificationObservation } from "../work-governance/formal-verification-observations.js";

export const RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON = "tool_round_budget_exhausted";
export const RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON = "no_tool_finalization_failed";
export const RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON =
  "managed_invocation_state_transition_required";
export const RUNTIME_SESSION_GOVERNED_WORK_MATERIALIZATION_REQUIRED_STOP_REASON =
  "governed_work_materialization_required";

export interface RuntimeExecutionEnvelope {
  readonly toolRounds?: RuntimeToolRoundBudget;
  readonly conversation?: RuntimeConversationExecutionEnvelope;
}

export interface RuntimeConversationExecutionEnvelope {
  readonly toolResults?: ConversationToolResultProjectionPolicy;
}

export interface RuntimeToolRoundBudget {
  readonly max: number;
}

export interface RuntimeBuiltinToolExecutionContext {
  readonly session: RuntimeSession;
  readonly turnId?: string;
  readonly toolCall: ToolCall;
  /** Runtime-owned scope; tool input cannot override or remove this attribution. */
  readonly executionScope?: SessionExecutionScope;
  /** Formal-verification facts for this exact work-item execution scope only. */
  readonly formalVerificationObservations?: readonly RuntimeFormalVerificationObservation[];
  readonly abortSignal?: AbortSignal;
  readonly emitOutput?: (output: {
    readonly stream: "stdout" | "stderr";
    readonly delta: string;
  }) => void;
  readonly sandbox?: unknown;
  readonly allowedToolNames?: readonly string[];
  readonly authority?: AuthorityDescriptor;
  readonly effectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot;
  readonly requestApproval?: (
    description: string,
  ) => Promise<{ approved: boolean; reason?: string }>;
}

export type RuntimeBuiltinToolExecutor = (
  input: Record<string, unknown>,
  context?: RuntimeBuiltinToolExecutionContext,
) => Promise<unknown>;

export interface OrchestratorDeps {
  readonly provider: ProviderAdapter;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
  readonly tools?: readonly ToolDefinition[];
  readonly materializableTools?: ReadonlyMap<string, ToolDefinition>;
  readonly mcpClients?: readonly KilnMcpClient[];
  readonly builtinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly eventBus?: EventBus;
  readonly escalationDetector?: EscalationDetector;
  readonly contextSummarizer?: ContextSummarizer;
  readonly capabilityMap?: ReadonlyMap<string, Capability>;
  readonly toolAuthorizer?: ToolAuthorizer;
  readonly toolResultSanitizer?: ToolResultSanitizer;
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  readonly auditLog?: AuditLog;
  readonly toolRAG?: ToolRAG;
  readonly toolCache?: ToolCache;
  readonly modelRouter?: ModelRouter;
  readonly modelCapabilityRegistry?: ModelCapabilityRegistry;
  readonly providerPool?: ReadonlyMap<string, ProviderAdapter>;
  readonly multimodalDelegationRoutes?: readonly RuntimeMultimodalDelegationRoute[];
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
  readonly execute: (
    input: RuntimeMultimodalTransformExecutionInput,
  ) => Promise<RuntimeMultimodalTransformExecutionResult>;
}

export interface ToolExecutionSummary {
  readonly toolCallId?: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
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

export interface OrchestrateResult {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly providerRequests?: readonly ProviderRequestEvidence[];
  readonly queued: boolean;
  readonly outcome: SessionTurnOutcome;
  readonly escalation?: EscalationSignal;
  readonly contextSummary?: string;
  readonly stopReason?: string;
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
}

export interface GovernedRuntimeContext {
  readonly directives?: readonly import("@kilnai/core").ProjectedContextBlock[];
  readonly guidance?: readonly import("@kilnai/core").ProjectedContextBlock[];
  readonly evidence?: readonly import("@kilnai/core").ProjectedContextBlock[];
  readonly audit?: ContextAuditEntry;
}

export type EffectiveTurnAuthorityLevel =
  | "fail_closed"
  | "read_only"
  | "idempotent"
  | "audited"
  | "destructive"
  | "unknown";

export type EffectiveTurnAuthorityCompleteness = "authoritative" | "partial";

export type EffectiveTurnAuthoritySourcePolicy =
  | "provider_profile_gate"
  | "runtime_surface_projection"
  | "plan_mode_projection";

export type EffectiveTurnAuthoritySandboxProjection =
  | "none"
  | "read_only"
  | "workspace_write"
  | "unknown";

export type EffectiveTurnAuthorityPolicyInputSource =
  | "requested_authority"
  | "session_policy"
  | "tenant_policy"
  | "route_policy"
  | "parent_authority"
  | "plan_approval"
  | "goal_envelope"
  | "work_item_authority";

export type EffectiveTurnAuthorityPolicyInputStatus =
  | "applied"
  | "not_applicable"
  | "unresolved";

export interface EffectiveTurnAuthorityPolicyInput {
  readonly source: EffectiveTurnAuthorityPolicyInputSource;
  readonly status: EffectiveTurnAuthorityPolicyInputStatus;
  readonly reason: string;
  readonly subjectId?: string;
  readonly requestedAuthority?: "planning" | "auto" | "read_only" | "audited" | "destructive";
  readonly admittedAuthority?: EffectiveTurnAuthorityLevel;
}

export interface EffectiveTurnAuthoritySnapshot {
  readonly executionMode: "execute" | "plan";
  readonly requestedAuthority: "planning" | "auto" | "read_only" | "audited" | "destructive";
  readonly admittedAuthority: EffectiveTurnAuthorityLevel;
  readonly sourcePolicy: EffectiveTurnAuthoritySourcePolicy;
  readonly reason: string;
  readonly completeness: EffectiveTurnAuthorityCompleteness;
  readonly toolCount: number;
  readonly deniedToolCount: number;
  readonly sandboxProjection?: EffectiveTurnAuthoritySandboxProjection;
  readonly policyInputs?: readonly EffectiveTurnAuthorityPolicyInput[];
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

export interface PerCallToolConfig {
  readonly turnId?: string;
  /** Per-turn temporal reference, derived at the operator surface rather than persisted in the session prompt. */
  readonly temporalContext?: TurnTemporalContext;
  readonly executionScope?: SessionExecutionScope;
  /** Exact account/credential identity fenced for this operator turn. */
  readonly executionBinding?: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
  /** Credential material resolved after the dispatch fence. */
  readonly executionCredential?: unknown;
  readonly workingDirectory?: string;
  /** Sandbox policy and validators applied to builtin tool execution for this call. */
  readonly sandbox?: unknown;
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
  readonly effectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot;
  readonly authorityContext?: EffectiveTurnAuthorityAdmissionContext;
  readonly modelRoutingPolicy?: ModelRoutingPolicyConfig;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
  readonly contextPolicy?: {
    readonly policyId: string;
    readonly configurationHash: string;
    readonly contextAllocationMode: "whole-block" | "segmented" | "retrieval-on-demand";
  };
}

export interface RuntimeProviderTransportConfig {
  readonly projectId?: string;
  readonly requestIdPrefix?: string;
  readonly watchdog?: ProviderTransportWatchdog;
  readonly observer?: ProviderTransportObserver;
}

export type RuntimeToolCallMetadataResolver = (
  input: Record<string, unknown>,
) => Record<string, unknown> | undefined;

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

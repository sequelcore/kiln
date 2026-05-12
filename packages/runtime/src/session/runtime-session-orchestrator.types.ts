import type {
  ExecutionBillingMode,
  ModelRoutingRationale,
  ModelRoutingRankingEvidence,
  ProviderAdapter,
  ContentPart,
  ToolDefinition,
  ReasoningEffort,
  ToolCall,
} from "@kilnai/core";
import type { McpClient } from "@kilnai/core";
import type { EventBus } from "@kilnai/core";
import type { ContextAuditEntry } from "@kilnai/core";
import type {
  Capability,
  ToolAuthorizer,
  AuthorityDescriptor,
} from "@kilnai/core";
import type { AuditLog } from "@kilnai/core";
import type { ToolResultSanitizer } from "@kilnai/core";
import type { ToolRAG } from "@kilnai/core";
import type { RateLimiter } from "@kilnai/core";
import type { ToolCache } from "@kilnai/core";
import type { ModelRouter } from "@kilnai/core";
import type { EscalationDetector, EscalationSignal } from "./support/escalation/escalation-detector.js";
import type { ContextSummarizer } from "./support/summarization/context-summarizer.js";
import type { RuntimeSession } from "./runtime-session.js";

export interface RuntimeBuiltinToolExecutionContext {
  readonly session: RuntimeSession;
  readonly toolCall: ToolCall;
  readonly sandbox?: unknown;
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
  readonly maxToolRounds?: number;
  readonly tools?: readonly ToolDefinition[];
  readonly mcpClients?: readonly McpClient[];
  readonly builtinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly eventBus?: EventBus;
  readonly escalationDetector?: EscalationDetector;
  readonly contextSummarizer?: ContextSummarizer;
  readonly capabilityMap?: ReadonlyMap<string, Capability>;
  readonly toolAuthorizer?: ToolAuthorizer;
  readonly toolResultSanitizer?: ToolResultSanitizer;
  readonly budgetChecker?: () => Promise<{ allowed: boolean; message?: string }>;
  readonly auditLog?: AuditLog;
  readonly toolRAG?: ToolRAG;
  readonly toolCache?: ToolCache;
  readonly modelRouter?: ModelRouter;
  readonly providerPool?: ReadonlyMap<string, ProviderAdapter>;
  readonly dangerousCommandDetector?: DangerousCommandDetectorLike;
}

export interface ToolExecutionSummary {
  readonly toolCallId?: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly durationMs: number;
  readonly success: boolean;
  readonly output?: string;
  readonly resultSummary: string;
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
    readonly selectionMode?: "auto" | "manual_override";
    readonly reasoningEffort?: ReasoningEffort;
    readonly rationale?: ModelRoutingRationale;
  };
}

export interface GovernedRuntimeContext {
  readonly content?: string;
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
  readonly sessionPolicy?: EffectiveTurnAuthorityPolicyBound;
  readonly tenantPolicy?: EffectiveTurnAuthorityPolicyBound;
  readonly routePolicy?: EffectiveTurnAuthorityPolicyBound;
  readonly parentAuthority?: EffectiveTurnAuthoritySnapshot;
  readonly goalEnvelope?: GoalAuthorityEnvelopePolicyBound;
  readonly workItemAuthority?: WorkItemAuthorityPolicyBound;
}

export interface ModelRoutingRouteCapabilities {
  readonly supportedReasoningEfforts?: readonly ReasoningEffort[];
}

export interface ModelRoutingPolicyConfig {
  readonly task?: string;
  readonly rankingEvidence?: readonly ModelRoutingRankingEvidence[];
  readonly routeCapabilities?: ReadonlyMap<string, ModelRoutingRouteCapabilities>;
  readonly now?: Date;
}

export interface PerCallToolConfig {
  readonly toolAllowlist?: ReadonlySet<string>;
  readonly rateLimiter?: RateLimiter;
  readonly tenantId?: string;
  readonly additionalTools?: readonly ToolDefinition[];
  readonly perCallCapabilities?: ReadonlyMap<string, Capability>;
  readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  readonly toolCallMetadata?: ReadonlyMap<string, RuntimeToolCallMetadataResolver>;
  readonly modelOverride?: {
    readonly provider: string;
    readonly model: string;
    readonly canonicalModel?: string;
    readonly billingMode?: ExecutionBillingMode;
    readonly source?: string;
  };
  readonly reasoningEffort?: ReasoningEffort;
  readonly effectiveTurnAuthority?: EffectiveTurnAuthoritySnapshot;
  readonly authorityContext?: EffectiveTurnAuthorityAdmissionContext;
  readonly modelRoutingPolicy?: ModelRoutingPolicyConfig;
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

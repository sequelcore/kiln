import type { ExecutionBillingMode, ProviderAdapter, ContentPart, ToolDefinition, ReasoningEffort } from "@kilnai/core";
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

export interface OrchestratorDeps {
  readonly provider: ProviderAdapter;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly maxToolRounds?: number;
  readonly tools?: readonly ToolDefinition[];
  readonly mcpClients?: readonly McpClient[];
  readonly builtinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
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
  };
}

export interface GovernedRuntimeContext {
  readonly content?: string;
  readonly audit?: ContextAuditEntry;
}

export interface PerCallToolConfig {
  readonly toolAllowlist?: ReadonlySet<string>;
  readonly rateLimiter?: RateLimiter;
  readonly tenantId?: string;
  readonly additionalTools?: readonly ToolDefinition[];
  readonly perCallCapabilities?: ReadonlyMap<string, Capability>;
  readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  readonly modelOverride?: {
    readonly provider: string;
    readonly model: string;
    readonly canonicalModel?: string;
    readonly billingMode?: ExecutionBillingMode;
  };
  readonly reasoningEffort?: ReasoningEffort;
}

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

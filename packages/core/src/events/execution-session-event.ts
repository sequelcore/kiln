import type { ExecutionBillingMode } from "../agents/execution-identity.js";
import type { AgentMessage, ReasoningEffort } from "../agents/index.js";
import type { ExecutionCostEvidence } from "../cost/index.js";
import type { SessionToolUsageSnapshot } from "./session-event.js";
import type { ContextUsageRawEvidence } from "./context-usage-projection.js";
import type { SessionExecutionScope } from "./session-execution-scope.js";

export type ExecutionSessionCostTrackingMode =
  | "native"
  | "computed"
  | "none";

export interface ExecutionSessionRunOptions {
  readonly kilnSessionId?: string;
  readonly turnId?: string;
  readonly prompt: string;
  readonly system?: string;
  readonly messages?: readonly AgentMessage[];
  readonly cwd?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly env?: Readonly<Record<string, string>>;
  readonly abortSignal?: AbortSignal;
  readonly executionScope?: SessionExecutionScope;
}

export interface ExecutionSessionToolResultResourceLink {
  readonly uri: string;
  readonly title?: string;
  readonly label?: string;
  readonly sequence?: number;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation?: string;
}

export interface ProviderRequestEvidence {
  readonly requestIndex: number;
  /** Route that produced this request, including retries and fallbacks. */
  readonly providerId: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly cumulativeInputTokens: number;
  readonly cumulativeOutputTokens: number;
  readonly cumulativeCacheReadTokens: number;
  readonly cumulativeCacheWriteTokens: number;
  readonly systemBytes: number;
  readonly messageBytes: number;
  readonly toolSchemaBytes: number;
  readonly systemHash: string;
  readonly messageHash: string;
  readonly toolSchemaHash: string;
  readonly stablePrefixHash: string;
  readonly stablePrefixBytes: number;
  readonly stablePrefixRegionCount: number;
  readonly volatileRegionBytes: number;
  readonly cacheRegions: readonly ProviderRequestCacheRegionEvidence[];
  readonly cachePartition: ProviderRequestCachePartitionEvidence;
  readonly toolCount: number;
  readonly toolProjection?: ProviderRequestToolProjectionEvidence;
  readonly stopReason?: string;
  readonly contextUsage?: ContextUsageRawEvidence;
}

export interface ProviderRequestToolProjectionEvidence {
  readonly projected: ProviderRequestToolProjectionSetEvidence;
  readonly materializable: ProviderRequestToolProjectionSetEvidence;
  readonly materializedAdditions: readonly string[];
  readonly materializationDecisions: readonly ProviderRequestToolMaterializationDecisionEvidence[];
}

export interface ProviderRequestToolProjectionSetEvidence {
  readonly names: readonly string[];
  readonly count: number;
  readonly hash: string;
}

export type ProviderRequestToolMaterializationDecision =
  | "materialized"
  | "already_materialized"
  | "outside_authority"
  | "not_found"
  | "not_materializable";

export interface ProviderRequestToolMaterializationDecisionEvidence {
  readonly decision: ProviderRequestToolMaterializationDecision;
  readonly toolName: string;
  readonly sourceToolCallId?: string;
  readonly sourceToolName: string;
  readonly catalog: {
    readonly exact?: string;
    readonly resultCount?: number;
    readonly totalIndexed?: number;
    readonly includedSchemas?: boolean;
    readonly stale?: boolean;
  };
}

export type ProviderRequestCacheRegionSource =
  | "tool_schema"
  | "system"
  | "messages";

export interface ProviderRequestCacheRegionEvidence {
  readonly source: ProviderRequestCacheRegionSource;
  readonly stability: "stable" | "volatile";
  readonly bytes: number;
  readonly hash: string;
  readonly includedInStablePrefix: boolean;
}

export type ProviderRequestCachePartitionDimensionSource =
  | "tenant"
  | "route"
  | "policy"
  | "authority";

export interface ProviderRequestCachePartitionDimensionEvidence {
  readonly source: ProviderRequestCachePartitionDimensionSource;
  readonly hash: string;
  readonly evidenceBasis: string;
}

export interface ProviderRequestCachePartitionEvidence {
  readonly hash: string;
  readonly dimensions: readonly ProviderRequestCachePartitionDimensionEvidence[];
}

export type ExecutionSessionEvent = (
  | { readonly type: "text_delta"; readonly content: string; readonly isThinking?: boolean }
  | {
      readonly type: "tool_use";
      readonly toolName: string;
      readonly input: unknown;
      readonly toolCallId?: string;
      readonly source?: "native" | "mcp";
      readonly mcpSelector?: string;
    }
  | {
      readonly type: "tool_result";
      readonly toolName: string;
      readonly output: string;
      readonly outputSummary?: string;
      readonly toolCallId?: string;
      readonly isError?: boolean;
      readonly metadata?: Record<string, unknown>;
      readonly resourceLinks?: readonly ExecutionSessionToolResultResourceLink[];
      readonly toolUsage?: SessionToolUsageSnapshot;
    }
  | {
      readonly type: "file_changed";
      readonly path: string;
      readonly changeType: "created" | "modified" | "deleted";
      readonly linesAdded?: number;
      readonly linesRemoved?: number;
      readonly diffPreview?: string;
      readonly diffTruncated?: boolean;
      readonly resourceUris?: readonly string[];
    }
  | {
      readonly type: "write_decision";
      readonly status: "approved" | "denied";
      readonly providerRequestId?: string;
      readonly actor?: string;
      readonly reason: string;
      readonly resourceUris?: readonly string[];
    }
  | {
      readonly type: "cost_update";
      readonly usd: number;
      readonly mode?: ExecutionSessionCostTrackingMode;
      readonly provider?: string;
      readonly model?: string;
      readonly canonicalModel?: string;
      readonly billingMode?: ExecutionBillingMode;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly cacheReadTokens?: number;
      readonly cacheWriteTokens?: number;
      readonly providerRequests?: readonly ProviderRequestEvidence[];
      readonly costEvidence?: ExecutionCostEvidence;
    }
  | {
      readonly type: "completed";
      readonly totalUsd: number;
      readonly durationMs: number;
      readonly isError: boolean;
      readonly isPreflightCrash: boolean;
    }
  | { readonly type: "error"; readonly code: string; readonly message: string; readonly isRetryable: boolean }
) & { readonly executionScope?: SessionExecutionScope };

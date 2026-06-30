import type { ExecutionBillingMode } from "../agents/execution-identity.js";
import type { AgentMessage, ReasoningEffort } from "../agents/index.js";
import type { SessionToolUsageSnapshot } from "./session-event.js";

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

export type ExecutionSessionEvent =
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
    }
  | {
      readonly type: "completed";
      readonly totalUsd: number;
      readonly durationMs: number;
      readonly isError: boolean;
      readonly isPreflightCrash: boolean;
    }
  | { readonly type: "error"; readonly code: string; readonly message: string; readonly isRetryable: boolean };

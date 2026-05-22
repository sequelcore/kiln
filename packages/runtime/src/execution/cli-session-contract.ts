import type { AgentMessage, ExecutionBillingMode, ReasoningEffort } from "@kilnai/core";
import type { OperatorSurfaceController } from "../operator/operator-surface-controller.js";

/** Minimal session run options — structurally compatible with cli/wrapper/session IKilnSession. */
export interface CliSessionRunOptions {
  readonly kilnSessionId?: string;
  readonly prompt: string;
  readonly system?: string;
  readonly messages?: readonly AgentMessage[];
  readonly cwd?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly env?: Readonly<Record<string, string>>;
}

/** Minimal session event union — structurally compatible with cli/wrapper/session SessionEvent. */
export type CliSessionEvent =
  | { type: "text_delta"; content: string; isThinking?: boolean }
  | { type: "tool_use"; toolName: string; input: unknown; toolCallId?: string }
  | {
      type: "tool_result";
      toolName: string;
      output: string;
      outputSummary?: string;
      toolCallId?: string;
      isError?: boolean;
      metadata?: Record<string, unknown>;
      resourceLinks?: readonly { readonly uri: string; readonly title?: string; readonly mimeType?: string; readonly relation?: string }[];
    }
  | {
      type: "file_changed";
      path: string;
      changeType: "created" | "modified" | "deleted";
      linesAdded?: number;
      linesRemoved?: number;
      diffPreview?: string;
      diffTruncated?: boolean;
      resourceUris?: readonly string[];
    }
  | {
      type: "write_decision";
      status: "approved" | "denied";
      providerRequestId?: string;
      actor?: string;
      reason: string;
      resourceUris?: readonly string[];
    }
  | {
      type: "cost_update";
      usd: number;
      provider?: string;
      model?: string;
      canonicalModel?: string;
      billingMode?: ExecutionBillingMode;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
    }
  | { type: "completed"; totalUsd: number; durationMs: number; isError: boolean; isPreflightCrash: boolean }
  | { type: "error"; code: string; message: string; isRetryable: boolean };

/** Minimal session interface — structurally compatible with cli/wrapper/session IKilnSession. */
export interface CliSession {
  run(options: CliSessionRunOptions): AsyncIterable<CliSessionEvent>;
  dispose(): Promise<void>;
}

export interface CliSessionFactoryContext {
  readonly kilnSessionId?: string;
  readonly operatorSurface?: OperatorSurfaceController;
  readonly permissionPolicy?: {
    readonly approval: "never" | "on-request" | "on-failure" | "untrusted";
    readonly sandbox: "read-only" | "workspace-write" | "danger-full-access";
  };
}

/**
 * Factory injected by the CLI command. Creates a fresh one-shot CLI session per turn.
 * @param systemPrompt The assembled system prompt (memory + context already injected).
 * @param cwd Working directory for the subprocess.
 */
export type CliSessionFactory = (systemPrompt: string, cwd: string, context?: CliSessionFactoryContext) => CliSession;

/**
 * Event callback for streaming CLI subprocess events to the TUI.
 * The executor fires this for each event from the CLI session.
 */
export type CliSessionEventCallback = (event: CliSessionEvent) => void;

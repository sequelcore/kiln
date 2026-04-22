import type { AgentMessage, ExecutionBillingMode } from "@kilnai/core";

/** Minimal session run options — structurally compatible with cli/wrapper/session IKilnSession. */
export interface CliSessionRunOptions {
  readonly prompt: string;
  readonly system?: string;
  readonly messages?: readonly AgentMessage[];
  readonly cwd?: string;
}

/** Minimal session event union — structurally compatible with cli/wrapper/session SessionEvent. */
export type CliSessionEvent =
  | { type: "text_delta"; content: string; isThinking?: boolean }
  | { type: "tool_use"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; output: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number }
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

/**
 * Factory injected by the CLI command. Creates a fresh one-shot CLI session per turn.
 * @param systemPrompt The assembled system prompt (memory + context already injected).
 * @param cwd Working directory for the subprocess.
 */
export type CliSessionFactory = (systemPrompt: string, cwd: string) => CliSession;

/**
 * Event callback for streaming CLI subprocess events to the TUI.
 * The executor fires this for each event from the CLI session.
 */
export type CliSessionEventCallback = (event: CliSessionEvent) => void;

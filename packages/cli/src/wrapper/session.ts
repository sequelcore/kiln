/**
 * Canonical session abstraction layer for Kiln's multi-CLI orchestration engine.
 *
 * Defines the contract that all session implementations (ClaudeSession, CodexSession,
 * OpenCodeSession) must satisfy. This is the interface that the orchestrator
 * uses to interact with sessions without coupling to any specific CLI.
 *
 * Design constraints:
 * - Single-turn only. No multi-turn history parameter.
 * - Session continuation is out of scope until OpenCode and Codex capabilities are confirmed.
 * - Pure type definitions. No imports.
 */

export type CostTrackingMode =
  | "native"
  | "computed"
  | "none";

export type ApprovalMode = "auto-approve" | "ask" | "deny";
export type SandboxMode = "none" | "workspace-write" | "full";

export interface KilnPermissionPolicy {
  readonly approval: ApprovalMode;
  readonly sandbox: SandboxMode;
}

export type SessionEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_use"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; output: string }
  | {
      type: "cost_update";
      usd: number;
      mode: CostTrackingMode;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
    }
  | {
      type: "completed";
      totalUsd: number;
      durationMs: number;
      isError: boolean;
      isPreflightCrash: boolean;
    }
  | { type: "error"; code: string; message: string; isRetryable: boolean };

export interface SessionCapabilities {
  readonly mcp: boolean;
  readonly streaming: boolean;
  readonly resumable: boolean;
  readonly resume: boolean;
  readonly costTrackingMode: CostTrackingMode;
  readonly supportedTools: readonly string[];
  readonly maxContextTokens: number | null;
  readonly priority: number;
  readonly fallbackTo: string | null;
  readonly permissionPolicy: KilnPermissionPolicy;
}

export interface SessionRunOptions {
  readonly prompt: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly abortSignal?: AbortSignal;
}

export interface IKilnSession {
  run(options: SessionRunOptions): AsyncIterable<SessionEvent>;
  dispose(): Promise<void>;
  readonly capabilities: SessionCapabilities;
  readonly sessionId: string;
}

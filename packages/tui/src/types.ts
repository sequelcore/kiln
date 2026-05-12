/**
 * @fileoverview TUI type definitions for Kiln terminal interface.
 * @module @kilnai/tui
 */

import type {
  OperatorEventSurface,
  OperatorExecutionMode,
  OperatorTurnRequestedAuthority,
  ToolResultPresentation,
} from "@kilnai/gateway-contracts";

export type MessageRole = "user" | "assistant" | "tool" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;
}

export interface TuiConfig {
  provider?: string;
  cwd?: string;
}

export type SessionEvent =
  | { type: "text_delta"; content: string; isThinking?: boolean; sessionId?: string; turnId?: string }
  | { type: "tool_use"; toolName: string; input?: unknown; sessionId?: string; turnId?: string }
  | { type: "tool_result"; toolName: string; output: string; sessionId?: string; turnId?: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number; sessionId?: string; turnId?: string }
  | { type: "cost_update"; usd: number; sessionId?: string; turnId?: string }
  | { type: "completed"; totalUsd: number; routedProvider?: string; routedModel?: string }
  | { type: "error"; message: string }
  | { type: "thinking" }
  | { type: "activity"; activity: string; toolName?: string; output?: string; usd?: number; input?: unknown; details?: string; sessionId?: string; turnId?: string; approvalId?: string; surfaces?: readonly OperatorEventSurface[]; toolPresentation?: ToolResultPresentation };

/**
 * @internal
 * @description A single event from an active session turn.
 */
export type SessionEventInternal =
  | { type: "text_delta"; content: string; isThinking?: boolean; sessionId?: string; turnId?: string }
  | { type: "tool_use"; toolName: string; input?: unknown; sessionId?: string; turnId?: string }
  | { type: "tool_result"; toolName: string; output: string; sessionId?: string; turnId?: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number; sessionId?: string; turnId?: string }
  | { type: "cost_update"; usd: number; sessionId?: string; turnId?: string }
  | {
      type: "completed";
      totalUsd: number;
      inputTokens?: number;
      outputTokens?: number;
      routedProvider?: string;
      routedModel?: string;
      runtimeContinuity?: {
        strategy: string;
        feedbackLabel?: string;
        pressure?: string;
        supportArtifactCount?: number;
        supportArtifactSources?: string[];
        fallbackLabel?: string;
        usedCachedSupport?: boolean;
        selectionReason?: string;
      };
    }
  | { type: "error"; message: string }
  | { type: "thinking" }
  | { type: "activity"; activity: string; toolName?: string; output?: string; usd?: number; input?: unknown; inputTokens?: number; outputTokens?: number; details?: string; sessionId?: string; turnId?: string; approvalId?: string; surfaces?: readonly OperatorEventSurface[]; toolPresentation?: ToolResultPresentation; path?: string; changeType?: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number };

/**
 * @description The only session abstraction the TUI depends on.
 * Both GatewaySession (Phase 7c+) and any future session type must satisfy this interface.
 */
export interface SessionLike {
  run(opts: {
    prompt: string;
    cwd?: string;
    executionMode?: OperatorExecutionMode;
    requestedAuthority?: OperatorTurnRequestedAuthority;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  }): AsyncIterable<SessionEventInternal>;
  dispose(): Promise<void>;
}

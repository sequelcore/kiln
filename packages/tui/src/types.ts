/**
 * @fileoverview TUI type definitions for Kiln terminal interface.
 * @module @kilnai/tui
 */

import type {
  GuiDoneFrameFields,
  OperatorEventSurface,
  OperatorExecutionMode,
  OperatorSessionEvent,
  OperatorTurnTerminalDisposition,
  OperatorTurnRequestedAuthority,
  ToolResultResourceLinkPresentation,
  ToolResultPresentation,
} from "@kilnai/gateway-contracts";

export type MessageRole = "user" | "assistant" | "tool" | "error";

export interface TuiConfig {
  provider?: string;
  cwd?: string;
}

/**
 * Terminal event fields owned by the TUI session adapter.
 *
 * The terminal disposition is deliberately intersected at the call site below
 * so outcome/reason/evidence correlation remains the shared contract's union.
 */
type TuiCompletedEventFields = {
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
    supportArtifactSources?: readonly string[];
    fallbackLabel?: string;
    usedCachedSupport?: boolean;
    selectionReason?: string;
  };
};

export type TuiCompletedEvent = TuiCompletedEventFields & OperatorTurnTerminalDisposition;

export type TuiDoneFrame = GuiDoneFrameFields & OperatorTurnTerminalDisposition;

export type SessionEvent =
  | { type: "text_delta"; content: string; isThinking?: boolean; sessionId?: string; turnId?: string }
  | { type: "tool_use"; toolName: string; toolCallId?: string; input?: unknown; sessionId?: string; turnId?: string }
  | { type: "tool_output_delta"; toolName: string; toolCallId: string; stream: "stdout" | "stderr"; delta: string; chunkIndex: number; sessionId?: string; turnId?: string }
  | { type: "tool_result"; toolName: string; toolCallId?: string; output: string; sessionId?: string; turnId?: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number; sessionId?: string; turnId?: string }
  | { type: "cost_update"; usd: number; sessionId?: string; turnId?: string }
  | TuiCompletedEvent
  | { type: "error"; message: string }
  | { type: "thinking" }
  | { type: "activity"; activity: string; toolName?: string; toolCallId?: string; stream?: "stdout" | "stderr"; chunkIndex?: number; output?: string; usd?: number; input?: unknown; details?: string; metadata?: Record<string, unknown>; resourceLinks?: readonly ToolResultResourceLinkPresentation[]; toolUsage?: unknown; sessionId?: string; turnId?: string; approvalId?: string; surfaces?: readonly OperatorEventSurface[]; toolPresentation?: ToolResultPresentation; sessionEvent?: OperatorSessionEvent };

/**
 * @internal
 * @description A single event from an active session turn.
 */
export type SessionEventInternal =
  | { type: "text_delta"; content: string; isThinking?: boolean; sessionId?: string; turnId?: string }
  | { type: "tool_use"; toolName: string; toolCallId?: string; input?: unknown; sessionId?: string; turnId?: string }
  | { type: "tool_output_delta"; toolName: string; toolCallId: string; stream: "stdout" | "stderr"; delta: string; chunkIndex: number; sessionId?: string; turnId?: string }
  | { type: "tool_result"; toolName: string; toolCallId?: string; output: string; sessionId?: string; turnId?: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number; sessionId?: string; turnId?: string }
  | { type: "cost_update"; usd: number; sessionId?: string; turnId?: string }
  | TuiCompletedEvent
  | { type: "error"; message: string }
  | { type: "thinking" }
  | { type: "activity"; activity: string; toolName?: string; toolCallId?: string; stream?: "stdout" | "stderr"; chunkIndex?: number; output?: string; usd?: number; input?: unknown; inputTokens?: number; outputTokens?: number; details?: string; metadata?: Record<string, unknown>; resourceLinks?: readonly ToolResultResourceLinkPresentation[]; toolUsage?: unknown; sessionId?: string; turnId?: string; approvalId?: string; surfaces?: readonly OperatorEventSurface[]; toolPresentation?: ToolResultPresentation; sessionEvent?: OperatorSessionEvent; path?: string; changeType?: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number };

/**
 * @description The only session abstraction the TUI depends on.
 * Both GatewaySession (Phase 7c+) and any future session type must satisfy this interface.
 */
export interface SessionLike {
  run(opts: {
    prompt: string;
    cwd?: string;
    kilnSessionId?: string;
    executionMode?: OperatorExecutionMode;
    requestedAuthority?: OperatorTurnRequestedAuthority;
    deliberationIntent?: import("@kilnai/gateway-contracts").GuiDeliberationIntent;
    communicationIntent?: import("@kilnai/gateway-contracts").GuiCommunicationIntent;
  }): AsyncIterable<SessionEventInternal>;
  dispose(): Promise<void>;
}

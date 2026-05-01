import type { ContentPart } from "@kilnai/core";

export interface KilnConfig {
  readonly baseUrl: string;
  readonly appName?: string;
  readonly userId?: string;
  /** SSE reconnect delay in milliseconds (default: 3000) */
  readonly reconnectDelayMs?: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly parts?: readonly ContentPart[];
  readonly timestamp: number;
}

export interface ChatOptions {
  readonly appName?: string;
  readonly sessionId?: string;
}

/** Visitor identity for the identify frame */
export interface VisitorInfo {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly custom?: Readonly<Record<string, string>>;
}

export interface UseChatReturn {
  readonly messages: readonly ChatMessage[];
  send(content: string | ContentPart[]): Promise<void>;
  /** Send visitor identity to the gateway (WebSocket only, no-op for REST) */
  identify?(visitor: VisitorInfo): void;
  readonly isLoading: boolean;
  readonly error: Error | null;
  clearMessages(): void;
}

export interface UseEventsReturn {
  readonly events: readonly KilnEventData[];
  readonly connected: boolean;
  clear(): void;
}

export interface UseStateReturn {
  readonly state: Record<string, unknown>;
  readonly cost: Record<string, unknown>;
  readonly apps: readonly string[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
}

export interface KilnEventData {
  readonly type: string;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
}

/** WebSocket chat request frame (client -> server) */
export interface WsChatRequest {
  readonly type: "message";
  readonly content: string;
  readonly parts?: readonly ContentPart[];
}

/** WebSocket chat response frame (server -> client) */
export type WsChatFrame =
  | { readonly type: "chunk"; readonly content: string }
  | { readonly type: "done"; readonly content: string; readonly parts?: readonly ContentPart[]; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: "error"; readonly message: string };

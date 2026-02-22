import type { ContentPart } from "@kilnai/core";

export interface KilnConfig {
  readonly baseUrl: string;
  readonly appName?: string;
  readonly userId?: string;
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

export interface UseChatReturn {
  readonly messages: readonly ChatMessage[];
  send(content: string | ContentPart[]): Promise<void>;
  readonly isLoading: boolean;
  readonly error: Error | null;
  clearMessages(): void;
}

export interface UseEventsReturn {
  readonly events: readonly KilnEventData[];
  readonly connected: boolean;
  clear(): void;
}

export interface UseMemoryReturn {
  readonly entries: readonly MemoryEntry[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
  create(entry: CreateMemoryInput): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface UseStateReturn {
  readonly state: Record<string, unknown>;
  readonly cost: Record<string, unknown>;
  readonly apps: readonly string[];
  readonly isLoading: boolean;
  refresh(): Promise<void>;
}

export interface MemoryEntry {
  readonly id: string;
  readonly scope: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface CreateMemoryInput {
  readonly scope: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface KilnEventData {
  readonly type: string;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
}

/**
 * @fileoverview Reactive state management for TUI.
 * @module @kilnai/tui
 */

import type { MessageRole } from "./types.js";

/** Message structure for TUI chat history. */
export interface Message {
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName?: string;
  toolInput?: unknown;
}

/** Possible TUI status values. */
export type TuiStatus = "idle" | "running" | "error";

/**
 * Reactive state container holding all TUI application state.
 */
export interface ReactiveState {
  messages: Message[];
  input: string;
  status: TuiStatus;
  cost: number;
  thinking: string;
  thinkingVisible: boolean;
  sidebarVisible: boolean;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  themePickerOpen: boolean;
  themePickerIndex: number;
  providerPickerOpen: boolean;
  providerPickerIndex: number;
  currentProvider: string;
  currentModel: string;
  currentActivity: ActivitySnapshot;
  toolCallCounts: Record<string, number>;
  /** Per-provider cumulative cost in USD. Key: provider name (e.g. "claude"). */
  perProviderCost: Record<string, number>;
  /** Per-provider cumulative token counts. */
  perProviderTokens: Record<string, { input: number; output: number }>;
  listeners: Set<() => void>;
}

/**
 * Real-time activity snapshot for live progress visibility.
 */
export interface ActivitySnapshot {
  phase: "" | "planning" | "executing" | "reasoning" | "responding";
  toolName?: string;
  details?: string;
}

/**
 * Creates a new reactive state instance with default values.
 * @returns Fresh ReactiveState with empty messages, idle status, zero cost.
 */
export function createReactiveState(): ReactiveState {
  return {
    messages: [],
    input: "",
    status: "idle",
    cost: 0,
    thinking: "",
    thinkingVisible: false,
    sidebarVisible: true,
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    themePickerOpen: false,
    themePickerIndex: 0,
    providerPickerOpen: false,
    providerPickerIndex: 0,
    currentProvider: "claude",
    currentModel: "",
    currentActivity: { phase: "" },
    toolCallCounts: {},
    perProviderCost: {},
    perProviderTokens: {},
    listeners: new Set(),
  };
}

/**
 * Notifies all listeners of a state change.
 * @param state - The reactive state to notify listeners for.
 */
export function notify(state: ReactiveState): void {
  for (const listener of state.listeners) {
    listener();
  }
}

/**
 * Updates a single property on the reactive state and notifies listeners.
 * @param state - The reactive state to update.
 * @param key - The property key to update.
 * @param value - The new value to assign.
 */
export function update<T extends keyof ReactiveState>(
  state: ReactiveState,
  key: T,
  value: ReactiveState[T]
): void {
  (state as ReactiveState)[key] = value;
  notify(state);
}

/**
 * Helper to create a Message object.
 * @param role - The role type for the message.
 * @param content - The message content.
 * @param toolName - Optional tool name for tool messages.
 */
export function createMessage(
  role: MessageRole,
  content: string,
  toolName?: string
): Message {
  return { role, content, toolName };
}

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
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

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
  currentReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts: ReasoningEffort[];
  respondingProvider?: string;
  respondingModel?: string;
  currentSessionId?: string;
  currentTurnId?: string;
  currentActivity: ActivitySnapshot;
  toolCallCounts: Record<string, number>;
  /** Per-provider cumulative cost in USD. Key: provider name (e.g. "claude"). */
  perProviderCost: Record<string, number>;
  /** Per-provider cumulative token counts. */
  perProviderTokens: Record<string, { input: number; output: number }>;
  /** How the current provider was selected: user-driven or automatic routing. */
  routeMode: "user" | "auto";
  /** Last known resume metadata keyed by provider. */
  resumeInfoByProvider: Record<string, ResumeSidebarInfo>;
  /** Last known runtime continuity metadata keyed by provider. */
  runtimeContinuityByProvider: Record<string, RuntimeContinuitySidebarInfo>;
  fieldSnapshot: FieldSidebarInfo;
  /** Session history for sidebar browser. */
  sessions: SessionListItem[];
  /** Currently selected session index in the sidebar browser. */
  selectedSessionIndex: number;
  /** Pending approval requests from the gateway. */
  pendingApprovals: PendingApproval[];
  /** Files changed in the current session turn. */
  changedFiles: ChangedFile[];
  /** Governed work items observed in canonical session events. */
  workItems: WorkItem[];
  /** Whether plan mode is active (read-only planning). */
  planMode: boolean;
  /** Available slash commands for command palette. */
  slashCommands: SlashCommand[];
  /** Currently selected slash command index. */
  slashCommandIndex: number;
  /** Whether slash command popover is open. */
  slashPopoverOpen: boolean;
  listeners: Set<() => void>;
}

export interface ResumeSidebarInfo {
  strategy?: string;
  feedbackLabel?: string;
}

export interface RuntimeContinuitySidebarInfo {
  strategy?: string;
  feedbackLabel?: string;
  pressure?: string;
  supportArtifactCount?: number;
  supportArtifactSources?: string[];
  fallbackLabel?: string;
  usedCachedSupport?: boolean;
  selectionReason?: string;
}

export interface FieldSidebarInfo {
  dominantRegions: string[];
  saturation: number;
  entropy: number;
  status: "stable" | "runaway" | "starvation" | "unknown";
}

/** Session list item for sidebar display. */
export interface SessionListItem {
  sessionId: string;
  provider: string;
  task: string;
  completedAt: string;
  cost: number;
  turns?: number;
  durationMs?: number;
}

/** Pending approval request. */
export interface PendingApproval {
  approvalId: string;
  sessionId: string;
  description: string;
  requestedAt: Date;
}

/** File change record. */
export interface ChangedFile {
  sessionId?: string;
  turnId?: string;
  path: string;
  changeType: "created" | "modified" | "deleted";
  linesAdded?: number;
  linesRemoved?: number;
  timestamp: Date;
}

/** Governed work item summary for sidebar display. */
export interface WorkItem {
  sessionId?: string;
  turnId?: string;
  id: string;
  summary: string;
  status: string;
  workflowProfile: string;
  assignedAgentProfile?: string;
  expectedEvidence: string[];
  providedEvidence: string[];
  missingEvidence?: string[];
  missingResidualRisk?: boolean;
  updatedAt: Date;
}

/** Slash command for command palette. */
export interface SlashCommand {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  type: "builtin" | "custom";
}

/** Real-time activity snapshot for live progress visibility. */
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
    currentReasoningEffort: undefined,
    supportedReasoningEfforts: [],
    respondingProvider: undefined,
    respondingModel: undefined,
    currentSessionId: undefined,
    currentTurnId: undefined,
    currentActivity: { phase: "" },
    toolCallCounts: {},
    perProviderCost: {},
    perProviderTokens: {},
    routeMode: "user",
    resumeInfoByProvider: {},
    runtimeContinuityByProvider: {},
    fieldSnapshot: { dominantRegions: [], saturation: 0, entropy: 0, status: "unknown" },
    sessions: [],
    selectedSessionIndex: -1,
    pendingApprovals: [],
    changedFiles: [],
    workItems: [],
    planMode: false,
    slashCommands: [],
    slashCommandIndex: -1,
    slashPopoverOpen: false,
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

/**
 * @fileoverview Reactive state management for TUI.
 * @module @kilnai/tui
 */

import type {
  OperatorCockpitEconomicAttemptProjection,
  OperatorCockpitEvidenceRejection,
  OperatorCockpitManagedAgentViewState,
  OperatorSessionEvent,
  OperatorSessionSummary,
  OperatorTurnRequestedAuthority,
  OperatorWorkspaceHomeProjection,
  ContextUsageProjection,
} from "@kilnai/gateway-contracts";
import type {
  OperatorGovernedWorkItemProjection,
} from "@kilnai/gateway-contracts";
import {
  EMPTY_TUI_ECONOMIC_ATTEMPTS,
  EMPTY_TUI_UNPROJECTABLE_EVIDENCE,
  EMPTY_TUI_MANAGED_AGENT_VIEW_STATE,
  EMPTY_TUI_OPERATOR_WORKSPACE_HOME,
} from "./managed-agent-cockpit.js";
import type { MessageRole } from "./types.js";

/** Message structure for TUI chat history. */
export interface Message {
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolInput?: unknown;
}

/** Possible TUI status values. */
export type TuiStatus = "idle" | "running" | "error";
export type DeliberationLevelId = string;
export type TuiRequestedAuthority = OperatorTurnRequestedAuthority;

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
  contextUsage?: ContextUsageProjection;
  themePickerOpen: boolean;
  themePickerIndex: number;
  executionRoutePickerOpen: boolean;
  executionRoutePickerIndex: number;
  currentProvider: string;
  currentModel: string;
  currentDeliberationLevel?: DeliberationLevelId;
  currentRequestedAuthority: TuiRequestedAuthority;
  supportedDeliberationLevels: DeliberationLevelId[];
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
  /** Last known continuation metadata keyed by provider. */
  continuationInfoByProvider: Record<string, ContinuationSidebarInfo>;
  /** Last known runtime continuity metadata keyed by provider. */
  runtimeContinuityByProvider: Record<string, RuntimeContinuitySidebarInfo>;
  fieldSnapshot: FieldSidebarInfo;
  /** Session history for sidebar browser. */
  sessions: OperatorSessionSummary[];
  /** Currently selected session index in the sidebar browser. */
  selectedSessionIndex: number;
  /** Whether Enter on the selected sidebar session confirms explicit continuation. */
  sessionContinuationMode: boolean;
  /** Pending approval requests from the gateway. */
  pendingApprovals: PendingApproval[];
  /** Files changed in the current session turn. */
  changedFiles: ChangedFile[];
  /** Governed work items observed in canonical session events. */
  workItems: WorkItem[];
  /** Canonical managed-agent session events retained for current TUI projection. */
  managedAgentSessionEvents: readonly OperatorSessionEvent[];
  /** Shared cockpit projection for managed children visible in the TUI sidebar. */
  managedAgents: OperatorCockpitManagedAgentViewState;
  /** Shared cockpit projection of managed-economic-job lifecycle attempts (not joined to a specific invocation). */
  economicAttempts: readonly OperatorCockpitEconomicAttemptProjection[];
  unprojectableEvidence: readonly OperatorCockpitEvidenceRejection[];
  /** Shared Operator Workspace home projection for cross-surface summaries. */
  operatorWorkspaceHome: OperatorWorkspaceHomeProjection;
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

export interface ContinuationSidebarInfo {
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
export interface WorkItem extends Omit<OperatorGovernedWorkItemProjection, "updatedAt"> {
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
    contextUsage: undefined,
    themePickerOpen: false,
    themePickerIndex: 0,
    executionRoutePickerOpen: false,
    executionRoutePickerIndex: 0,
    currentProvider: "claude",
    currentModel: "",
    currentDeliberationLevel: undefined,
    currentRequestedAuthority: "auto",
    supportedDeliberationLevels: [],
    respondingProvider: undefined,
    respondingModel: undefined,
    currentSessionId: undefined,
    currentTurnId: undefined,
    currentActivity: { phase: "" },
    toolCallCounts: {},
    perProviderCost: {},
    perProviderTokens: {},
    routeMode: "user",
    continuationInfoByProvider: {},
    runtimeContinuityByProvider: {},
    fieldSnapshot: { dominantRegions: [], saturation: 0, entropy: 0, status: "unknown" },
    sessions: [],
    selectedSessionIndex: -1,
    sessionContinuationMode: false,
    pendingApprovals: [],
    changedFiles: [],
    workItems: [],
    managedAgentSessionEvents: [],
    managedAgents: EMPTY_TUI_MANAGED_AGENT_VIEW_STATE,
    economicAttempts: EMPTY_TUI_ECONOMIC_ATTEMPTS,
    unprojectableEvidence: EMPTY_TUI_UNPROJECTABLE_EVIDENCE,
    operatorWorkspaceHome: EMPTY_TUI_OPERATOR_WORKSPACE_HOME,
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

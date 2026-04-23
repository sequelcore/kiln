import { create } from "zustand";
import type {
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiSessionDetail,
  GuiSessionSummary,
  GuiSessionTranscriptLine,
} from "@kilnai/gateway-contracts";

export interface ApprovalRequest {
  readonly id: string;
  readonly description: string;
  readonly sessionId: string;
  readonly requestedAt: string;
}

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallEntry {
  readonly callId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly result?: string;
  readonly status: ToolCallStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export type ActivityPhase = "idle" | "thinking" | "tool_running" | "awaiting_approval" | "streaming";

export interface ProviderUsage {
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface RuntimeContinuityInfo {
  readonly strategy: string;
  readonly feedbackLabel?: string;
  readonly pressure?: string;
  readonly supportArtifactCount?: number;
  readonly supportArtifactSources?: readonly string[];
  readonly fallbackLabel?: string;
  readonly usedCachedSupport?: boolean;
  readonly selectionReason?: string;
}

export interface ChangedFileEntry {
  readonly path: string;
  readonly changeType: "created" | "modified" | "deleted";
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly recordedAt: string;
}

const PLAN_MODE_KEY = "kiln.gui.planMode";
const RESUME_TARGET_KEY = "kiln.gui.resumeTarget";
const CLEAR_TIMEOUT_MS = 5_000;
const PROVIDER_SWITCH_TIMEOUT_MS = 5_000;

function nowIso(): string {
  return new Date().toISOString();
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredPlanMode(): boolean | null {
  try {
    const value = localStorage.getItem(PLAN_MODE_KEY);
    if (value === null) return null;
    return value === "true";
  } catch {
    return null;
  }
}

function persistPlanMode(value: boolean): void {
  try {
    localStorage.setItem(PLAN_MODE_KEY, value ? "true" : "false");
  } catch {
    // fail-open
  }
}

function readResumeTarget(): string | null {
  try {
    return localStorage.getItem(RESUME_TARGET_KEY);
  } catch {
    return null;
  }
}

function writeResumeTarget(sessionId: string | null): void {
  try {
    if (!sessionId) {
      localStorage.removeItem(RESUME_TARGET_KEY);
      return;
    }
    localStorage.setItem(RESUME_TARGET_KEY, sessionId);
  } catch {
    // fail-open
  }
}

function readTranscriptText(line: GuiSessionTranscriptLine): string | null {
  const value = line.data.content
    ?? line.data.text
    ?? line.data.message
    ?? line.data.output
    ?? line.data.details
    ?? line.data.delta
    ?? line.data.toolName;
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function transcriptRole(line: GuiSessionTranscriptLine): Message["role"] | null {
  if (line.type === "text_delta" || line.type === "assistant" || line.type === "done") {
    return "assistant";
  }
  if (line.type === "user" || line.type === "user_message") {
    return "user";
  }
  if (line.type === "error") {
    return "error";
  }
  if (line.type === "tool_use" || line.type === "tool_result" || line.type.startsWith("tool_")) {
    return "tool";
  }
  return null;
}

function mapSessionDetailToMessages(detail: GuiSessionDetail): readonly Message[] {
  const messages: Message[] = [];
  const transcript = Array.isArray(detail.transcript) ? detail.transcript : [];
  for (const line of transcript) {
    const role = transcriptRole(line);
    const content = readTranscriptText(line);
    if (!role || !content) {
      continue;
    }

    const previous = messages[messages.length - 1];
    if (line.type === "text_delta" && previous?.role === "assistant") {
      messages[messages.length - 1] = {
        ...previous,
        content: previous.content + content,
      };
      continue;
    }

    messages.push({
      id: `${detail.id}:${line.seq}`,
      role,
      content,
      createdAt: line.ts,
      streaming: false,
      routedProvider: role === "assistant" ? detail.meta?.lastProvider : undefined,
    });
  }

  if (messages.length > 0) {
    return messages;
  }

  const fallback = detail.meta?.summary ?? detail.meta?.task ?? "";
  return fallback.trim().length > 0
    ? [{
        id: `${detail.id}:summary`,
        role: "assistant",
        content: fallback,
        createdAt: detail.meta?.completedAt ?? detail.meta?.startedAt ?? nowIso(),
        streaming: false,
        routedProvider: detail.meta?.lastProvider,
      }]
    : [];
}

export type SessionStatus = "idle" | "connecting" | "ready" | "running" | "error";

export interface Message {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool" | "error";
  readonly content: string;
  readonly createdAt: string;
  readonly streaming?: boolean;
  readonly routedProvider?: string;
  readonly routedModel?: string;
}

export interface ActivityState {
  readonly phase?: string;
  readonly toolName?: string;
  readonly details?: string;
}

export interface ProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: "subscription" | "harness" | "direct-api";
  readonly free: boolean;
  readonly available: boolean;
  readonly models: readonly string[];
}

export interface AuthorityStatus {
  readonly effective: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
  readonly completeness: "authoritative" | "partial";
}

export type RouteMode = "user" | "auto" | "responding";

interface SessionStoreState {
  readonly status: SessionStatus;
  readonly messages: readonly Message[];
  readonly currentAssistant: string | null;
  readonly planMode: boolean;
  readonly activity: ActivityState | null;
  readonly errorBanner: string | null;
  readonly providers: readonly ProviderDescriptor[];
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly sessionList: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly resumeTargetId: string | null;
  readonly routedProvider: string | null;
  readonly routedModel: string | null;
  readonly routeMode: RouteMode;
  readonly respondingProvider: string | null;
  readonly respondingModel: string | null;
  readonly turnCounter: number;
  readonly sessionCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly perProviderUsage: Readonly<Record<string, ProviderUsage>>;
  readonly runtimeContinuityByProvider: Readonly<Record<string, RuntimeContinuityInfo>>;
  readonly changedFiles: readonly ChangedFileEntry[];
  readonly currentTurnProvider: string | null;
  readonly currentTurnTrackedCostUsd: number;
  readonly currentTurnTrackedInputTokens: number;
  readonly currentTurnTrackedOutputTokens: number;
  readonly clearPending: boolean;
  readonly providerSwitching: boolean;
  readonly providerExplicitSelection: boolean;
  readonly authorityStatus: AuthorityStatus | null;
  readonly outboundSend: ((frame: GuiOutboundFrame) => void) | null;
  readonly clearTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly providerSwitchTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly approvalQueue: readonly ApprovalRequest[];
  readonly toolCallLog: readonly ToolCallEntry[];
  readonly activityPhase: ActivityPhase;
}

interface SessionStoreActions {
  setConnectionStatus: (status: SessionStatus) => void;
  setSender: (send: ((frame: GuiOutboundFrame) => void) | null) => void;
  setSessionList: (sessions: readonly GuiSessionSummary[]) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
  viewSessionDetail: (detail: GuiSessionDetail) => void;
  setErrorBanner: (message: string | null) => void;
  clearErrorBanner: () => void;
  onWelcome: (frame: Extract<GuiInboundFrame, { type: "welcome" }>) => void;
  onTextDelta: (frame: Extract<GuiInboundFrame, { type: "text_delta" }>) => void;
  onActivity: (frame: Extract<GuiInboundFrame, { type: "activity" }>) => void;
  onDone: (frame: Extract<GuiInboundFrame, { type: "done" }>) => void;
  onError: (frame: Extract<GuiInboundFrame, { type: "error" }>) => void;
  onCleared: () => void;
  onProviderChanged: (frame: Extract<GuiInboundFrame, { type: "provider_changed" }>) => void;
  onExecConfirmed: () => void;
  switchProvider: (provider: string, model?: string) => boolean;
  sendMessage: (text: string) => boolean;
  sendClear: () => boolean;
  setPlanMode: (enabled: boolean) => void;
  setResume: (sessionId: string | null) => void;
  disconnect: () => void;
  onApprovalRequested: (frame: Extract<GuiInboundFrame, { type: "approval_requested" }>) => void;
  onApprovalReceived: (frame: Extract<GuiInboundFrame, { type: "approval_received" }>) => void;
  onToolCallStart: (frame: Extract<GuiInboundFrame, { type: "tool_call_start" }>) => void;
  onToolCallResult: (frame: Extract<GuiInboundFrame, { type: "tool_call_result" }>) => void;
  onActivityPhase: (frame: Extract<GuiInboundFrame, { type: "activity_phase" }>) => void;
  sendApprovalResponse: (approved: boolean, reason?: string, sessionId?: string) => boolean;
  clearToolCallLog: () => void;
}

export type SessionStore = SessionStoreState & SessionStoreActions;

const initialPlanMode = readStoredPlanMode() ?? false;

export const useSessionStore = create<SessionStore>((set, get) => ({
  status: "idle",
  messages: [],
  currentAssistant: null,
  planMode: initialPlanMode,
  activity: null,
  errorBanner: null,
  providers: [],
  activeProvider: null,
  activeModel: null,
  sessionList: [],
  selectedSessionId: null,
  resumeTargetId: null,
  routedProvider: null,
  routedModel: null,
  routeMode: "auto",
  respondingProvider: null,
  respondingModel: null,
  turnCounter: 0,
  sessionCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  perProviderUsage: {},
  runtimeContinuityByProvider: {},
  changedFiles: [],
  currentTurnProvider: null,
  currentTurnTrackedCostUsd: 0,
  currentTurnTrackedInputTokens: 0,
  currentTurnTrackedOutputTokens: 0,
  clearPending: false,
  providerSwitching: false,
  providerExplicitSelection: false,
  authorityStatus: null,
  outboundSend: null,
  clearTimeoutId: null,
  providerSwitchTimeoutId: null,
  approvalQueue: [],
  toolCallLog: [],
  activityPhase: "idle",

  setConnectionStatus: (status) => {
    set({ status });
  },

  setSender: (send) => {
    set({ outboundSend: send });
  },

  setSessionList: (sessions) => {
    const selected = get().selectedSessionId;
    const selectedStillExists = selected ? sessions.some((session) => session.id === selected) : false;
    set({
      sessionList: sessions,
      selectedSessionId: selectedStillExists ? selected : null,
    });
  },

  setSelectedSessionId: (sessionId) => {
    set({ selectedSessionId: sessionId });
  },

  viewSessionDetail: (detail) => {
    writeResumeTarget(detail.id);
    set({
      selectedSessionId: detail.id,
      resumeTargetId: detail.id,
      messages: mapSessionDetailToMessages(detail),
      currentAssistant: null,
      status: "ready",
      activity: null,
      activityPhase: "idle",
      errorBanner: null,
    });
  },

  setErrorBanner: (message) => {
    set({ errorBanner: message });
  },

  clearErrorBanner: () => {
    set({ errorBanner: null });
  },

  onWelcome: (frame) => {
    const providersFromWelcome: ProviderDescriptor[] = [];
    for (const provider of frame.providers ?? []) {
      if (!provider || typeof provider !== "object") continue;
      const candidate = provider as Partial<ProviderDescriptor>;
      if (
        typeof candidate.id !== "string"
        || typeof candidate.label !== "string"
        || (candidate.group !== "subscription" && candidate.group !== "harness" && candidate.group !== "direct-api")
        || typeof candidate.free !== "boolean"
        || typeof candidate.available !== "boolean"
        || !Array.isArray(candidate.models)
      ) {
        continue;
      }
      providersFromWelcome.push({
        id: candidate.id,
        label: candidate.label,
        group: candidate.group,
        free: candidate.free,
        available: candidate.available,
        models: candidate.models.filter((model): model is string => typeof model === "string"),
      });
    }
    const providersFromModels = Object.keys(frame.models ?? {});
    const providers = providersFromWelcome.length > 0
      ? providersFromWelcome
      : providersFromModels.map((providerId) => ({
          id: providerId,
          label: providerId,
          group: "direct-api" as const,
          free: false,
          available: true,
          models: frame.models?.[providerId] ?? [],
        }));
    const providerById = new Map(providers.map((provider) => [provider.id, provider] as const));
    const activeProvider =
      frame.activeProvider
      ?? providers[0]?.id
      ?? providersFromModels[0]
      ?? get().activeProvider
      ?? null;
    const activeModel =
      frame.activeModel
      ?? (activeProvider ? (providerById.get(activeProvider)?.models[0] ?? frame.models?.[activeProvider]?.[0] ?? null) : null)
      ?? get().activeModel
      ?? null;
    const persistedPlanMode = readStoredPlanMode();
    const resolvedPlanMode = persistedPlanMode ?? frame.planMode ?? get().planMode;
    const persistedResume = readResumeTarget();
    const explicitSelection = Boolean(frame.activeProvider) || get().providerExplicitSelection;

    set({
      providers,
      activeProvider,
      activeModel,
      authorityStatus: frame.authorityStatus ?? get().authorityStatus,
      planMode: resolvedPlanMode,
      routeMode: explicitSelection ? "user" : "auto",
      providerExplicitSelection: explicitSelection,
      resumeTargetId: persistedResume,
      status: "ready",
      errorBanner: null,
    });
    persistPlanMode(resolvedPlanMode);
  },

  onTextDelta: (frame) => {
    const state = get();
    const messageList = [...state.messages];
    const existingId = state.currentAssistant;
    const targetIndex = existingId
      ? messageList.findIndex((message) => message.id === existingId)
      : -1;

    if (targetIndex >= 0) {
      const current = messageList[targetIndex];
      if (!current) {
        return;
      }
      messageList[targetIndex] = {
        ...current,
        content: current.content + frame.content,
        streaming: true,
      };
      set({ messages: messageList, status: "running", activityPhase: "streaming", errorBanner: null });
      return;
    }

    const assistantId = createMessageId();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: frame.content,
      createdAt: nowIso(),
      streaming: true,
    };
    set({
      messages: [...messageList, assistantMessage],
      currentAssistant: assistantId,
      status: "running",
      activityPhase: "streaming",
      errorBanner: null,
    });
  },

  onActivity: (frame) => {
    const current = get();
    if (frame.activity === "cost_update" && typeof frame.usd === "number") {
      const provider = current.currentTurnProvider ?? current.respondingProvider ?? current.activeProvider;
      const nextUsage = { ...current.perProviderUsage };
      if (provider) {
        const previous = nextUsage[provider] ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 };
        nextUsage[provider] = {
          costUsd: previous.costUsd + frame.usd,
          inputTokens: previous.inputTokens + (frame.inputTokens ?? 0),
          outputTokens: previous.outputTokens + (frame.outputTokens ?? 0),
        };
      }
      set({
        sessionCostUsd: current.sessionCostUsd + frame.usd,
        inputTokens: current.inputTokens + (frame.inputTokens ?? 0),
        outputTokens: current.outputTokens + (frame.outputTokens ?? 0),
        perProviderUsage: nextUsage,
        currentTurnTrackedCostUsd: current.currentTurnTrackedCostUsd + frame.usd,
        currentTurnTrackedInputTokens: current.currentTurnTrackedInputTokens + (frame.inputTokens ?? 0),
        currentTurnTrackedOutputTokens: current.currentTurnTrackedOutputTokens + (frame.outputTokens ?? 0),
      });
      return;
    }

    if (frame.activity === "file_changed" && frame.path && frame.changeType) {
      const entry: ChangedFileEntry = {
        path: frame.path,
        changeType: frame.changeType,
        linesAdded: frame.linesAdded,
        linesRemoved: frame.linesRemoved,
        recordedAt: nowIso(),
      };
      set({
        changedFiles: [...current.changedFiles, entry],
      });
      return;
    }

    const nextRespondingProvider = current.respondingProvider ?? current.activeProvider;
    const nextRespondingModel = current.respondingModel ?? current.activeModel;

    const baseActivity = frame.activity.trim();
    const phase = baseActivity.length > 0 ? baseActivity : undefined;

    const derivedPhase: ActivityPhase = (() => {
      if (frame.activity === "tool_use") return "tool_running";
      if (frame.activity === "reasoning") return "thinking";
      if (frame.activity === "tool_result") return "idle";
      return current.activityPhase === "idle" ? "thinking" : current.activityPhase;
    })();

    set({
      activity: {
        phase,
        toolName: frame.toolName,
        details: frame.details ?? frame.output,
      },
      activityPhase: derivedPhase,
      routeMode: "responding",
      respondingProvider: nextRespondingProvider,
      respondingModel: nextRespondingModel,
    });

    if (frame.activity !== "tool_use") {
      return;
    }

    const details = (() => {
      if (!frame.input || typeof frame.input !== "object") return "";
      const entries = Object.entries(frame.input as Record<string, unknown>).slice(0, 3);
      if (entries.length === 0) return "";
      const formatted = entries
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(", ");
      return ` (${formatted})`;
    })();

    const toolMessage: Message = {
      id: createMessageId(),
      role: "tool",
      content: `${frame.toolName ?? "tool"}${details}`,
      createdAt: nowIso(),
    };
    set((previous) => ({
      messages: [...previous.messages, toolMessage],
    }));
  },

  onDone: (frame) => {
    const state = get();
    const finalizedProvider = frame.routedProvider ?? state.respondingProvider ?? state.activeProvider ?? undefined;
    const finalizedModel = frame.routedModel ?? state.respondingModel ?? state.activeModel ?? undefined;
    const currentTurnProvider = state.currentTurnProvider;
    let nextPerProviderUsage = { ...state.perProviderUsage };
    if (currentTurnProvider && finalizedProvider && currentTurnProvider !== finalizedProvider) {
      const previousProviderUsage = nextPerProviderUsage[currentTurnProvider];
      if (previousProviderUsage) {
        const adjustedPreviousCost = previousProviderUsage.costUsd - state.currentTurnTrackedCostUsd;
        const adjustedPreviousInput = previousProviderUsage.inputTokens - state.currentTurnTrackedInputTokens;
        const adjustedPreviousOutput = previousProviderUsage.outputTokens - state.currentTurnTrackedOutputTokens;
        if (adjustedPreviousCost === 0 && adjustedPreviousInput === 0 && adjustedPreviousOutput === 0) {
          delete nextPerProviderUsage[currentTurnProvider];
        } else {
          nextPerProviderUsage[currentTurnProvider] = {
            costUsd: adjustedPreviousCost,
            inputTokens: adjustedPreviousInput,
            outputTokens: adjustedPreviousOutput,
          };
        }
        const targetUsage = nextPerProviderUsage[finalizedProvider] ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 };
        nextPerProviderUsage[finalizedProvider] = {
          costUsd: targetUsage.costUsd + state.currentTurnTrackedCostUsd,
          inputTokens: targetUsage.inputTokens + state.currentTurnTrackedInputTokens,
          outputTokens: targetUsage.outputTokens + state.currentTurnTrackedOutputTokens,
        };
      }
    }

    let nextInputTokens = state.inputTokens;
    let nextOutputTokens = state.outputTokens;
    if (frame.inputTokens > state.currentTurnTrackedInputTokens) {
      const delta = frame.inputTokens - state.currentTurnTrackedInputTokens;
      nextInputTokens += delta;
      if (finalizedProvider) {
        const targetUsage = nextPerProviderUsage[finalizedProvider] ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 };
        nextPerProviderUsage[finalizedProvider] = {
          ...targetUsage,
          inputTokens: targetUsage.inputTokens + delta,
        };
      }
    }
    if (frame.outputTokens > state.currentTurnTrackedOutputTokens) {
      const delta = frame.outputTokens - state.currentTurnTrackedOutputTokens;
      nextOutputTokens += delta;
      if (finalizedProvider) {
        const targetUsage = nextPerProviderUsage[finalizedProvider] ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 };
        nextPerProviderUsage[finalizedProvider] = {
          ...targetUsage,
          outputTokens: targetUsage.outputTokens + delta,
        };
      }
    }

    const nextRuntimeContinuity = { ...state.runtimeContinuityByProvider };
    if (finalizedProvider && frame.runtimeContinuity?.strategy) {
      nextRuntimeContinuity[finalizedProvider] = frame.runtimeContinuity;
    }

    let nextMessages = [...state.messages];
    if (state.currentAssistant) {
      nextMessages = nextMessages.map((message) => (
        message.id === state.currentAssistant
          ? {
              ...message,
              streaming: false,
              routedProvider: finalizedProvider,
              routedModel: finalizedModel,
            }
          : message
      ));
    } else if (frame.content.trim().length > 0) {
      nextMessages = [
        ...nextMessages,
        {
          id: createMessageId(),
          role: "assistant",
          content: frame.content,
          createdAt: nowIso(),
          streaming: false,
          routedProvider: finalizedProvider,
          routedModel: finalizedModel,
        },
      ];
    }

    const clearTimeoutId = state.clearTimeoutId;
    if (clearTimeoutId) {
      clearTimeout(clearTimeoutId);
    }

    set({
      messages: nextMessages,
      currentAssistant: null,
      status: "ready",
      activity: null,
      activityPhase: "idle",
      sessionCostUsd: state.sessionCostUsd,
      inputTokens: nextInputTokens,
      outputTokens: nextOutputTokens,
      perProviderUsage: nextPerProviderUsage,
      runtimeContinuityByProvider: nextRuntimeContinuity,
      authorityStatus: frame.authorityStatus ?? state.authorityStatus,
      routedProvider: finalizedProvider ?? state.routedProvider,
      routedModel: finalizedModel ?? state.routedModel,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      currentTurnProvider: null,
      currentTurnTrackedCostUsd: 0,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      turnCounter: state.turnCounter + 1,
      clearTimeoutId: null,
      clearPending: false,
    });
  },

  onError: (frame) => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
    }
    const errorMessage: Message = {
      id: createMessageId(),
      role: "error",
      content: frame.message,
      createdAt: nowIso(),
    };
    set({
      messages: [...state.messages, errorMessage],
      status: "ready",
      activity: null,
      errorBanner: frame.message,
      currentAssistant: null,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      clearPending: false,
      clearTimeoutId: null,
    });
  },

  onCleared: () => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
    }
    writeResumeTarget(null);
    set({
      messages: [],
      currentAssistant: null,
      status: "ready",
      activity: null,
      activityPhase: "idle",
      errorBanner: null,
      selectedSessionId: null,
      resumeTargetId: null,
      routedProvider: null,
      routedModel: null,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      sessionCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      perProviderUsage: {},
      runtimeContinuityByProvider: {},
      changedFiles: [],
      currentTurnProvider: null,
      currentTurnTrackedCostUsd: 0,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      clearPending: false,
      clearTimeoutId: null,
      approvalQueue: [],
      toolCallLog: [],
    });
  },

  onProviderChanged: (frame) => {
    const state = get();
    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }
    set({
      activeProvider: frame.provider,
      activeModel: frame.model ?? null,
      routeMode: "user",
      providerExplicitSelection: true,
      providerSwitching: false,
      providerSwitchTimeoutId: null,
      respondingProvider: null,
      respondingModel: null,
    });
  },

  onExecConfirmed: () => {
    persistPlanMode(false);
    set({ planMode: false, status: "ready", errorBanner: null });
  },

  switchProvider: (provider, model) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }

    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }

    outboundSend({
      type: "provider",
      provider,
      model: model ?? undefined,
    });

    const timeoutId = setTimeout(() => {
      const latest = get();
      if (!latest.providerSwitching) return;
      set({
        providerSwitching: false,
        providerSwitchTimeoutId: null,
        errorBanner: "Provider switch timed out. Please retry.",
      });
    }, PROVIDER_SWITCH_TIMEOUT_MS);

    set({
      providerSwitching: true,
      providerSwitchTimeoutId: timeoutId,
      errorBanner: null,
    });

    return true;
  },

  sendMessage: (text) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (state.status !== "ready" || !outboundSend) {
      return false;
    }
    const normalized = text.trim();
    if (!normalized) {
      return false;
    }

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: normalized,
      createdAt: nowIso(),
    };
    set({
      messages: [...state.messages, userMessage],
      status: "running",
      activity: { phase: "thinking" },
      activityPhase: "thinking",
      routeMode: "responding",
      respondingProvider: state.activeProvider,
      respondingModel: state.activeModel,
      currentTurnProvider: state.activeProvider,
      currentTurnTrackedCostUsd: 0,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      errorBanner: null,
      currentAssistant: null,
    });

    outboundSend({
      type: "message",
      text: normalized,
      planMode: state.planMode,
      resumeSessionId: state.resumeTargetId ?? undefined,
    });

    return true;
  },

  sendClear: () => {
    const state = get();
    if (!state.outboundSend || state.clearPending) {
      return false;
    }

    state.outboundSend({ type: "clear" });
    const timeoutId = setTimeout(() => {
      const latest = get();
      if (!latest.clearPending) return;
      set({
        clearPending: false,
        clearTimeoutId: null,
        status: "ready",
        errorBanner: "Clear session timed out. Please retry.",
      });
    }, CLEAR_TIMEOUT_MS);

    set({
      clearPending: true,
      clearTimeoutId: timeoutId,
      status: "running",
      errorBanner: null,
    });
    return true;
  },

  setPlanMode: (enabled) => {
    const state = get();
    if (enabled) {
      persistPlanMode(true);
      set({ planMode: true });
      return;
    }
    if (state.planMode && state.outboundSend) {
      state.outboundSend({ type: "exec" });
      return;
    }
    persistPlanMode(false);
    set({ planMode: false });
  },

  setResume: (sessionId) => {
    writeResumeTarget(sessionId);
    set({
      resumeTargetId: sessionId,
    });
  },

  disconnect: () => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
    }
    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }
    set({
      status: "idle",
      activity: null,
      activityPhase: "idle",
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      clearPending: false,
      clearTimeoutId: null,
      providerSwitching: false,
      providerSwitchTimeoutId: null,
    });
  },

  onApprovalRequested: (frame) => {
    const request: ApprovalRequest = {
      id: createMessageId(),
      description: frame.description,
      sessionId: frame.sessionId,
      requestedAt: nowIso(),
    };
    set((state) => ({
      approvalQueue: [...state.approvalQueue, request],
      activityPhase: "awaiting_approval",
    }));
  },

  onApprovalReceived: (frame) => {
    set((state) => {
      const nextQueue = frame.sessionId
        ? state.approvalQueue.filter((req) => req.sessionId !== frame.sessionId)
        : state.approvalQueue.slice(1);
      const nextPhase: ActivityPhase = nextQueue.length > 0 ? "awaiting_approval" : state.activityPhase === "awaiting_approval" ? "idle" : state.activityPhase;
      return { approvalQueue: nextQueue, activityPhase: nextPhase };
    });
  },

  onToolCallStart: (frame) => {
    const entry: ToolCallEntry = {
      callId: frame.callId,
      toolName: frame.toolName,
      input: frame.input,
      status: "running",
      startedAt: frame.timestamp,
    };
    set((state) => ({
      toolCallLog: [...state.toolCallLog, entry],
      activityPhase: "tool_running",
    }));
  },

  onToolCallResult: (frame) => {
    set((state) => {
      const nextLog = state.toolCallLog.map((entry) =>
        entry.callId === frame.callId
          ? { ...entry, result: frame.result, status: frame.status, completedAt: frame.timestamp }
          : entry,
      );
      const stillRunning = nextLog.some((entry) => entry.status === "running");
      const nextPhase: ActivityPhase = stillRunning ? "tool_running" : state.activityPhase === "tool_running" ? "idle" : state.activityPhase;
      return { toolCallLog: nextLog, activityPhase: nextPhase };
    });
  },

  onActivityPhase: (frame) => {
    set({ activityPhase: frame.phase });
  },

  sendApprovalResponse: (approved, reason, sessionId) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) return false;
    if (approved) {
      outboundSend({ type: "approve", sessionId });
    } else {
      outboundSend({ type: "reject", reason: reason ?? "rejected by user", sessionId });
    }
    return true;
  },

  clearToolCallLog: () => {
    set({ toolCallLog: [] });
  },
}));

import { create } from "zustand";
import type { GuiInboundFrame, GuiOutboundFrame, GuiSessionSummary } from "@kilnai/gateway-contracts";

const PLAN_MODE_KEY = "kiln.gui.planMode";
const CLEAR_TIMEOUT_MS = 5_000;

function resumeStorageKey(provider: string): string {
  return `kiln.gui.resume.${provider}`;
}

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

function readResumeTarget(provider: string | null): string | null {
  if (!provider) return null;
  try {
    return localStorage.getItem(resumeStorageKey(provider));
  } catch {
    return null;
  }
}

function writeResumeTarget(provider: string | null, sessionId: string | null): void {
  if (!provider) return;
  try {
    const key = resumeStorageKey(provider);
    if (!sessionId) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, sessionId);
  } catch {
    // fail-open
  }
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
  readonly models: readonly string[];
}

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
  readonly turnCounter: number;
  readonly clearPending: boolean;
  readonly outboundSend: ((frame: GuiOutboundFrame) => void) | null;
  readonly clearTimeoutId: ReturnType<typeof setTimeout> | null;
}

interface SessionStoreActions {
  setConnectionStatus: (status: SessionStatus) => void;
  setSender: (send: ((frame: GuiOutboundFrame) => void) | null) => void;
  setSessionList: (sessions: readonly GuiSessionSummary[]) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
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
  sendMessage: (text: string) => boolean;
  sendClear: () => boolean;
  setPlanMode: (enabled: boolean) => void;
  setResume: (sessionId: string | null) => void;
  disconnect: () => void;
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
  turnCounter: 0,
  clearPending: false,
  outboundSend: null,
  clearTimeoutId: null,

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
      selectedSessionId: selectedStillExists ? selected : sessions[0]?.id ?? null,
    });
  },

  setSelectedSessionId: (sessionId) => {
    set({ selectedSessionId: sessionId });
  },

  setErrorBanner: (message) => {
    set({ errorBanner: message });
  },

  clearErrorBanner: () => {
    set({ errorBanner: null });
  },

  onWelcome: (frame) => {
    const providersFromModels = Object.keys(frame.models ?? {});
    const providers = providersFromModels.map((providerId) => ({
      id: providerId,
      models: frame.models?.[providerId] ?? [],
    }));
    const activeProvider =
      frame.activeProvider
      ?? frame.providers?.[0]
      ?? providersFromModels[0]
      ?? get().activeProvider
      ?? null;
    const activeModel =
      frame.activeModel
      ?? (activeProvider ? (frame.models?.[activeProvider]?.[0] ?? null) : null)
      ?? get().activeModel
      ?? null;
    const persistedPlanMode = readStoredPlanMode();
    const resolvedPlanMode = persistedPlanMode ?? frame.planMode ?? get().planMode;
    const persistedResume = readResumeTarget(activeProvider);

    set({
      providers,
      activeProvider,
      activeModel,
      planMode: resolvedPlanMode,
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
      set({ messages: messageList, status: "running", errorBanner: null });
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
      errorBanner: null,
    });
  },

  onActivity: (frame) => {
    const baseActivity = frame.activity.trim();
    const phase = baseActivity.length > 0 ? baseActivity : undefined;
    set({
      activity: {
        phase,
        toolName: frame.toolName,
        details: frame.details ?? frame.output,
      },
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
    let nextMessages = [...state.messages];
    if (state.currentAssistant) {
      nextMessages = nextMessages.map((message) => (
        message.id === state.currentAssistant
          ? {
              ...message,
              streaming: false,
              routedProvider: frame.routedProvider,
              routedModel: frame.routedModel,
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
          routedProvider: frame.routedProvider,
          routedModel: frame.routedModel,
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
      routedProvider: frame.routedProvider ?? state.routedProvider,
      routedModel: frame.routedModel ?? state.routedModel,
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
      clearPending: false,
      clearTimeoutId: null,
    });
  },

  onCleared: () => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
    }
    writeResumeTarget(state.activeProvider, null);
    set({
      messages: [],
      currentAssistant: null,
      status: "ready",
      activity: null,
      errorBanner: null,
      resumeTargetId: null,
      routedProvider: null,
      routedModel: null,
      clearPending: false,
      clearTimeoutId: null,
    });
  },

  onProviderChanged: (frame) => {
    const resumeTargetId = readResumeTarget(frame.provider);
    set({
      activeProvider: frame.provider,
      activeModel: frame.model ?? get().activeModel,
      sessionList: [],
      selectedSessionId: null,
      resumeTargetId,
    });
  },

  onExecConfirmed: () => {
    persistPlanMode(false);
    set({ planMode: false, status: "ready", errorBanner: null });
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
    const provider = get().activeProvider;
    writeResumeTarget(provider, sessionId);
    set({
      resumeTargetId: sessionId,
      selectedSessionId: sessionId,
    });
  },

  disconnect: () => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
    }
    set({
      status: "idle",
      activity: null,
      clearPending: false,
      clearTimeoutId: null,
    });
  },
}));

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GuiInboundFrame, GuiSessionListResponse } from "@kilnai/gateway-contracts";
import { useGuiWs } from "../lib/use-gui-ws.js";
import { waitForGateway } from "../lib/wait-for-gateway.js";
import { useSessionStore } from "../lib/session-store.js";
import { SessionList } from "./session-list.js";
import { Transcript } from "./transcript.js";
import { Composer } from "./composer.js";
import { ErrorBanner } from "./error-banner.js";
import { ConnectionStatus } from "./connection-status.js";
import { ThemeSwitcher } from "./theme-switcher.js";
import { ProviderPicker } from "./provider-picker.js";
import { ProviderStatus } from "./provider-status.js";
import { ApprovalQueue } from "./approval-queue.js";
import { ToolCallLog } from "./tool-call-log.js";

const GATEWAY_BASE = "/gui-api";

function toWsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const gatewayPort = import.meta.env.VITE_GATEWAY_PORT as string | undefined;
  if (import.meta.env.DEV && gatewayPort) {
    return `${protocol}//${window.location.hostname}:${gatewayPort}${path}`;
  }
  return `${protocol}//${window.location.host}${path}`;
}

function mapActivityLabel(activity: ReturnType<typeof useSessionStore.getState>["activity"]): string | null {
  if (!activity?.phase) return null;
  const tool = activity.toolName ? ` · ${activity.toolName}` : "";
  const details = activity.details ? ` · ${activity.details}` : "";
  return `${activity.phase}${tool}${details}`;
}

async function fetchSessions(provider: string): Promise<GuiSessionListResponse["sessions"]> {
  const response = await fetch(`${GATEWAY_BASE}/sessions?provider=${encodeURIComponent(provider)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Session list fetch failed (${response.status})`);
  }
  const payload = await response.json() as GuiSessionListResponse;
  return payload.sessions ?? [];
}

export function AppShell() {
  const [gatewayReady, setGatewayReady] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayAttempt, setGatewayAttempt] = useState(0);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const status = useSessionStore((state) => state.status);
  const messages = useSessionStore((state) => state.messages);
  const providers = useSessionStore((state) => state.providers);
  const planMode = useSessionStore((state) => state.planMode);
  const activity = useSessionStore((state) => state.activity);
  const errorBanner = useSessionStore((state) => state.errorBanner);
  const activeProvider = useSessionStore((state) => state.activeProvider);
  const activeModel = useSessionStore((state) => state.activeModel);
  const sessionList = useSessionStore((state) => state.sessionList);
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId);
  const resumeTargetId = useSessionStore((state) => state.resumeTargetId);
  const turnCounter = useSessionStore((state) => state.turnCounter);
  const approvalQueue = useSessionStore((state) => state.approvalQueue);
  const toolCallLog = useSessionStore((state) => state.toolCallLog);
  const activityPhase = useSessionStore((state) => state.activityPhase);
  const setConnectionStatus = useSessionStore((state) => state.setConnectionStatus);
  const setSender = useSessionStore((state) => state.setSender);
  const setSessionList = useSessionStore((state) => state.setSessionList);
  const setSelectedSessionId = useSessionStore((state) => state.setSelectedSessionId);
  const setErrorBanner = useSessionStore((state) => state.setErrorBanner);
  const clearErrorBanner = useSessionStore((state) => state.clearErrorBanner);
  const onWelcome = useSessionStore((state) => state.onWelcome);
  const onTextDelta = useSessionStore((state) => state.onTextDelta);
  const onActivity = useSessionStore((state) => state.onActivity);
  const onDone = useSessionStore((state) => state.onDone);
  const onError = useSessionStore((state) => state.onError);
  const onCleared = useSessionStore((state) => state.onCleared);
  const onProviderChanged = useSessionStore((state) => state.onProviderChanged);
  const onExecConfirmed = useSessionStore((state) => state.onExecConfirmed);
  const onApprovalRequested = useSessionStore((state) => state.onApprovalRequested);
  const onApprovalReceived = useSessionStore((state) => state.onApprovalReceived);
  const onToolCallStart = useSessionStore((state) => state.onToolCallStart);
  const onToolCallResult = useSessionStore((state) => state.onToolCallResult);
  const onActivityPhase = useSessionStore((state) => state.onActivityPhase);
  const sendApprovalResponse = useSessionStore((state) => state.sendApprovalResponse);
  const sendMessage = useSessionStore((state) => state.sendMessage);
  const sendClear = useSessionStore((state) => state.sendClear);
  const setPlanMode = useSessionStore((state) => state.setPlanMode);
  const switchProvider = useSessionStore((state) => state.switchProvider);
  const setResume = useSessionStore((state) => state.setResume);
  const disconnect = useSessionStore((state) => state.disconnect);

  useEffect(() => {
    let cancelled = false;
    setGatewayReady(false);
    setGatewayError(null);
    void waitForGateway(GATEWAY_BASE, { timeoutMs: 3_000 })
      .then(() => {
        if (!cancelled) {
          setGatewayReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Gateway connection timed out";
          setGatewayError(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gatewayAttempt]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const handleChange = () => setIsNarrow(media.matches);
    media.addEventListener("change", handleChange);
    handleChange();
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!isNarrow) {
      setDrawerOpen(false);
    }
  }, [isNarrow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsPaletteOpen((open) => !open);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setIsProviderPickerOpen(true);
      }
      if (event.key === "Escape") {
        setIsPaletteOpen(false);
        setDrawerOpen(false);
        setIsProviderPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const wsUrl = useMemo(() => toWsUrl("/gui/ws"), []);

  const { state: wsState, send } = useGuiWs(wsUrl, {
    onFrame: (frame: GuiInboundFrame) => {
      if (frame.type === "welcome") {
        onWelcome(frame);
      } else if (frame.type === "text_delta") {
        onTextDelta(frame);
      } else if (frame.type === "activity") {
        onActivity(frame);
      } else if (frame.type === "done") {
        onDone(frame);
      } else if (frame.type === "error") {
        onError(frame);
      } else if (frame.type === "cleared") {
        onCleared();
      } else if (frame.type === "provider_changed") {
        onProviderChanged(frame);
      } else if (frame.type === "exec_confirmed") {
        onExecConfirmed();
      } else if (frame.type === "thinking") {
        setConnectionStatus("running");
      } else if (frame.type === "approval_requested") {
        onApprovalRequested(frame);
      } else if (frame.type === "approval_received") {
        onApprovalReceived(frame);
      } else if (frame.type === "tool_call_start") {
        onToolCallStart(frame);
      } else if (frame.type === "tool_call_result") {
        onToolCallResult(frame);
      } else if (frame.type === "activity_phase") {
        onActivityPhase(frame);
      }
    },
    onStateChange: (state) => {
      if (state === "open") {
        if (useSessionStore.getState().status === "idle") {
          setConnectionStatus("connecting");
        }
        clearErrorBanner();
      } else if (state === "connecting" || state === "reconnecting") {
        setConnectionStatus("connecting");
      } else if (state === "closed") {
        setConnectionStatus("error");
        setErrorBanner("Gateway disconnected.");
      }
    },
  });

  useEffect(() => {
    setSender(send);
    return () => {
      setSender(null);
      disconnect();
    };
  }, [disconnect, send, setSender]);

  const sessionsQuery = useQuery({
    queryKey: ["gui", "sessions", activeProvider, turnCounter],
    queryFn: () => fetchSessions(activeProvider ?? ""),
    enabled: gatewayReady && Boolean(activeProvider),
  });

  useEffect(() => {
    if (sessionsQuery.data) {
      setSessionList(sessionsQuery.data);
    }
  }, [sessionsQuery.data, setSessionList]);

  useEffect(() => {
    if (sessionsQuery.error) {
      setErrorBanner("Could not load session history.");
    }
  }, [sessionsQuery.error, setErrorBanner]);

  const activityLabel = mapActivityLabel(activity);

  if (!gatewayReady && !gatewayError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-6">
        <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-background-panel)] p-6">
          <p className="text-sm text-[var(--color-text-muted)]">Connecting to gateway…</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded bg-[var(--color-background-element)]">
            <div className="h-full w-1/3 animate-pulse rounded bg-[var(--color-accent)]" />
          </div>
        </div>
      </main>
    );
  }

  if (gatewayError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-6">
        <div className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-background-panel)]">
          <ErrorBanner
            message={gatewayError}
            onRetry={() => {
              setGatewayAttempt((count) => count + 1);
            }}
          />
        </div>
      </main>
    );
  }

  const sidebar = (
    <SessionList
      sessions={sessionList}
      selectedSessionId={selectedSessionId}
      resumeTargetId={resumeTargetId}
      activeProvider={activeProvider}
      onSelect={(sessionId) => setSelectedSessionId(sessionId)}
      onConfirmResume={(sessionId) => {
        setResume(sessionId);
        setDrawerOpen(false);
      }}
    />
  );

  return (
    <div className="flex h-screen flex-col bg-[var(--color-background)] text-[var(--color-text)]">
      {errorBanner ? (
        <ErrorBanner
          message={errorBanner}
          onDismiss={clearErrorBanner}
          onRetry={() => {
            clearErrorBanner();
            setGatewayAttempt((count) => count + 1);
          }}
        />
      ) : null}
      <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        {isNarrow ? (
          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            Sessions
          </button>
        ) : null}
        <p className="text-sm font-semibold">Kiln GUI</p>
        <ConnectionStatus state={wsState} />
        <ProviderStatus onOpenPicker={() => setIsProviderPickerOpen(true)} />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              sendClear();
              setIsPaletteOpen(false);
            }}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setIsPaletteOpen((open) => !open)}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            Commands
          </button>
          <ThemeSwitcher />
        </div>
      </header>

      {isPaletteOpen ? (
        <div className="absolute right-3 top-14 z-30 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-panel)] p-2 shadow-lg">
          <p className="px-2 py-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Command Palette</p>
          <button
            type="button"
            onClick={() => {
              sendClear();
              setIsPaletteOpen(false);
            }}
            className="mt-1 w-full rounded px-2 py-2 text-left text-sm hover:bg-[var(--color-background-element)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            Clear session
          </button>
          <button
            type="button"
            onClick={() => {
              setPlanMode(!planMode);
              setIsPaletteOpen(false);
            }}
            className="mt-1 w-full rounded px-2 py-2 text-left text-sm hover:bg-[var(--color-background-element)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            {planMode ? "Disable plan mode" : "Enable plan mode"}
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {!isNarrow ? (
          <div className="w-[320px] min-w-[280px] max-w-[360px]">{sidebar}</div>
        ) : null}
        <main className="flex min-h-0 flex-1 flex-col">
          <ApprovalQueue
            queue={approvalQueue}
            onApprove={(sessionId) => sendApprovalResponse(true, undefined, sessionId)}
            onDeny={(sessionId) => sendApprovalResponse(false, undefined, sessionId)}
          />
          <ToolCallLog entries={toolCallLog} />
          <Transcript messages={messages} />
          <Composer
            status={status}
            planMode={planMode}
            activityLabel={activityLabel}
            activityPhase={activityPhase}
            activityToolName={activity?.toolName}
            activityDetails={activity?.details}
            resumeTargetId={resumeTargetId}
            onSubmit={(text) => {
              sendMessage(text);
            }}
            onTogglePlanMode={setPlanMode}
          />
        </main>
      </div>

      {isNarrow && drawerOpen ? (
        <div className="absolute inset-0 z-20 flex">
          <button
            type="button"
            aria-label="Close session drawer"
            className="w-1/3 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="h-full w-2/3 min-w-[280px]">{sidebar}</div>
        </div>
      ) : null}

      <ProviderPicker
        open={isProviderPickerOpen}
        providers={providers}
        activeProvider={activeProvider}
        activeModel={activeModel}
        onSwitchProvider={(provider, model) => {
          switchProvider(provider, model);
        }}
        onOpenChange={(open) => setIsProviderPickerOpen(open)}
      />
    </div>
  );
}

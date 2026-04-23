import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GuiInboundFrame, GuiSessionListResponse } from "@kilnai/gateway-contracts";
import { GuiGatewayClient } from "../api/client.js";
import { useGuiWs } from "../lib/use-gui-ws.js";
import { waitForGateway } from "../lib/wait-for-gateway.js";
import { useSessionStore } from "../lib/session-store.js";
import { SessionList } from "./session-list.js";
import { Transcript } from "./transcript.js";
import { Composer } from "./composer.js";
import { CommandPalette, type CommandPaletteItem } from "./command-palette.js";
import { ErrorBanner } from "./error-banner.js";
import { ConnectionStatus } from "./connection-status.js";
import { ThemeSwitcher } from "./theme-switcher.js";
import { ProviderPicker } from "./provider-picker.js";
import { ProviderStatus } from "./provider-status.js";
import { ApprovalQueue } from "./approval-queue.js";
import { ToolCallLog } from "./tool-call-log.js";
import { SessionTelemetry } from "./session-telemetry.js";
import { useUiStore } from "../lib/ui-store.js";

const GATEWAY_BASE = "/gui-api";
const NARROW_LAYOUT_QUERY = "(max-width: 1024px)";

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

async function fetchSessions(): Promise<GuiSessionListResponse["sessions"]> {
  const response = await fetch(`${GATEWAY_BASE}/sessions`, {
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
  const [paletteMode, setPaletteMode] = useState<"root" | "theme">("root");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_LAYOUT_QUERY).matches);
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
  const sessionCostUsd = useSessionStore((state) => state.sessionCostUsd);
  const inputTokens = useSessionStore((state) => state.inputTokens);
  const outputTokens = useSessionStore((state) => state.outputTokens);
  const perProviderUsage = useSessionStore((state) => state.perProviderUsage);
  const runtimeContinuity = useSessionStore((state) => {
    if (!state.activeProvider) return null;
    return state.runtimeContinuityByProvider[state.activeProvider] ?? null;
  });
  const changedFiles = useSessionStore((state) => state.changedFiles);
  const approvalQueue = useSessionStore((state) => state.approvalQueue);
  const toolCallLog = useSessionStore((state) => state.toolCallLog);
  const activityPhase = useSessionStore((state) => state.activityPhase);
  const setConnectionStatus = useSessionStore((state) => state.setConnectionStatus);
  const setSender = useSessionStore((state) => state.setSender);
  const setSessionList = useSessionStore((state) => state.setSessionList);
  const setSelectedSessionId = useSessionStore((state) => state.setSelectedSessionId);
  const viewSessionDetail = useSessionStore((state) => state.viewSessionDetail);
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
  const setTheme = useUiStore((state) => state.setTheme);

  const closePalette = () => {
    setIsPaletteOpen(false);
    setPaletteMode("root");
    setPaletteQuery("");
  };

  const openPalette = (mode: "root" | "theme" = "root") => {
    setPaletteMode(mode);
    setPaletteQuery("");
    setIsPaletteOpen(true);
  };

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
    const media = window.matchMedia(NARROW_LAYOUT_QUERY);
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
    if (!isNarrow || !drawerOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen, isNarrow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (isPaletteOpen) {
          closePalette();
          return;
        }
        openPalette("root");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setIsProviderPickerOpen(true);
      }
      if (event.key === "Escape") {
        closePalette();
        setDrawerOpen(false);
        setIsProviderPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPaletteOpen]);

  const wsUrl = useMemo(() => toWsUrl("/gui/ws"), []);
  const gatewayClient = useMemo(() => new GuiGatewayClient(window.location.origin), []);

  useEffect(() => {
    const notifyWindowClosed = () => {
      gatewayClient.notifyWindowClosed();
    };
    window.addEventListener("pagehide", notifyWindowClosed);
    window.addEventListener("beforeunload", notifyWindowClosed);
    return () => {
      window.removeEventListener("pagehide", notifyWindowClosed);
      window.removeEventListener("beforeunload", notifyWindowClosed);
    };
  }, [gatewayClient]);

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
    queryKey: ["gui", "sessions", turnCounter],
    queryFn: fetchSessions,
    enabled: gatewayReady,
  });

  const dashboardQuery = useQuery({
    queryKey: ["gui", "dashboard", gatewayReady ? "ready" : "waiting"],
    queryFn: async () => gatewayClient.loadDashboard(),
    enabled: gatewayReady,
    refetchInterval: 2_000,
  });
  const sessionDetailQuery = useQuery({
    queryKey: ["gui", "session-detail", selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) {
        return null;
      }
      return gatewayClient.loadSessionDetail(selectedSessionId);
    },
    enabled: gatewayReady && Boolean(selectedSessionId),
  });

  useEffect(() => {
    if (!gatewayReady || turnCounter === 0) {
      return;
    }
    void dashboardQuery.refetch();
  }, [dashboardQuery, gatewayReady, turnCounter]);

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

  useEffect(() => {
    if (sessionDetailQuery.data) {
      viewSessionDetail(sessionDetailQuery.data);
    }
  }, [sessionDetailQuery.data, viewSessionDetail]);

  useEffect(() => {
    if (sessionDetailQuery.error) {
      setErrorBanner("Could not load session transcript.");
    }
  }, [sessionDetailQuery.error, setErrorBanner]);

  const activityLabel = mapActivityLabel(activity);
  const resumeInfo = activeProvider
    ? dashboardQuery.data?.resumeInfoByProvider?.[activeProvider] ?? null
    : null;
  const workingDirectory = dashboardQuery.data?.workingDirectory;
  const domainLabel = dashboardQuery.data?.domainLabel;
  const persistThemePreference = (theme: "kiln-dark" | "kiln-light" | "system-follow") => {
    void gatewayClient.saveThemePreference(theme);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("theme", theme);
    window.history.replaceState({}, "", nextUrl.toString());
  };
  const themeCommands: readonly CommandPaletteItem[] = [
    {
      id: "theme-dark",
      trigger: "theme dark",
      title: "Dark theme",
      description: "Apply kiln-dark immediately.",
      keywords: ["dark", "theme", "kiln-dark"],
    },
    {
      id: "theme-light",
      trigger: "theme light",
      title: "Light theme",
      description: "Apply kiln-light immediately.",
      keywords: ["light", "theme", "kiln-light"],
    },
    {
      id: "theme-system",
      trigger: "theme system",
      title: "System theme",
      description: "Follow the OS preference.",
      keywords: ["system", "theme", "system-follow"],
    },
  ];
  const rootCommands: readonly CommandPaletteItem[] = [
    {
      id: "new-session",
      trigger: "new session",
      title: "New Session",
      description: "Reset the current conversation and start clean.",
      keywords: ["session", "reset", "new"],
    },
    {
      id: "theme",
      trigger: "theme",
      title: "Theme",
      description: "Open the theme picker commands.",
      keywords: ["appearance", "dark", "light"],
    },
    {
      id: "provider",
      trigger: "provider",
      title: "Provider",
      description: "Open the provider and model picker.",
      keywords: ["model", "routing"],
    },
  ];
  const paletteCommands = paletteMode === "theme" ? themeCommands : rootCommands;

  const executePaletteCommand = (command: CommandPaletteItem) => {
    switch (command.id) {
      case "new-session":
        sendClear();
        setSelectedSessionId(null);
        closePalette();
        return;
      case "theme":
        setPaletteMode("theme");
        setPaletteQuery("");
        return;
      case "provider":
        setIsProviderPickerOpen(true);
        closePalette();
        return;
      case "theme-dark":
        setTheme("kiln-dark");
        persistThemePreference("kiln-dark");
        closePalette();
        return;
      case "theme-light":
        setTheme("kiln-light");
        persistThemePreference("kiln-light");
        closePalette();
        return;
      case "theme-system":
        setTheme("system-follow");
        persistThemePreference("system-follow");
        closePalette();
        return;
      default:
        closePalette();
    }
  };

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
      onSelect={(sessionId) => setSelectedSessionId(sessionId)}
      onStartNewSession={() => {
        sendClear();
        setSelectedSessionId(null);
        setDrawerOpen(false);
      }}
    />
  );

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

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
            aria-controls="session-drawer"
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? "Hide session drawer" : "Open session drawer"}
            onClick={() => setDrawerOpen((open) => !open)}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            {drawerOpen ? "Close Sessions" : "Sessions"}
          </button>
        ) : null}
        <p className="text-sm font-semibold">Kiln GUI</p>
        <ConnectionStatus state={wsState} />
        <ProviderStatus
          onOpenPicker={() => setIsProviderPickerOpen(true)}
          domainLabel={domainLabel}
          workingDirectory={workingDirectory}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              sendClear();
              setSelectedSessionId(null);
              closePalette();
            }}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            New Session
          </button>
          <button
            type="button"
            onClick={() => {
              if (isPaletteOpen) {
                closePalette();
                return;
              }
              openPalette("root");
            }}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            Commands
          </button>
          <ThemeSwitcher onThemeSelected={persistThemePreference} />
        </div>
      </header>

      <CommandPalette
        open={isPaletteOpen}
        title={paletteMode === "theme" ? "Theme Commands" : "Command Palette"}
        placeholder={paletteMode === "theme" ? "Filter themes…" : "Filter commands…"}
        query={paletteQuery}
        commands={paletteCommands}
        canGoBack={paletteMode === "theme"}
        onQueryChange={setPaletteQuery}
        onExecute={executePaletteCommand}
        onOpenChange={(open) => {
          if (!open) {
            closePalette();
          }
        }}
        onBack={() => {
          setPaletteMode("root");
          setPaletteQuery("");
        }}
      />

      <div className="flex min-h-0 flex-1">
        {!isNarrow ? (
          <div className="w-[320px] min-w-[280px] max-w-[360px]">{sidebar}</div>
        ) : null}
        <main className="flex min-h-0 flex-1 flex-col">
          <SessionTelemetry
            status={status}
            activeProvider={activeProvider}
            turnCounter={turnCounter}
            sessionCostUsd={sessionCostUsd}
            inputTokens={inputTokens}
            outputTokens={outputTokens}
            perProviderUsage={perProviderUsage}
            resumeInfo={resumeInfo}
            runtimeContinuity={runtimeContinuity}
            changedFiles={changedFiles}
            fieldTelemetry={dashboardQuery.data?.telemetry ?? null}
          />
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
            onEmptySubmit={() => {
              if (selectedSessionId) {
                setResume(selectedSessionId);
              }
            }}
            onTogglePlanMode={setPlanMode}
            onOpenCommandPalette={() => openPalette("root")}
          />
        </main>
      </div>

      {isNarrow && drawerOpen ? (
        <div className="fixed inset-0 z-20 flex bg-black/45">
          <button
            type="button"
            aria-label="Close session drawer backdrop"
            className="min-w-0 flex-1"
            onClick={closeDrawer}
          />
          <div
            id="session-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Sessions drawer"
            className="flex h-full w-[min(26rem,calc(100vw-3rem))] max-w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-background-panel)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Sessions</p>
                <p className="text-xs text-[var(--color-text-muted)]">History moves into a drawer on narrow windows.</p>
              </div>
              <button
                type="button"
                aria-label="Close session drawer"
                onClick={closeDrawer}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1">{sidebar}</div>
          </div>
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

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";
import { GuiGatewayClient } from "../api/client.js";
import { useGuiWs } from "../lib/use-gui-ws.js";
import { useSessionStore } from "../lib/session-store.js";
import { deriveChangedFiles, derivePendingApprovals, deriveRuntimeContinuity } from "../lib/session-store.js";
import { SessionList } from "./session-list.js";
import { WorkspacePanel } from "./workspace-panel.js";
import { ChangedFilesPanel } from "./changed-files-panel.js";
import { ApprovalsPanel } from "./approvals-panel.js";
import { Transcript } from "./transcript.js";
import { Composer } from "./composer.js";
import { CommandPalette, type CommandPaletteItem } from "./command-palette.js";
import { ErrorBanner } from "./error-banner.js";
import { ConnectionStatus } from "./connection-status.js";
import { ThemeSwitcher } from "./theme-switcher.js";
import { ProviderPicker } from "./provider-picker.js";
import { ProviderStatus } from "./provider-status.js";
import { SessionTelemetry } from "./session-telemetry.js";
import { useUiStore } from "../lib/ui-store.js";
import { Button } from "@/components/ui/button";

const NARROW_LAYOUT_QUERY = "(max-width: 1024px)";
const PROVIDER_SWITCH_WAIT_TIMEOUT_MS = 5_500;

function KilnMark() {
  return (
    <div className="grid size-9 place-items-center rounded-lg text-foreground" aria-hidden="true">
      <span className="grid gap-1">
        <span className="block h-px w-4 rounded-full bg-current opacity-35" />
        <span className="block h-px w-3 rounded-full bg-current opacity-80" />
        <span className="block h-px w-4 rounded-full bg-current opacity-55" />
        <span className="block h-px w-2 rounded-full bg-current" />
      </span>
    </div>
  );
}

type SidebarMode = "sessions" | "workspace" | "changed" | "approvals";

function ModeIcon(props: { readonly mode: SidebarMode }) {
  const strokeProps = {
    stroke: "currentColor",
    strokeWidth: 1.4,
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  if (props.mode === "workspace") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 5 L6 5 L7 6.5 L13.5 6.5 L13.5 12.5 L2.5 12.5 Z" {...strokeProps} />
        <path d="M5 9 L11 9" {...strokeProps} opacity="0.6" />
      </svg>
    );
  }
  if (props.mode === "changed") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="2.8" width="11" height="10.4" rx="1.2" {...strokeProps} />
        <path d="M6 6 L10 6 M8 4 L8 8" {...strokeProps} />
        <path d="M6 11 L10 11" {...strokeProps} />
      </svg>
    );
  }
  if (props.mode === "approvals") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 3.5 L2.5 3.5 L2.5 12.5 L4 12.5" {...strokeProps} />
        <path d="M12 3.5 L13.5 3.5 L13.5 12.5 L12 12.5" {...strokeProps} />
        <path d="M5.5 8.3 L7.3 10 L10.5 6.2" {...strokeProps} />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="2.2" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="6.9" width="7.5" height="2.2" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="10.3" width="9" height="2.2" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function SidebarRailButton(props: {
  readonly mode: SidebarMode;
  readonly label: string;
  readonly shortcut: string;
  readonly active: boolean;
  readonly count?: number;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      aria-label={props.label}
      disabled={props.disabled}
      title={`${props.label} ${props.shortcut}${props.disabled ? " · coming next" : ""}`}
      onClick={props.onClick}
      className={[
        "relative grid size-9 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        props.active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/45 hover:text-foreground",
        props.disabled ? "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted-foreground" : "",
      ].join(" ")}
    >
      {props.active ? <span className="absolute -left-2 top-2 bottom-2 w-0.5 rounded-r-full bg-foreground" /> : null}
      <ModeIcon mode={props.mode} />
      {props.count && props.count > 0 ? (
        <span className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full border border-border bg-card px-1 text-center font-mono text-[9px] leading-3 text-muted-foreground">
          {props.count}
        </span>
      ) : null}
    </button>
  );
}

function CollapseIcon(props: { readonly expanded: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d={props.expanded ? "M9 3 L5 7 L9 11" : "M5 3 L9 7 L5 11"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LeftRail(props: {
  readonly activeMode: SidebarMode;
  readonly sessionCount: number;
  readonly changedCount: number;
  readonly approvalCount: number;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly onSelectMode: (mode: SidebarMode) => void;
}) {
  return (
    <nav
      aria-label="Operator modes"
      className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-border/70 bg-card px-0 py-2"
    >
      <KilnMark />
      <div className="h-2" />
      <SidebarRailButton
        mode="sessions"
        label="Sessions"
        shortcut="Ctrl+1"
        active={props.activeMode === "sessions"}
        count={props.sessionCount}
        onClick={() => {
          if (!props.expanded) {
            props.onToggleExpanded();
          }
          props.onSelectMode("sessions");
        }}
      />
      <SidebarRailButton
        mode="workspace"
        label="Workspace"
        shortcut="Ctrl+2"
        active={props.activeMode === "workspace"}
        onClick={() => {
          if (!props.expanded) {
            props.onToggleExpanded();
          }
          props.onSelectMode("workspace");
        }}
      />
      <SidebarRailButton
        mode="changed"
        label="Changed files"
        shortcut="Ctrl+3"
        active={props.activeMode === "changed"}
        count={props.changedCount}
        onClick={() => {
          if (!props.expanded) {
            props.onToggleExpanded();
          }
          props.onSelectMode("changed");
        }}
      />
      <SidebarRailButton
        mode="approvals"
        label="Approvals"
        shortcut="Ctrl+4"
        active={props.activeMode === "approvals"}
        count={props.approvalCount}
        onClick={() => {
          if (!props.expanded) {
            props.onToggleExpanded();
          }
          props.onSelectMode("approvals");
        }}
      />
      <div className="flex-1" />
      <button
        type="button"
        aria-label={props.expanded ? "Collapse sidebar" : "Expand sidebar"}
        title={props.expanded ? "Collapse sidebar" : "Expand sidebar"}
        onClick={props.onToggleExpanded}
        className="grid size-9 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-secondary/45 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CollapseIcon expanded={props.expanded} />
      </button>
      <div className="grid size-7 place-items-center rounded-full border border-border font-mono text-[10px] text-muted-foreground">
        rv
      </div>
    </nav>
  );
}

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

function waitForProviderSwitchResolution(provider: string, model: string | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + PROVIDER_SWITCH_WAIT_TIMEOUT_MS;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
      }
      callback();
    };

    const poll = () => {
      const state = useSessionStore.getState();
      if (!state.providerSwitching) {
        if (state.activeProvider === provider && state.activeModel === model) {
          settle(resolve);
          return;
        }
        settle(() => {
          reject(new Error(state.errorBanner ?? "Provider switch failed."));
        });
        return;
      }
      if (Date.now() >= deadline) {
        settle(() => {
          reject(new Error("Provider switch timed out. Please retry."));
        });
        return;
      }
      pollTimeoutId = setTimeout(poll, 50);
    };

    poll();
  });
}

export function AppShell() {
  const [gatewayReady, setGatewayReady] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayAttempt, setGatewayAttempt] = useState(0);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"root" | "theme">("root");
  const [palettePlacement, setPalettePlacement] = useState<"global" | "composer">("global");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_LAYOUT_QUERY).matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("sessions");

  const status = useSessionStore((state) => state.status);
  const timelineEntries = useSessionStore((state) => state.timelineEntries);
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
  const activityPhase = useSessionStore((state) => state.activityPhase);
  const setConnectionStatus = useSessionStore((state) => state.setConnectionStatus);
  const setSender = useSessionStore((state) => state.setSender);
  const setSessionList = useSessionStore((state) => state.setSessionList);
  const setSelectedSessionId = useSessionStore((state) => state.setSelectedSessionId);
  const viewSessionDetail = useSessionStore((state) => state.viewSessionDetail);
  const setErrorBanner = useSessionStore((state) => state.setErrorBanner);
  const clearErrorBanner = useSessionStore((state) => state.clearErrorBanner);
  const onWelcome = useSessionStore((state) => state.onWelcome);
  const onProvidersRefreshed = useSessionStore((state) => state.onProvidersRefreshed);
  const onSessionEvent = useSessionStore((state) => state.onSessionEvent);
  const onDone = useSessionStore((state) => state.onDone);
  const onError = useSessionStore((state) => state.onError);
  const onCleared = useSessionStore((state) => state.onCleared);
  const onProviderChanged = useSessionStore((state) => state.onProviderChanged);
  const onExecConfirmed = useSessionStore((state) => state.onExecConfirmed);
  const onActivityPhase = useSessionStore((state) => state.onActivityPhase);
  const sendApprovalResponse = useSessionStore((state) => state.sendApprovalResponse);
  const sendMessage = useSessionStore((state) => state.sendMessage);
  const sendClear = useSessionStore((state) => state.sendClear);
  const setPlanMode = useSessionStore((state) => state.setPlanMode);
  const switchProvider = useSessionStore((state) => state.switchProvider);
  const setResume = useSessionStore((state) => state.setResume);
  const disconnect = useSessionStore((state) => state.disconnect);
  const setTheme = useUiStore((state) => state.setTheme);
  const gatewayClient = useMemo(() => new GuiGatewayClient(window.location.origin), []);
  const changedFiles = useMemo(() => deriveChangedFiles(timelineEntries), [timelineEntries]);
  const runtimeContinuity = useMemo(() => deriveRuntimeContinuity(timelineEntries, activeProvider), [activeProvider, timelineEntries]);
  const pendingApprovals = useMemo(() => derivePendingApprovals(timelineEntries), [timelineEntries]);
  const approvalCount = pendingApprovals.length;

  const closePalette = () => {
    setIsPaletteOpen(false);
    setPaletteMode("root");
    setPaletteQuery("");
  };

  const openPalette = (mode: "root" | "theme" = "root", placement: "global" | "composer" = "global") => {
    setPaletteMode(mode);
    setPalettePlacement(placement);
    setPaletteQuery("");
    setIsPaletteOpen(true);
  };

  useEffect(() => {
    let cancelled = false;
    setGatewayReady(false);
    setGatewayError(null);
    void gatewayClient.waitForHealth({ timeoutMs: 3_000 })
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
  }, [gatewayAttempt, gatewayClient]);

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
      if ((event.ctrlKey || event.metaKey) && event.key === "1") {
        event.preventDefault();
        setSidebarMode("sessions");
        if (!isNarrow) {
          setSidebarExpanded(true);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "2") {
        event.preventDefault();
        setSidebarMode("workspace");
        if (!isNarrow) {
          setSidebarExpanded(true);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "3") {
        event.preventDefault();
        setSidebarMode("changed");
        if (!isNarrow) {
          setSidebarExpanded(true);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "4") {
        event.preventDefault();
        setSidebarMode("approvals");
        if (!isNarrow) {
          setSidebarExpanded(true);
        }
      }
      if (event.key === "Escape") {
        closePalette();
        setDrawerOpen(false);
        setIsProviderPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isNarrow, isPaletteOpen]);

  const wsUrl = useMemo(() => toWsUrl("/gui/ws"), []);

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
        } else if (frame.type === "session_event") {
          onSessionEvent(frame.event);
        } else if (frame.type === "done") {
          onDone(frame);
        } else if (frame.type === "error") {
        onError(frame);
      } else if (frame.type === "cleared") {
        onCleared();
      } else if (frame.type === "provider_changed") {
        onProviderChanged(frame);
      } else if (frame.type === "providers_refreshed") {
        onProvidersRefreshed(frame.providers);
      } else if (frame.type === "exec_confirmed") {
        onExecConfirmed();
        } else if (frame.type === "thinking") {
          setConnectionStatus("running");
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
    setSender(wsState === "open" ? send : null);
    return () => {
      setSender(null);
      disconnect();
    };
  }, [disconnect, send, setSender, wsState]);

  const sessionsQuery = useQuery({
    queryKey: ["gui", "sessions", turnCounter],
    queryFn: async () => gatewayClient.loadSessions(),
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

  useEffect(() => {
    if (dashboardQuery.error) {
      setErrorBanner("Could not load dashboard state.");
    }
  }, [dashboardQuery.error, setErrorBanner]);

  useEffect(() => {
    if (!dashboardQuery.error && dashboardQuery.data && errorBanner === "Could not load dashboard state.") {
      clearErrorBanner();
    }
  }, [clearErrorBanner, dashboardQuery.data, dashboardQuery.error, errorBanner]);

  useEffect(() => {
    if (!dashboardQuery.error && dashboardQuery.data) {
      onProvidersRefreshed(dashboardQuery.data.providers);
    }
  }, [dashboardQuery.data, dashboardQuery.error, onProvidersRefreshed]);

  const activityLabel = mapActivityLabel(activity);
  const dashboardData = dashboardQuery.error ? undefined : dashboardQuery.data;
  const resumeInfo = activeProvider
    ? dashboardData?.resumeInfoByProvider?.[activeProvider] ?? null
    : null;
  const workingDirectory = dashboardData?.workingDirectory;
  const domainLabel = dashboardData?.domainLabel;
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

  const startNewSession = () => {
    sendClear();
    setSelectedSessionId(null);
    setDrawerOpen(false);
  };
  const selectedSessionMeta = sessionDetailQuery.data?.meta ?? null;

  const sidebar = sidebarMode === "sessions"
    ? (
      <SessionList
        sessions={sessionList}
        selectedSessionId={selectedSessionId}
        resumeTargetId={resumeTargetId}
        onSelect={(sessionId) => setSelectedSessionId(sessionId)}
        onStartNewSession={startNewSession}
      />
    ) : sidebarMode === "workspace"
      ? (
        <WorkspacePanel
          domainLabel={domainLabel}
          gatewayWorkingDirectory={workingDirectory}
          workspaceTree={dashboardData?.workspaceTree}
          selectedSessionId={selectedSessionId}
          sessionMeta={selectedSessionMeta}
          activeProvider={activeProvider}
          activeModel={activeModel}
          onStartNewSession={startNewSession}
        />
      ) : sidebarMode === "changed"
        ? (
          <ChangedFilesPanel
            files={changedFiles}
            onStartNewSession={startNewSession}
          />
        )
        : (
          <ApprovalsPanel
            approvals={pendingApprovals}
            onApprove={(sessionId) => sendApprovalResponse(true, undefined, sessionId)}
            onDeny={(sessionId) => sendApprovalResponse(false, undefined, sessionId)}
            onStartNewSession={startNewSession}
          />
        );

  const closeDrawer = () => {
    setDrawerOpen(false);
  };
  const activeSession = sessionList.find((session) => session.id === selectedSessionId) ?? null;
  const topBarTitle = activeSession?.title ?? activeSession?.taskSummary ?? "New session";
  const tokenTotal = inputTokens + outputTokens;
  const drawerTitle = sidebarMode === "sessions"
    ? "Sessions"
    : sidebarMode === "workspace"
      ? "Workspace"
      : sidebarMode === "changed"
        ? "Changed Files"
        : "Approvals";
  const drawerDescription = sidebarMode === "sessions"
    ? "History moves into a drawer on narrow windows."
    : sidebarMode === "workspace"
      ? "Workspace metadata moves into a drawer on narrow windows."
    : sidebarMode === "changed"
      ? "Changed files move into a drawer on narrow windows."
      : "Approval requests move into a drawer on narrow windows.";
  const drawerAriaLabel = sidebarMode === "sessions"
    ? "session drawer"
    : sidebarMode === "workspace"
      ? "workspace drawer"
      : sidebarMode === "changed"
        ? "changed files drawer"
        : "approvals drawer";

  return (
    <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,color-mix(in_srgb,var(--color-accent)_10%,transparent),transparent_28%),linear-gradient(180deg,color-mix(in_srgb,var(--color-background-element)_30%,transparent),transparent_34%)]"
      />
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

      <CommandPalette
        open={isPaletteOpen}
        placement={palettePlacement}
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

      <div className="relative z-10 flex min-h-0 flex-1">
        {!isNarrow ? (
          <div className="flex min-h-0">
              <LeftRail
                activeMode={sidebarMode}
                sessionCount={sessionList.length}
                changedCount={changedFiles.length}
                approvalCount={approvalCount}
                expanded={sidebarExpanded}
                onToggleExpanded={() => setSidebarExpanded((expanded) => !expanded)}
                onSelectMode={setSidebarMode}
              />
            {sidebarExpanded ? (
              <div className="w-[296px] min-w-[296px] max-w-[296px]">{sidebar}</div>
            ) : null}
          </div>
        ) : null}
        <main className="flex min-h-0 flex-1 flex-col bg-background/65">
          <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/70 bg-card/70 px-4 backdrop-blur">
            {isNarrow ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-controls="session-drawer"
                aria-expanded={drawerOpen}
                aria-label={drawerOpen ? `Hide ${drawerAriaLabel}` : `Open ${drawerAriaLabel}`}
                onClick={() => setDrawerOpen((open) => !open)}
              >
                {drawerOpen ? `Close ${drawerTitle}` : drawerTitle}
              </Button>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">session</span>
              <span aria-hidden="true" className="text-muted-foreground/45">/</span>
              <span className="truncate text-sm font-semibold text-foreground">{topBarTitle}</span>
              {resumeTargetId ? (
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-accent)]">
                  <span className="size-1.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]" />
                  active
                </span>
              ) : null}
            </div>
            <div className="ml-auto hidden items-center gap-2 xl:flex">
              <span className="rounded-md border border-border/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                turns <span className="text-foreground">{turnCounter}</span>
              </span>
              <span className="rounded-md border border-border/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                tokens <span className="text-foreground">{tokenTotal.toLocaleString("en-US")}</span>
              </span>
              <span className="rounded-md border border-border/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                cost <span className="text-foreground">${sessionCostUsd.toFixed(4)}</span>
              </span>
            </div>
            <ConnectionStatus state={wsState} />
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setIsProviderPickerOpen(true)}
            >
              {activeProvider ?? "Provider"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label="New Session"
              onClick={() => {
                startNewSession();
                closePalette();
              }}
            >
              New
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              aria-expanded={isPaletteOpen}
              onClick={() => {
                if (isPaletteOpen) {
                  closePalette();
                  return;
                }
                openPalette("root");
              }}
            >
              Commands
            </Button>
            <ThemeSwitcher onThemeSelected={persistThemePreference} />
          </header>
          <div className="border-b border-border/60 bg-card/35 px-4 py-2 lg:hidden">
            <ProviderStatus
              onOpenPicker={() => setIsProviderPickerOpen(true)}
              domainLabel={domainLabel}
              workingDirectory={workingDirectory}
            />
          </div>
          <SessionTelemetry
            activeProvider={activeProvider}
            resumeInfo={resumeInfo}
            runtimeContinuity={runtimeContinuity}
            changedFiles={changedFiles}
            fieldTelemetry={dashboardData?.telemetry ?? null}
          />
          <Transcript
            entries={timelineEntries}
            onApprove={(sessionId) => sendApprovalResponse(true, undefined, sessionId)}
            onDeny={(sessionId) => sendApprovalResponse(false, undefined, sessionId)}
          />
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
            onOpenCommandPalette={() => openPalette("root", "composer")}
          />
        </main>
      </div>

      {isNarrow && drawerOpen ? (
        <div className="fixed inset-0 z-20 flex bg-black/45 backdrop-blur-sm">
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
            aria-label={drawerTitle === "Sessions"
              ? "Sessions drawer"
              : drawerTitle === "Workspace"
                ? "Workspace drawer"
                : drawerTitle === "Changed Files"
                  ? "Changed files drawer"
                  : "Approvals drawer"}
            className="flex h-full w-[min(26rem,calc(100vw-3rem))] max-w-full flex-col border-l border-border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{drawerTitle}</p>
                <p className="text-xs text-muted-foreground">{drawerDescription}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Close ${drawerAriaLabel}`}
                onClick={closeDrawer}
              >
                Close
              </Button>
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
        onSwitchProvider={async (provider, model) => {
          const normalizedModel = typeof model === "string" && model.trim().length > 0
            ? model.trim()
            : null;

          const started = switchProvider(provider, normalizedModel ?? undefined);
          if (!started) {
            const message = useSessionStore.getState().errorBanner ?? "Provider switch failed.";
            setErrorBanner(message);
            throw new Error(message);
          }

          try {
            await waitForProviderSwitchResolution(provider, normalizedModel);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Provider switch failed.";
            setErrorBanner(message);
            throw (error instanceof Error ? error : new Error(message));
          }
        }}
        onRefreshProviders={async () => {
          if (wsState === "open") {
            send({ type: "refresh_providers" });
          }
          await dashboardQuery.refetch();
        }}
        onOpenChange={(open) => setIsProviderPickerOpen(open)}
      />
    </div>
  );
}

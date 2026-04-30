import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  OPERATOR_THEME_LABELS,
  OPERATOR_THEME_NAMES,
  isOperatorThemeName,
  type GuiAppDescriptor,
  type GuiInboundFrame,
  type GuiMemoryLatticeGraphRequest,
  type GuiOutboundFrame,
  type GuiProviderReasoningEffort,
  type OperatorWorkspaceFileSnapshot,
  type OperatorWorkspaceTreeEntry,
  type OperatorThemeName,
} from "@kilnai/gateway-contracts";
import { GuiGatewayClient } from "../api/client.js";
import { useGuiWs } from "../lib/use-gui-ws.js";
import { useSessionStore } from "../lib/session-store.js";
import { deriveChangedFiles, derivePendingApprovals, deriveRuntimeContinuity } from "../lib/session-store.js";
import { SessionList } from "./session-list.js";
import { WorkspacePanel } from "./workspace-panel.js";
import { OperatorSurfaceTabs, type OperatorSurfaceKind } from "./operator-surface-tabs.js";
import { ChangedFilesPanel } from "./changed-files-panel.js";
import { ApprovalsPanel } from "./approvals-panel.js";
import { ActivityLogPanel } from "./activity-log-panel.js";
import { Transcript } from "./transcript.js";
import { Composer } from "./composer.js";
import { CommandPalette, type CommandPaletteItem } from "./command-palette.js";
import { ErrorBanner } from "./error-banner.js";
import { ConnectionStatus } from "./connection-status.js";
import { ThemeSwitcher } from "./theme-switcher.js";
import { ProviderPicker } from "./provider-picker.js";
import { ProviderStatus } from "./provider-status.js";
import { SessionTelemetry } from "./session-telemetry.js";
import { MemoryLatticePanel, MemoryLatticeSurface } from "./memory-lattice/memory-lattice-panel.js";
import { useUiStore } from "../lib/ui-store.js";
import { isActivityTimelineEntry, isConversationTimelineEntry } from "../lib/timeline-visibility.js";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FileDiff,
  Folder,
  MessagesSquare,
  Network,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NARROW_LAYOUT_QUERY = "(max-width: 1024px)";
const PROVIDER_SWITCH_WAIT_TIMEOUT_MS = 5_500;
const PROVIDER_AUTH_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const WORKSPACE_DOCUMENT_TAB_LIMIT = 8;

const REASONING_EFFORT_LABELS: Record<GuiProviderReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};
const EMPTY_REASONING_EFFORTS: readonly GuiProviderReasoningEffort[] = [];
const EMPTY_APP_DESCRIPTORS: readonly GuiAppDescriptor[] = [];

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

type SidebarMode = "sessions" | "workspace" | "changed" | "approvals" | "activity" | "memory";

const sidebarModeIcons: Record<SidebarMode, LucideIcon> = {
  sessions: MessagesSquare,
  workspace: Folder,
  changed: FileDiff,
  approvals: CheckCheck,
  activity: Activity,
  memory: Network,
};

function SidebarRailButton(props: {
  readonly mode: SidebarMode;
  readonly label: string;
  readonly shortcut: string;
  readonly active: boolean;
  readonly count?: number;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  const Icon = sidebarModeIcons[props.mode];
  return (
    <Button
      type="button"
      variant={props.active ? "secondary" : "ghost"}
      size="icon-lg"
      aria-current={props.active ? "page" : undefined}
      aria-label={props.label}
      disabled={props.disabled}
      title={`${props.label} ${props.shortcut}${props.disabled ? " · coming next" : ""}`}
      onClick={props.onClick}
      className={cn("relative text-muted-foreground", props.active && "text-foreground")}
    >
      {props.active ? <span className="absolute -left-2 top-2 bottom-2 w-0.5 rounded-r-full bg-foreground" /> : null}
      <Icon aria-hidden="true" />
      {props.count && props.count > 0 ? (
        <Badge
          variant="outline"
          className="absolute -right-1 -top-1 h-4 min-w-4 px-1 font-mono text-[9px] leading-none text-muted-foreground"
        >
          {props.count}
        </Badge>
      ) : null}
    </Button>
  );
}

function LeftRail(props: {
  readonly activeMode: SidebarMode;
  readonly sessionCount: number;
  readonly changedCount: number;
  readonly approvalCount: number;
  readonly activityCount: number;
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
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label={props.expanded ? "Collapse sidebar" : "Expand sidebar"}
        title={props.expanded ? "Collapse sidebar" : "Expand sidebar"}
        onClick={props.onToggleExpanded}
        className="text-muted-foreground"
      >
        {props.expanded ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </Button>
      <div className="h-1" />
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
      <SidebarRailButton
        mode="activity"
        label="Activity"
        shortcut="Ctrl+5"
        active={props.activeMode === "activity"}
        count={props.activityCount}
        onClick={() => {
          if (!props.expanded) {
            props.onToggleExpanded();
          }
          props.onSelectMode("activity");
        }}
      />
      <SidebarRailButton
        mode="memory"
        label="Memory"
        shortcut="Ctrl+6"
        active={props.activeMode === "memory"}
        onClick={() => {
          if (!props.expanded) {
            props.onToggleExpanded();
          }
          props.onSelectMode("memory");
        }}
      />
      <div className="flex-1" />
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

function waitForProviderAuthResolution(provider: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + PROVIDER_AUTH_WAIT_TIMEOUT_MS;
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
      if (!state.providerAuthenticating) {
        if (state.errorBanner) {
          settle(() => reject(new Error(state.errorBanner ?? "Provider authentication failed.")));
          return;
        }
        settle(resolve);
        return;
      }
      if (state.providerAuthTarget?.provider !== provider) {
        settle(() => reject(new Error("Provider authentication target changed.")));
        return;
      }
      if (Date.now() >= deadline) {
        settle(() => reject(new Error("Provider authentication timed out. Please retry.")));
        return;
      }
      pollTimeoutId = setTimeout(poll, 100);
    };

    poll();
  });
}

function RuntimeBootstrapGate(props: {
  readonly title: string;
  readonly detail: string;
  readonly error?: string | null;
  readonly onRetry?: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-6">
      <section
        role="status"
        aria-label="Runtime bootstrap"
        aria-live="polite"
        className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-background-panel)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
      >
        <div className="flex items-start gap-4">
          <div className="mt-1 grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background">
            <span className="size-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{props.title}</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{props.error ?? props.detail}</p>
            {props.error && props.onRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={props.onRetry}
              >
                Retry
              </Button>
            ) : (
              <div className="mt-4 h-2 w-full overflow-hidden rounded bg-[var(--color-background-element)]">
                <div className="h-full w-1/3 animate-pulse rounded bg-[var(--color-accent)]" />
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function ReasoningEffortControl(props: {
  readonly value: GuiProviderReasoningEffort;
  readonly options: readonly GuiProviderReasoningEffort[];
  readonly onChange: (value: GuiProviderReasoningEffort) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value) {
          props.onChange(value);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label="Reasoning effort" className="min-w-24">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {props.options.map((effort) => (
            <SelectItem key={effort} value={effort}>
              {REASONING_EFFORT_LABELS[effort]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function AppGatewayTargetSelector(props: {
  readonly apps: readonly GuiAppDescriptor[];
  readonly selectedAppName: string | null;
  readonly selectedTenantId: string | null;
  readonly onSelectApp: (appName: string) => void;
  readonly onSelectTenant: (tenantId: string) => void;
}) {
  if (props.apps.length === 0) {
    return null;
  }

  const selectedApp = props.apps.find((app) => app.name === props.selectedAppName) ?? props.apps[0] ?? null;
  const tenantOptions = selectedApp?.runtime === "tenant"
    ? selectedApp.tenants?.filter((tenant) => tenant.enabled) ?? []
    : [];

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select
        value={props.selectedAppName ?? selectedApp?.name ?? ""}
        onValueChange={(value) => {
          if (value) {
            props.onSelectApp(value);
          }
        }}
      >
        <SelectTrigger size="sm" aria-label="App" className="min-w-32 max-w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            {props.apps.map((app) => (
              <SelectItem key={app.name} value={app.name}>
                {app.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {tenantOptions.length > 0 ? (
        <Select
          value={props.selectedTenantId ?? tenantOptions[0]?.tenantId ?? ""}
          onValueChange={(value) => {
            if (value) {
              props.onSelectTenant(value);
            }
          }}
        >
          <SelectTrigger size="sm" aria-label="Tenant" className="min-w-32 max-w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {tenantOptions.map((tenant) => (
                <SelectItem key={tenant.tenantId} value={tenant.tenantId}>
                  {tenant.label ?? tenant.tenantId}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const [gatewayReady, setGatewayReady] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayAttempt, setGatewayAttempt] = useState(0);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"root" | "theme">("root");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [composerCommandOpen, setComposerCommandOpen] = useState(false);
  const [composerCommandQuery, setComposerCommandQuery] = useState("");
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_LAYOUT_QUERY).matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("sessions");
  const [reasoningEffort, setReasoningEffort] = useState<GuiProviderReasoningEffort | null>(null);
  const [selectedAppName, setSelectedAppName] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [workspaceDocuments, setWorkspaceDocuments] = useState<readonly OperatorWorkspaceFileSnapshot[]>([]);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [workspaceDocumentLoadingPath, setWorkspaceDocumentLoadingPath] = useState<string | null>(null);
  const [workspaceDocumentError, setWorkspaceDocumentError] = useState<string | null>(null);
  const [activeSurface, setActiveSurface] = useState<OperatorSurfaceKind>("chat");
  const [memorySurfaceOpen, setMemorySurfaceOpen] = useState(false);
  const [memoryFilters, setMemoryFilters] = useState<GuiMemoryLatticeGraphRequest>({ depth: 0, limit: 25 });
  const [selectedMemoryRecordId, setSelectedMemoryRecordId] = useState<string | null>(null);
  const [memoryLatticeInvalidationTick, setMemoryLatticeInvalidationTick] = useState(0);
  const sendRef = useRef<((frame: GuiOutboundFrame) => void) | null>(null);

  const status = useSessionStore((state) => state.status);
  const timelineEntries = useSessionStore((state) => state.timelineEntries);
  const providers = useSessionStore((state) => state.providers);
  const providerDiscovery = useSessionStore((state) => state.providerDiscovery);
  const planMode = useSessionStore((state) => state.planMode);
  const activity = useSessionStore((state) => state.activity);
  const errorBanner = useSessionStore((state) => state.errorBanner);
  const providerCatalogStatus = useSessionStore((state) => state.providerCatalogStatus);
  const providerCatalogError = useSessionStore((state) => state.providerCatalogError);
  const activeProvider = useSessionStore((state) => state.activeProvider);
  const activeModel = useSessionStore((state) => state.activeModel);
  const providerAuthenticating = useSessionStore((state) => state.providerAuthenticating);
  const providerAuthProvider = useSessionStore((state) => state.providerAuthTarget?.provider ?? null);
  const providerAuthMessage = useSessionStore((state) => state.providerAuthMessage);
  const providerAuthDetails = useSessionStore((state) => state.providerAuthDetails);
  const sessionList = useSessionStore((state) => state.sessionList);
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId);
  const resumeTargetId = useSessionStore((state) => state.resumeTargetId);
  const turnCounter = useSessionStore((state) => state.turnCounter);
  const activityPhase = useSessionStore((state) => state.activityPhase);
  const setConnectionStatus = useSessionStore((state) => state.setConnectionStatus);
  const setSender = useSessionStore((state) => state.setSender);
  const setSessionList = useSessionStore((state) => state.setSessionList);
  const setSelectedSessionId = useSessionStore((state) => state.setSelectedSessionId);
  const viewSessionDetail = useSessionStore((state) => state.viewSessionDetail);
  const setErrorBanner = useSessionStore((state) => state.setErrorBanner);
  const clearErrorBanner = useSessionStore((state) => state.clearErrorBanner);
  const markProviderCatalogRefreshing = useSessionStore((state) => state.markProviderCatalogRefreshing);
  const markProviderCatalogError = useSessionStore((state) => state.markProviderCatalogError);
  const onWelcome = useSessionStore((state) => state.onWelcome);
  const onProvidersRefreshed = useSessionStore((state) => state.onProvidersRefreshed);
  const onSessionEvent = useSessionStore((state) => state.onSessionEvent);
  const onDone = useSessionStore((state) => state.onDone);
  const onError = useSessionStore((state) => state.onError);
  const onCleared = useSessionStore((state) => state.onCleared);
  const onProviderChanged = useSessionStore((state) => state.onProviderChanged);
  const onProviderAuthStarted = useSessionStore((state) => state.onProviderAuthStarted);
  const onProviderAuthCompleted = useSessionStore((state) => state.onProviderAuthCompleted);
  const onProviderAuthFailed = useSessionStore((state) => state.onProviderAuthFailed);
  const onExecConfirmed = useSessionStore((state) => state.onExecConfirmed);
  const onActivityPhase = useSessionStore((state) => state.onActivityPhase);
  const sendApprovalResponse = useSessionStore((state) => state.sendApprovalResponse);
  const sendMessage = useSessionStore((state) => state.sendMessage);
  const sendClear = useSessionStore((state) => state.sendClear);
  const setPlanMode = useSessionStore((state) => state.setPlanMode);
  const switchProvider = useSessionStore((state) => state.switchProvider);
  const authenticateProvider = useSessionStore((state) => state.authenticateProvider);
  const setResume = useSessionStore((state) => state.setResume);
  const disconnect = useSessionStore((state) => state.disconnect);
  const setTheme = useUiStore((state) => state.setTheme);
  const gatewayClient = useMemo(() => new GuiGatewayClient(window.location.origin), []);
  const changedFiles = useMemo(() => deriveChangedFiles(timelineEntries), [timelineEntries]);
  const runtimeContinuity = useMemo(() => deriveRuntimeContinuity(timelineEntries, activeProvider), [activeProvider, timelineEntries]);
  const pendingApprovals = useMemo(() => derivePendingApprovals(timelineEntries), [timelineEntries]);
  const activityEntries = useMemo(() => timelineEntries.filter(isActivityTimelineEntry), [timelineEntries]);
  const conversationEntries = useMemo(() => timelineEntries.filter(isConversationTimelineEntry), [timelineEntries]);
  const approvalCount = pendingApprovals.length;
  const activeModelCapabilities = activeProvider && activeModel
    ? providerDiscovery.find((entry) => entry.provider === activeProvider)?.modelCapabilities?.[activeModel]
    : undefined;
  const reasoningEffortOptions = activeModelCapabilities?.supportedReasoningEfforts ?? EMPTY_REASONING_EFFORTS;
  const resolvedReasoningEffort = reasoningEffortOptions.length > 0
    ? (
      reasoningEffort && reasoningEffortOptions.includes(reasoningEffort)
        ? reasoningEffort
        : (activeModelCapabilities?.defaultReasoningEffort ?? reasoningEffortOptions[0]!)
    )
    : null;

  const openWorkspaceFile = async (entry: OperatorWorkspaceTreeEntry) => {
    setActiveSurface("workspace");
    setSelectedWorkspacePath(entry.path);
    setWorkspaceDocumentError(null);
    if (workspaceDocuments.some((file) => file.path === entry.path)) {
      return;
    }
    setWorkspaceDocumentLoadingPath(entry.path);
    try {
      const file = await gatewayClient.loadWorkspaceFile(entry.path);
      setWorkspaceDocuments((current) => [file, ...current.filter((item) => item.path !== file.path)].slice(0, WORKSPACE_DOCUMENT_TAB_LIMIT));
      setSelectedWorkspacePath(file.path);
    } catch (error) {
      setWorkspaceDocumentError(error instanceof Error ? error.message : "Could not load workspace file.");
    } finally {
      setWorkspaceDocumentLoadingPath(null);
    }
  };

  const closeWorkspaceFile = (path: string) => {
    const next = workspaceDocuments.filter((file) => file.path !== path);
    setWorkspaceDocuments(next);
    if (selectedWorkspacePath === path) {
      setSelectedWorkspacePath(next[0]?.path ?? null);
      if (next.length === 0 && activeSurface === "workspace") {
        setActiveSurface("chat");
      }
    }
  };

  useEffect(() => {
    if (reasoningEffortOptions.length === 0) {
      if (reasoningEffort !== null) {
        setReasoningEffort(null);
      }
      return;
    }
    if (!reasoningEffort || !reasoningEffortOptions.includes(reasoningEffort)) {
      setReasoningEffort(activeModelCapabilities?.defaultReasoningEffort ?? reasoningEffortOptions[0]!);
    }
  }, [activeModelCapabilities?.defaultReasoningEffort, reasoningEffort, reasoningEffortOptions]);

  const closePalette = () => {
    setIsPaletteOpen(false);
    setPaletteMode("root");
    setPaletteQuery("");
  };

  const closeComposerCommands = () => {
    setComposerCommandOpen(false);
    setComposerCommandQuery("");
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
          setIsPaletteOpen(false);
          setPaletteMode("root");
          setPaletteQuery("");
          return;
        }
        setComposerCommandOpen(false);
        setComposerCommandQuery("");
        setPaletteMode("root");
        setPaletteQuery("");
        setIsPaletteOpen(true);
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
      if ((event.ctrlKey || event.metaKey) && event.key === "5") {
        event.preventDefault();
        setSidebarMode("activity");
        if (!isNarrow) {
          setSidebarExpanded(true);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "6") {
        event.preventDefault();
        setSidebarMode("memory");
        if (!isNarrow) {
          setSidebarExpanded(true);
        }
      }
      if (event.key === "Escape") {
        setIsPaletteOpen(false);
        setPaletteMode("root");
        setPaletteQuery("");
        setComposerCommandOpen(false);
        setComposerCommandQuery("");
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
        } else if (frame.type === "operator_theme_set") {
          if (!isOperatorThemeName(frame.theme)) {
            sendRef.current?.({
              type: "operator_theme_set_result",
              requestId: frame.requestId,
              ok: false,
              error: `Unknown theme '${frame.theme}'.`,
            });
            return;
          }
          setTheme(frame.theme);
          if (frame.scope === "persisted") {
            persistThemePreference(frame.theme);
          }
          sendRef.current?.({
            type: "operator_theme_set_result",
            requestId: frame.requestId,
            ok: true,
            appliedTheme: frame.theme,
          });
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
      } else if (frame.type === "provider_auth_started") {
        onProviderAuthStarted(frame);
      } else if (frame.type === "provider_auth_completed") {
        onProviderAuthCompleted(frame);
        onProvidersRefreshed(frame.providers ?? useSessionStore.getState().providers, frame.providerDiscovery);
        void dashboardQuery.refetch();
      } else if (frame.type === "provider_auth_failed") {
        onProviderAuthFailed(frame);
      } else if (frame.type === "providers_refreshed") {
        onProvidersRefreshed(frame.providers, frame.providerDiscovery);
      } else if (frame.type === "execution_mode_transitioned") {
        onExecConfirmed();
        } else if (frame.type === "thinking") {
          setConnectionStatus("running");
        } else if (frame.type === "activity_phase") {
          onActivityPhase(frame);
        } else if (frame.type === "memory_lattice_invalidated") {
          setMemoryLatticeInvalidationTick((tick) => tick + 1);
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
    sendRef.current = wsState === "open" ? send : null;
    setSender(wsState === "open" ? send : null);
  }, [send, setSender, wsState]);

  useEffect(() => {
    return () => {
      setSender(null);
      disconnect();
    };
  }, [disconnect, setSender]);

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
  const memoryLatticeQuery = useQuery({
    queryKey: ["gui", "memory-lattice", memoryFilters, memoryLatticeInvalidationTick],
    queryFn: async () => gatewayClient.loadMemoryLatticeGraph(memoryFilters),
    enabled: gatewayReady && (sidebarMode === "memory" || memorySurfaceOpen),
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
    if (sessionDetailQuery.data && sessionDetailQuery.data.id === selectedSessionId) {
      viewSessionDetail(sessionDetailQuery.data);
    }
  }, [selectedSessionId, sessionDetailQuery.data, viewSessionDetail]);

  useEffect(() => {
    if (sessionDetailQuery.error) {
      setErrorBanner("Could not load session transcript.");
    }
  }, [sessionDetailQuery.error, setErrorBanner]);

  useEffect(() => {
    if (dashboardQuery.error) {
      setErrorBanner("Could not load dashboard state.");
      if (providerCatalogStatus !== "ready") {
        markProviderCatalogError("Could not load provider discovery.");
      }
    }
  }, [dashboardQuery.error, markProviderCatalogError, providerCatalogStatus, setErrorBanner]);

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

  useEffect(() => {
    const nodes = memoryLatticeQuery.data?.snapshot?.nodes ?? [];
    if (nodes.length === 0) {
      if (selectedMemoryRecordId !== null) {
        setSelectedMemoryRecordId(null);
      }
      return;
    }
    if (selectedMemoryRecordId && !nodes.some((node) => node.recordId === selectedMemoryRecordId)) {
      setSelectedMemoryRecordId(null);
    }
  }, [memoryLatticeQuery.data?.snapshot?.nodes, selectedMemoryRecordId]);

  const dashboardData = dashboardQuery.error ? undefined : dashboardQuery.data;
  const resumeInfo = activeProvider
    ? dashboardData?.resumeInfoByProvider?.[activeProvider] ?? null
    : null;
  const workingDirectory = dashboardData?.workingDirectory;
  const domainLabel = dashboardData?.domainLabel;
  const appDescriptors = dashboardData?.apps ?? EMPTY_APP_DESCRIPTORS;
  const runtimeAppDescriptors = useMemo(
    () => appDescriptors.filter((app) => app.runtimeCapable),
    [appDescriptors],
  );
  const selectedRuntimeApp = runtimeAppDescriptors.find((app) => app.name === selectedAppName) ?? null;

  useEffect(() => {
    if (runtimeAppDescriptors.length === 0) {
      if (selectedAppName !== null) {
        setSelectedAppName(null);
      }
      if (selectedTenantId !== null) {
        setSelectedTenantId(null);
      }
      return;
    }

    const dashboardAppName = dashboardData?.activeAppName;
    const nextAppName = selectedAppName && runtimeAppDescriptors.some((app) => app.name === selectedAppName)
      ? selectedAppName
      : dashboardAppName && runtimeAppDescriptors.some((app) => app.name === dashboardAppName)
        ? dashboardAppName
        : runtimeAppDescriptors[0]!.name;

    if (selectedAppName !== nextAppName) {
      setSelectedAppName(nextAppName);
    }

    const nextApp = runtimeAppDescriptors.find((app) => app.name === nextAppName);
    if (nextApp?.runtime !== "tenant") {
      if (selectedTenantId !== null) {
        setSelectedTenantId(null);
      }
      return;
    }

    const enabledTenants = nextApp.tenants?.filter((tenant) => tenant.enabled) ?? [];
    const dashboardTenantId = dashboardData?.activeTenantId;
    const nextTenantId = selectedTenantId && enabledTenants.some((tenant) => tenant.tenantId === selectedTenantId)
      ? selectedTenantId
      : dashboardTenantId && enabledTenants.some((tenant) => tenant.tenantId === dashboardTenantId)
        ? dashboardTenantId
        : enabledTenants[0]?.tenantId ?? null;

    if (selectedTenantId !== nextTenantId) {
      setSelectedTenantId(nextTenantId);
    }
  }, [
    dashboardData?.activeAppName,
    dashboardData?.activeTenantId,
    runtimeAppDescriptors,
    selectedAppName,
    selectedTenantId,
  ]);

  const persistThemePreference = (theme: OperatorThemeName) => {
    void gatewayClient.saveThemePreference(theme);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("theme", theme);
    window.history.replaceState({}, "", nextUrl.toString());
  };
  const themeCommands: readonly CommandPaletteItem[] = OPERATOR_THEME_NAMES.map((theme) => ({
    id: `theme:${theme}`,
    trigger: `theme ${theme}`,
    title: OPERATOR_THEME_LABELS[theme],
    description: `Apply ${theme}.`,
    keywords: ["theme", theme, OPERATOR_THEME_LABELS[theme].toLowerCase()],
  }));
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
  const runtimeBootstrapReady = gatewayReady && providerCatalogStatus === "ready";
  const bootstrapTitle = gatewayError || providerCatalogStatus === "error"
    ? "Kiln runtime needs attention"
    : "Starting Kiln runtime";
  const bootstrapDetail = !gatewayReady
    ? "Connecting to the local gateway."
    : wsState !== "open"
      ? "Opening the realtime session channel."
      : providerCatalogStatus === "refreshing"
        ? "Refreshing provider and model discovery."
        : "Loading provider and model discovery.";
  const bootstrapError = gatewayError ?? (
    providerCatalogStatus === "error" ? providerCatalogError ?? "Provider discovery failed." : null
  );
  const retryBootstrap = () => {
    clearErrorBanner();
    markProviderCatalogRefreshing();
    if (wsState === "open") {
      send({ type: "refresh_providers" });
    }
    void dashboardQuery.refetch();
    if (gatewayError) {
      setGatewayAttempt((count) => count + 1);
    }
  };

  const executePaletteCommand = (command: CommandPaletteItem) => {
    closeComposerCommands();
    switch (command.id) {
      case "new-session":
        sendClear();
        setSelectedSessionId(null);
        closePalette();
        return;
      case "theme":
        setPaletteMode("theme");
        setPaletteQuery("");
        setIsPaletteOpen(true);
        return;
      case "provider":
        setIsProviderPickerOpen(true);
        closePalette();
        return;
      default:
        if (command.id.startsWith("theme:")) {
          const theme = command.id.slice("theme:".length) as OperatorThemeName;
          if ((OPERATOR_THEME_NAMES as readonly string[]).includes(theme)) {
            setTheme(theme);
            persistThemePreference(theme);
          }
        }
        closePalette();
    }
  };

  if (!runtimeBootstrapReady) {
    return (
      <RuntimeBootstrapGate
        title={bootstrapTitle}
        detail={bootstrapDetail}
        error={bootstrapError}
        onRetry={bootstrapError ? retryBootstrap : undefined}
      />
    );
  }

  const startNewSession = () => {
    sendClear();
    setSelectedSessionId(null);
    setActiveSurface("chat");
    setDrawerOpen(false);
  };
  const selectedSessionMeta = sessionDetailQuery.data?.meta ?? null;
  const selectSidebarMode = (mode: SidebarMode) => {
    setSidebarMode(mode);
  };
  const openMemorySurface = () => {
    setMemorySurfaceOpen(true);
    setActiveSurface("memory");
    setSidebarMode("memory");
  };
  const closeMemorySurface = () => {
    setMemorySurfaceOpen(false);
    if (activeSurface === "memory") {
      setActiveSurface("chat");
    }
  };

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
          gatewayWorkingDirectory={workingDirectory}
          workspaceTree={dashboardData?.workspaceTree}
          workspaceClient={gatewayClient}
          worktreePath={selectedSessionMeta?.sessionLedger?.worktreePath ?? null}
          selectedFilePath={selectedWorkspacePath}
          onOpenFile={openWorkspaceFile}
        />
      ) : sidebarMode === "changed"
        ? (
          <ChangedFilesPanel
            files={changedFiles}
          />
        )
        : sidebarMode === "approvals"
          ? (
            <ApprovalsPanel
              approvals={pendingApprovals}
              onApprove={(sessionId) => sendApprovalResponse(true, undefined, sessionId)}
              onDeny={(sessionId) => sendApprovalResponse(false, undefined, sessionId)}
            />
          )
          : sidebarMode === "activity"
            ? (
              <ActivityLogPanel
                entries={timelineEntries}
              />
            )
            : (
              <MemoryLatticePanel
                filters={memoryFilters}
                response={memoryLatticeQuery.data ?? null}
                loading={Boolean(memoryLatticeQuery.isFetching)}
                error={memoryLatticeQuery.error instanceof Error ? memoryLatticeQuery.error : null}
                selectedRecordId={selectedMemoryRecordId}
                onFiltersChange={setMemoryFilters}
                onRefresh={() => void memoryLatticeQuery.refetch()}
                onSelectRecord={setSelectedMemoryRecordId}
                graphOpen={memorySurfaceOpen}
                onOpenGraph={openMemorySurface}
              />
            );

  const closeDrawer = () => {
    setDrawerOpen(false);
  };
  const activeSession = sessionList.find((session) => session.id === selectedSessionId) ?? null;
  const topBarTitle = activeSession?.title ?? activeSession?.taskSummary ?? "New session";
  const drawerTitle = sidebarMode === "sessions"
    ? "Sessions"
    : sidebarMode === "workspace"
      ? "Workspace"
      : sidebarMode === "changed"
        ? "Changed Files"
        : sidebarMode === "approvals"
          ? "Approvals"
          : sidebarMode === "activity"
            ? "Activity"
            : "Memory";
  const drawerDescription = sidebarMode === "sessions"
    ? "History moves into a drawer on narrow windows."
    : sidebarMode === "workspace"
      ? "Workspace metadata moves into a drawer on narrow windows."
      : sidebarMode === "changed"
        ? "Changed files move into a drawer on narrow windows."
        : sidebarMode === "approvals"
          ? "Approval requests move into a drawer on narrow windows."
          : sidebarMode === "activity"
            ? "Runtime activity moves into a drawer on narrow windows."
            : "Memory Lattice moves into a drawer on narrow windows.";
  const drawerAriaLabel = sidebarMode === "sessions"
    ? "session drawer"
    : sidebarMode === "workspace"
      ? "workspace drawer"
      : sidebarMode === "changed"
        ? "changed files drawer"
        : sidebarMode === "approvals"
          ? "approvals drawer"
          : sidebarMode === "activity"
            ? "activity drawer"
            : "memory drawer";

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

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1">
        {!isNarrow ? (
          <div className="flex min-h-0">
            <LeftRail
              activeMode={sidebarMode}
              sessionCount={sessionList.length}
              changedCount={changedFiles.length}
              approvalCount={approvalCount}
              activityCount={activityEntries.length}
              expanded={sidebarExpanded}
              onToggleExpanded={() => setSidebarExpanded((expanded) => !expanded)}
              onSelectMode={selectSidebarMode}
            />
            {sidebarExpanded ? (
              <div className="w-80 min-w-80 max-w-80">{sidebar}</div>
            ) : null}
          </div>
        ) : null}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background/65">
          <header className="flex h-12 min-w-0 shrink-0 items-center gap-3 border-b border-border/70 bg-card/70 px-4 backdrop-blur">
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
            <div className="ml-auto" />
            <AppGatewayTargetSelector
              apps={runtimeAppDescriptors}
              selectedAppName={selectedAppName}
              selectedTenantId={selectedTenantId}
              onSelectApp={(appName) => {
                setSelectedAppName(appName);
                setSelectedTenantId(null);
              }}
              onSelectTenant={setSelectedTenantId}
            />
            <ConnectionStatus state={wsState} />
            <SessionTelemetry
              activeProvider={activeProvider}
              resumeInfo={resumeInfo}
              runtimeContinuity={runtimeContinuity}
              fieldTelemetry={dashboardData?.telemetry ?? null}
            />
            <ThemeSwitcher onThemeSelected={persistThemePreference} />
          </header>
          <OperatorSurfaceTabs
            activeSurface={activeSurface}
            memoryOpen={memorySurfaceOpen}
            files={workspaceDocuments}
            selectedPath={selectedWorkspacePath}
            loadingPath={workspaceDocumentLoadingPath}
            error={workspaceDocumentError}
            onSelectChat={() => {
              setActiveSurface("chat");
              setSelectedWorkspacePath(null);
            }}
            onSelectMemory={() => {
              openMemorySurface();
            }}
            onCloseMemory={closeMemorySurface}
            onSelectFile={(path) => {
              setActiveSurface("workspace");
              setSelectedWorkspacePath(path);
              setWorkspaceDocumentError(null);
            }}
            onCloseFile={closeWorkspaceFile}
            chatContent={(
              <Transcript
                entries={conversationEntries}
                activityPhase={activityPhase}
                activityToolName={activity?.toolName}
                activityDetails={activity?.details}
                onApprove={(sessionId) => sendApprovalResponse(true, undefined, sessionId)}
                onDeny={(sessionId) => sendApprovalResponse(false, undefined, sessionId)}
              />
            )}
            memoryContent={(
              <MemoryLatticeSurface
                response={memoryLatticeQuery.data ?? null}
                loading={Boolean(memoryLatticeQuery.isFetching)}
                error={memoryLatticeQuery.error instanceof Error ? memoryLatticeQuery.error : null}
                selectedRecordId={selectedMemoryRecordId}
                onRefresh={() => void memoryLatticeQuery.refetch()}
                onSelectRecord={setSelectedMemoryRecordId}
              />
            )}
          />
          <Composer
            status={status}
            planMode={planMode}
            resumeTargetId={resumeTargetId}
            providerControl={(
              <ProviderStatus
                compact
                onOpenPicker={() => setIsProviderPickerOpen(true)}
                domainLabel={domainLabel}
                workingDirectory={workingDirectory}
              />
            )}
            reasoningControl={resolvedReasoningEffort ? (
              <ReasoningEffortControl
                value={resolvedReasoningEffort}
                options={reasoningEffortOptions}
                onChange={setReasoningEffort}
              />
            ) : null}
            onSubmit={(text) => {
              sendMessage(text, {
                ...(resolvedReasoningEffort ? { reasoningEffort: resolvedReasoningEffort } : {}),
                ...(selectedAppName ? { appName: selectedAppName } : {}),
                ...(selectedRuntimeApp?.runtime === "tenant" && selectedTenantId ? { tenantId: selectedTenantId } : {}),
              });
            }}
            onEmptySubmit={() => {
              if (selectedSessionId) {
                setResume(selectedSessionId);
              }
            }}
            onTogglePlanMode={setPlanMode}
            commandMenu={{
              open: composerCommandOpen,
              query: composerCommandQuery,
              commands: rootCommands,
              onQueryChange: setComposerCommandQuery,
              onExecute: executePaletteCommand,
              onOpenChange: (open) => {
                if (!open) {
                  closeComposerCommands();
                  return;
                }
                setPaletteQuery("");
                setIsPaletteOpen(false);
                setComposerCommandQuery("");
                setComposerCommandOpen(true);
              },
            }}
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
                  : drawerTitle === "Approvals"
                    ? "Approvals drawer"
                    : drawerTitle === "Activity"
                      ? "Activity drawer"
                      : "Memory drawer"}
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
          markProviderCatalogRefreshing();
          if (wsState === "open") {
            send({ type: "refresh_providers" });
          }
          const result = await dashboardQuery.refetch();
          if (result && "error" in result && result.error) {
            markProviderCatalogError("Could not refresh provider discovery.");
            return;
          }
          if (result && "data" in result && result.data?.providers) {
            onProvidersRefreshed(result.data.providers);
          }
        }}
        onAuthenticateProvider={async (provider, options) => {
          const started = authenticateProvider(provider, options);
          if (!started) {
            const message = useSessionStore.getState().errorBanner ?? "Provider authentication failed.";
            setErrorBanner(message);
            throw new Error(message);
          }
          try {
            await waitForProviderAuthResolution(provider);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Provider authentication failed.";
            setErrorBanner(message);
            throw (error instanceof Error ? error : new Error(message));
          }
        }}
        providerAuthenticating={providerAuthenticating}
        providerAuthProvider={providerAuthProvider}
        providerAuthMessage={providerAuthMessage}
        providerAuthDetails={providerAuthDetails}
        onOpenChange={(open) => setIsProviderPickerOpen(open)}
      />
    </div>
  );
}

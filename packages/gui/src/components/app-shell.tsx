import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type OperatorTurnRequestedAuthority,
  type OperatorWorkspaceFileSnapshot,
  type OperatorWorkspaceTreeEntry,
  type OperatorThemeName,
} from "@kilnai/gateway-contracts";
import { GuiGatewayClient } from "../api/client.js";
import { useGuiWs } from "../lib/use-gui-ws.js";
import { useSessionStore } from "../lib/session-store.js";
import { deriveChangedFiles, derivePendingApprovals, deriveWorkItems } from "../lib/session-store.js";
import { SessionList } from "./session-list.js";
import { WorkspacePanel } from "./workspace-panel.js";
import { OperatorSurfaceTabs, type OperatorSurfaceKind } from "./operator-surface-tabs.js";
import { ChangedFilesPanel } from "./changed-files-panel.js";
import { ApprovalsPanel } from "./approvals-panel.js";
import { ActivityLogPanel } from "./activity-log-panel.js";
import { WorkItemsPanel } from "./work-items-panel.js";
import { WorkflowOverviewPanel } from "./workflow-overview-panel.js";
import { ChatWorkbench } from "./chat-workbench.js";
import { Transcript } from "./transcript.js";
import { Composer } from "./composer.js";
import { CommandPalette, type CommandPaletteItem } from "./command-palette.js";
import { ErrorBanner } from "./error-banner.js";
import { ProviderPicker } from "./provider-picker.js";
import { ProviderStatus } from "./provider-status.js";
import { MemoryLatticePanel, MemoryLatticeSurface } from "./memory-lattice/memory-lattice-panel.js";
import { SetupPanel } from "./setup-panel.js";
import { useUiStore } from "../lib/ui-store.js";
import { isActivityTimelineEntry, isConversationTimelineEntry } from "../lib/timeline-visibility.js";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  CheckCheck,
  FileDiff,
  Folder,
  History,
  ListChecks,
  MessagesSquare,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const NARROW_LAYOUT_QUERY = "(max-width: 1024px)";
const SIDEBAR_COLLAPSED_KEY = "kiln.gui.sidebarCollapsed";
const GATEWAY_BOOTSTRAP_TIMEOUT_MS = 10_000;
const PROVIDER_SWITCH_WAIT_TIMEOUT_MS = 5_500;
const PROVIDER_AUTH_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const WORKSPACE_DOCUMENT_TAB_LIMIT = 8;
const KILN_LOGO_URL = new URL("../../../../docs/assets/logo.svg", import.meta.url).href;

const REASONING_EFFORT_LABELS: Record<GuiProviderReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};
type RequestableTurnAuthority = OperatorTurnRequestedAuthority;
const TURN_AUTHORITY_OPTIONS: readonly RequestableTurnAuthority[] = [
  "auto",
  "read_only",
  "audited",
  "destructive",
];
const TURN_AUTHORITY_LABELS: Record<RequestableTurnAuthority, string> = {
  auto: "Auto",
  read_only: "Read only",
  audited: "Audited",
  destructive: "Destructive",
};
const EMPTY_REASONING_EFFORTS: readonly GuiProviderReasoningEffort[] = [];
const EMPTY_APP_DESCRIPTORS: readonly GuiAppDescriptor[] = [];

function readSidebarCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSidebarCollapsedPreference(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
  } catch {
    // Browser storage can be unavailable in restricted contexts; layout still works in memory.
  }
}

function KilnMark() {
  return (
    <div className="grid size-9 shrink-0 place-items-center" aria-hidden="true">
      <img
        src={KILN_LOGO_URL}
        alt=""
        className="size-7 object-contain"
        draggable={false}
      />
    </div>
  );
}

type WorkbenchSurface = "chat" | "work" | "activity" | "memory" | "setup";
type InspectorMode = "workspace" | "changed" | "approvals";
type MobileDrawerMode = "sessions" | "inspector";

const workbenchSurfaceIcons: Record<WorkbenchSurface, LucideIcon> = {
  chat: MessagesSquare,
  work: ListChecks,
  activity: Activity,
  memory: Network,
  setup: Settings2,
};

const inspectorModeIcons: Record<InspectorMode, LucideIcon> = {
  workspace: Folder,
  changed: FileDiff,
  approvals: CheckCheck,
};

function NavButton<TMode extends string>(props: {
  readonly mode: TMode;
  readonly label: string;
  readonly active: boolean;
  readonly count?: number;
  readonly icon: LucideIcon;
  readonly collapsed?: boolean;
  readonly onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <Button
      type="button"
      variant={props.active ? "secondary" : "ghost"}
      size={props.collapsed ? "icon-lg" : "sm"}
      aria-current={props.active ? "page" : undefined}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={cn(
        "relative text-muted-foreground",
        props.collapsed ? "mx-auto" : "w-full justify-start",
        props.active && "text-foreground",
      )}
    >
      <Icon data-icon="inline-start" aria-hidden="true" />
      {props.collapsed ? null : <span className="min-w-0 flex-1 truncate text-left">{props.label}</span>}
      {props.count && props.count > 0 ? (
        <Badge
          variant="outline"
          className={cn(
            "h-4 min-w-4 px-1 font-mono text-[9px] leading-none text-muted-foreground",
            props.collapsed && "absolute -right-1 -top-1",
          )}
        >
          {props.count}
        </Badge>
      ) : null}
    </Button>
  );
}

function PrimarySidebar(props: {
  readonly activeSurface: WorkbenchSurface;
  readonly collapsed: boolean;
  readonly activityCount: number;
  readonly sessionsOpen: boolean;
  readonly onSelectSurface: (surface: WorkbenchSurface) => void;
  readonly onToggleCollapsed: () => void;
  readonly onSessionsOpenChange: (open: boolean) => void;
  readonly sessions: ReactNode;
}) {
  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border/70 bg-card transition-[width,min-width,max-width]",
        props.collapsed ? "w-14 min-w-14 max-w-14" : "w-[22rem] min-w-[22rem] max-w-[22rem]",
      )}
    >
      <header className={cn("flex min-h-14 items-center border-b border-border/70 px-2", props.collapsed ? "justify-center" : "gap-3")}>
        {props.collapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={props.onToggleCollapsed}
          >
            <PanelLeftOpen data-icon="inline-start" aria-hidden="true" />
          </Button>
        ) : (
          <>
            <KilnMark />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">Kiln</p>
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Operator workbench
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onClick={props.onToggleCollapsed}
            >
              <PanelLeftClose data-icon="inline-start" aria-hidden="true" />
            </Button>
          </>
        )}
      </header>
      <nav aria-label="Workbench surfaces" className={cn("border-b border-border/70 p-2", props.collapsed && "px-1")}>
        <div className="flex flex-col gap-1">
          {(["chat", "work", "activity", "memory", "setup"] as const).map((surface) => (
            <NavButton
              key={surface}
              mode={surface}
              label={surface === "chat" ? "Chat" : surface === "work" ? "Work" : surface === "activity" ? "Activity" : surface === "memory" ? "Memory" : "Setup"}
              icon={workbenchSurfaceIcons[surface]}
              active={props.activeSurface === surface}
              count={surface === "activity" ? props.activityCount : undefined}
              collapsed={props.collapsed}
              onClick={() => props.onSelectSurface(surface)}
            />
          ))}
        </div>
      </nav>
      {props.collapsed ? (
        <div className="border-b border-border/70 p-1">
          <Popover open={props.sessionsOpen} onOpenChange={props.onSessionsOpenChange}>
            <PopoverTrigger
              render={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Open sessions"
                  title="Open sessions"
                  className="relative mx-auto text-muted-foreground"
                >
                  <History data-icon="inline-start" aria-hidden="true" />
                </Button>
              )}
            />
            <PopoverContent aria-label="Sessions" side="right" align="start" sideOffset={8} className="h-[min(42rem,calc(100vh-2rem))] w-96 p-0">
              <div className="min-h-0 flex-1">{props.sessions}</div>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
        <div className="min-h-0 flex-1">{props.sessions}</div>
      )}
    </aside>
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

function TurnAuthorityControl(props: {
  readonly value: RequestableTurnAuthority;
  readonly onChange: (value: RequestableTurnAuthority) => void;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (TURN_AUTHORITY_OPTIONS.includes(value as RequestableTurnAuthority)) {
          props.onChange(value as RequestableTurnAuthority);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label="Turn authority" className="min-w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {TURN_AUTHORITY_OPTIONS.map((authority) => (
            <SelectItem key={authority} value={authority}>
              {TURN_AUTHORITY_LABELS[authority]}
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
  const [mobileDrawerMode, setMobileDrawerMode] = useState<MobileDrawerMode>("sessions");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false);
  const [workbenchSurface, setWorkbenchSurface] = useState<WorkbenchSurface>("chat");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("workspace");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<GuiProviderReasoningEffort | null>(null);
  const [requestedAuthority, setRequestedAuthority] = useState<RequestableTurnAuthority>("auto");
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
  const interactiveUseSnapshot = useSessionStore((state) => state.interactiveUseSnapshot);
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
  const onInteractiveUseUpdated = useSessionStore((state) => state.onInteractiveUseUpdated);
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
  const pendingApprovals = useMemo(() => derivePendingApprovals(timelineEntries), [timelineEntries]);
  const workItems = useMemo(() => deriveWorkItems(timelineEntries), [timelineEntries]);
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
    persistSidebarCollapsedPreference(sidebarCollapsed);
    if (!sidebarCollapsed) {
      setSessionPopoverOpen(false);
    }
  }, [sidebarCollapsed]);

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

  useEffect(() => {
    if (interactiveUseSnapshot?.target !== "browser") {
      return;
    }
    setWorkbenchSurface("chat");
    setActiveSurface("browser");
  }, [interactiveUseSnapshot?.target, interactiveUseSnapshot?.toolCallId, interactiveUseSnapshot?.updatedAt]);

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
    void gatewayClient.waitForHealth({ timeoutMs: GATEWAY_BOOTSTRAP_TIMEOUT_MS })
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
        setWorkbenchSurface("chat");
        setActiveSurface("chat");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "2") {
        event.preventDefault();
        setInspectorMode("workspace");
        setInspectorOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "3") {
        event.preventDefault();
        setInspectorMode("changed");
        setInspectorOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "4") {
        event.preventDefault();
        setInspectorMode("approvals");
        setInspectorOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "5") {
        event.preventDefault();
        setWorkbenchSurface("work");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "6") {
        event.preventDefault();
        setWorkbenchSurface("activity");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "7") {
        event.preventDefault();
        setWorkbenchSurface("memory");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "8") {
        event.preventDefault();
        setWorkbenchSurface("setup");
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
      } else if (frame.type === "interactive_use_updated") {
          onInteractiveUseUpdated(frame);
          if (frame.snapshot.target === "browser") {
            setWorkbenchSurface("chat");
            setActiveSurface("browser");
          }
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
    enabled: gatewayReady && (workbenchSurface === "memory" || memorySurfaceOpen),
  });
  const setupQuery = useQuery({
    queryKey: ["gui", "setup", gatewayReady ? "ready" : "waiting"],
    queryFn: async () => gatewayClient.loadConfigSetup(),
    enabled: gatewayReady && workbenchSurface === "setup",
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
    {
      id: "setup",
      trigger: "setup",
      title: "Setup",
      description: "Open config and projection status.",
      keywords: ["config", "status", "shims"],
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
      case "setup":
        setWorkbenchSurface("setup");
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
    setWorkbenchSurface("chat");
    setDrawerOpen(false);
    setSessionPopoverOpen(false);
  };
  const selectedSessionMeta = sessionDetailQuery.data?.meta ?? null;
  const openMemorySurface = () => {
    setMemorySurfaceOpen(true);
    setActiveSurface("memory");
    setWorkbenchSurface("memory");
  };
  const closeMemorySurface = () => {
    setMemorySurfaceOpen(false);
    if (activeSurface === "memory") {
      setActiveSurface("chat");
    }
  };

  const sessionsPanel = (
    <SessionList
      sessions={sessionList}
      selectedSessionId={selectedSessionId}
      resumeTargetId={resumeTargetId}
      onSelect={(sessionId) => {
        setSelectedSessionId(sessionId);
        setWorkbenchSurface("chat");
        setDrawerOpen(false);
        setSessionPopoverOpen(false);
      }}
      onStartNewSession={startNewSession}
    />
  );

  const inspector = inspectorMode === "workspace"
    ? (
      <WorkspacePanel
        gatewayWorkingDirectory={workingDirectory}
        workspaceTree={dashboardData?.workspaceTree}
        workspaceClient={gatewayClient}
        worktreePath={selectedSessionMeta?.sessionLedger?.worktreePath ?? null}
        selectedFilePath={selectedWorkspacePath}
        onOpenFile={openWorkspaceFile}
      />
    ) : inspectorMode === "changed"
      ? (
        <ChangedFilesPanel files={changedFiles} />
      )
      : (
        <ApprovalsPanel
          approvals={pendingApprovals}
          onApprove={(approvalId) => sendApprovalResponse(true, undefined, approvalId)}
          onDeny={(approvalId) => sendApprovalResponse(false, undefined, approvalId)}
        />
      );

  const activeChatWorkspaceSurface = workbenchSurface === "chat" && activeSurface === "browser" && interactiveUseSnapshot?.target === "browser"
    ? "browser"
    : "chat";
  const workbenchTitle = workbenchSurface === "chat"
    ? activeChatWorkspaceSurface === "browser" ? "Browser" : "Chat"
    : workbenchSurface === "work"
        ? "Work"
        : workbenchSurface === "activity"
          ? "Activity"
          : workbenchSurface === "memory"
            ? "Memory"
            : "Setup";
  const drawerTitle = mobileDrawerMode === "sessions" ? "Sessions" : "Inspector";
  const drawerAriaLabel = mobileDrawerMode === "sessions" ? "session drawer" : "inspector drawer";

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  return (
    <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(180deg,color-mix(in_srgb,var(--color-background-element)_42%,transparent),transparent_30%),linear-gradient(90deg,color-mix(in_srgb,var(--color-border)_18%,transparent)_1px,transparent_1px),linear-gradient(color-mix(in_srgb,var(--color-border)_14%,transparent)_1px,transparent_1px)] [background-size:100%_100%,48px_48px,48px_48px]"
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
          <PrimarySidebar
            activeSurface={workbenchSurface}
            collapsed={sidebarCollapsed}
            activityCount={activityEntries.length}
            sessionsOpen={sessionPopoverOpen}
            onSelectSurface={(surface) => {
              setWorkbenchSurface(surface);
                  if (surface === "chat") {
                setActiveSurface(surface);
              }
            }}
            onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
            onSessionsOpenChange={setSessionPopoverOpen}
            sessions={sessionsPanel}
          />
        ) : null}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background/65">
          {isNarrow ? (
            <header className="flex h-11 min-w-0 shrink-0 items-center gap-3 border-b border-border/70 bg-card/70 px-3 backdrop-blur">
              <KilnMark />
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-controls="session-drawer"
                aria-expanded={drawerOpen}
                aria-label={drawerOpen && mobileDrawerMode === "sessions" ? "Hide session drawer" : "Open session drawer"}
                onClick={() => {
                  setMobileDrawerMode("sessions");
                  setDrawerOpen((open) => mobileDrawerMode === "sessions" ? !open : true);
                }}
              >
                Sessions
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-controls="session-drawer"
                aria-expanded={drawerOpen}
                aria-label={drawerOpen && mobileDrawerMode === "inspector" ? "Hide inspector drawer" : "Open inspector drawer"}
                onClick={() => {
                  setMobileDrawerMode("inspector");
                  setDrawerOpen((open) => mobileDrawerMode === "inspector" ? !open : true);
                }}
              >
                Inspector
              </Button>
              <Select
                value={workbenchSurface}
                onValueChange={(value) => {
                  if (value === "chat" || value === "work" || value === "activity" || value === "memory" || value === "setup") {
                    setWorkbenchSurface(value);
                    if (value === "chat") {
                      setActiveSurface(value);
                    }
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="Workbench surface" className="min-w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="chat">Chat</SelectItem>
                    <SelectItem value="work">Work</SelectItem>
                    <SelectItem value="activity">Activity</SelectItem>
                    <SelectItem value="memory">Memory</SelectItem>
                    <SelectItem value="setup">Setup</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
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
            </header>
          ) : null}
          {!isNarrow ? (
            <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border/70 bg-card/60 px-4 backdrop-blur">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{workbenchTitle}</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {workbenchSurface === "chat" ? activeChatWorkspaceSurface === "browser" ? "interactive browser" : "conversation" : workbenchSurface === "work" ? "governed work items" : workbenchSurface === "activity" ? "runtime timeline" : workbenchSurface === "memory" ? "memory lattice" : "configuration"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {(["workspace", "changed", "approvals"] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={inspectorOpen && inspectorMode === mode ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={inspectorOpen && inspectorMode === mode}
                    aria-label={mode === "workspace" ? "Workspace" : mode === "changed" ? "Changed files" : "Approvals"}
                    onClick={() => {
                      setInspectorMode(mode);
                      setInspectorOpen(true);
                    }}
                  >
                    {(() => {
                      const Icon = inspectorModeIcons[mode];
                      return <Icon data-icon="inline-start" aria-hidden="true" />;
                    })()}
                    {mode === "workspace" ? "Workspace" : mode === "changed" ? "Changed" : "Approvals"}
                    {mode === "changed" && changedFiles.length > 0 ? <Badge variant="outline">{changedFiles.length}</Badge> : null}
                    {mode === "approvals" && approvalCount > 0 ? <Badge variant="outline">{approvalCount}</Badge> : null}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
                  onClick={() => setInspectorOpen((open) => !open)}
                >
                  {inspectorOpen ? (
                    <PanelRightClose data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <PanelRightOpen data-icon="inline-start" aria-hidden="true" />
                  )}
                </Button>
              </div>
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
            </header>
          ) : null}
          {workbenchSurface === "chat" ? (
            <ChatWorkbench
              pendingApprovals={pendingApprovals}
              selectedSessionId={selectedSessionId}
              onApprove={(approvalId) => sendApprovalResponse(true, undefined, approvalId)}
              onDeny={(approvalId) => sendApprovalResponse(false, undefined, approvalId)}
              onOpenApprovals={() => {
                setInspectorMode("approvals");
                setInspectorOpen(true);
              }}
              surfaces={(
          <OperatorSurfaceTabs
            activeSurface={activeSurface}
            browserSnapshot={interactiveUseSnapshot?.target === "browser" ? interactiveUseSnapshot : null}
            loadResourceDataUrl={(uri) => gatewayClient.loadResourceDataUrl(uri)}
            memoryOpen={memorySurfaceOpen}
            files={workspaceDocuments}
            selectedPath={selectedWorkspacePath}
            loadingPath={workspaceDocumentLoadingPath}
            error={workspaceDocumentError}
            onSelectChat={() => {
              setActiveSurface("chat");
              setSelectedWorkspacePath(null);
            }}
            onSelectBrowser={() => {
              setActiveSurface("browser");
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
                onApprove={(approvalId) => sendApprovalResponse(true, undefined, approvalId)}
                onDeny={(approvalId) => sendApprovalResponse(false, undefined, approvalId)}
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
              )}
              composer={(
          <Composer
            status={status}
            planMode={planMode}
            resumeTargetId={resumeTargetId}
            providerControl={(
              <div className="flex min-w-0 items-center gap-2">
                <ProviderStatus
                  compact
                  onOpenPicker={() => setIsProviderPickerOpen(true)}
                  domainLabel={domainLabel}
                  workingDirectory={workingDirectory}
                />
                {!isNarrow ? (
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
                ) : null}
              </div>
            )}
            reasoningControl={resolvedReasoningEffort ? (
              <ReasoningEffortControl
                value={resolvedReasoningEffort}
                options={reasoningEffortOptions}
                onChange={setReasoningEffort}
              />
            ) : null}
            authorityControl={(
              <TurnAuthorityControl
                value={requestedAuthority}
                onChange={setRequestedAuthority}
              />
            )}
            onSubmit={(text) => {
              sendMessage(text, {
                ...(resolvedReasoningEffort ? { reasoningEffort: resolvedReasoningEffort } : {}),
                requestedAuthority,
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
              )}
            />
          ) : workbenchSurface === "work" ? (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(16rem,0.9fr)_minmax(18rem,1.1fr)] overflow-hidden bg-workspace-viewer lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:grid-rows-1">
              <div className="min-h-0 overflow-hidden border-b border-border/70 lg:border-b-0 lg:border-r">
                <WorkflowOverviewPanel entries={timelineEntries} />
              </div>
              <div className="min-h-0 overflow-hidden">
                <WorkItemsPanel items={workItems} />
              </div>
            </div>
          ) : workbenchSurface === "activity" ? (
            <div className="min-h-0 flex-1 overflow-hidden bg-workspace-viewer">
              <ActivityLogPanel entries={timelineEntries} />
            </div>
          ) : workbenchSurface === "memory" ? (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] overflow-hidden bg-workspace-viewer">
              <MemoryLatticePanel
                filters={memoryFilters}
                response={memoryLatticeQuery.data ?? null}
                loading={Boolean(memoryLatticeQuery.isFetching)}
                error={memoryLatticeQuery.error instanceof Error ? memoryLatticeQuery.error : null}
                selectedRecordId={selectedMemoryRecordId}
                onRefresh={() => void memoryLatticeQuery.refetch()}
                onFiltersChange={setMemoryFilters}
                onSelectRecord={setSelectedMemoryRecordId}
              />
              <MemoryLatticeSurface
                response={memoryLatticeQuery.data ?? null}
                loading={Boolean(memoryLatticeQuery.isFetching)}
                error={memoryLatticeQuery.error instanceof Error ? memoryLatticeQuery.error : null}
                selectedRecordId={selectedMemoryRecordId}
                onRefresh={() => void memoryLatticeQuery.refetch()}
                onSelectRecord={setSelectedMemoryRecordId}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden bg-workspace-viewer">
              <SetupPanel
                snapshot={setupQuery.data ?? null}
                loading={Boolean(setupQuery.isLoading)}
                refreshing={Boolean(setupQuery.isFetching && !setupQuery.isLoading)}
                error={setupQuery.error instanceof Error ? setupQuery.error : null}
                onRefresh={() => void setupQuery.refetch()}
                onThemeSelected={persistThemePreference}
              />
            </div>
          )}
        </main>
        {!isNarrow && inspectorOpen ? (
          <aside className="w-80 min-w-80 max-w-80 border-l border-border/70 bg-card">
            {inspector}
          </aside>
        ) : null}
      </div>

      {isNarrow && drawerOpen ? (
        <div className="fixed inset-0 z-20 flex bg-black/45 backdrop-blur-sm">
          <button
            type="button"
            aria-label={`Close ${drawerAriaLabel} backdrop`}
            className="min-w-0 flex-1"
            onClick={closeDrawer}
          />
          <div
            id="session-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={drawerTitle === "Sessions" ? "Sessions drawer" : "Inspector drawer"}
            className="flex h-full w-[min(26rem,calc(100vw-3rem))] max-w-full flex-col border-l border-border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{drawerTitle}</p>
                <p className="text-xs text-muted-foreground">
                  {mobileDrawerMode === "sessions" ? "Session history and resume targets." : "Workspace, changes, and approvals."}
                </p>
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
            <div className="min-h-0 flex-1">{mobileDrawerMode === "sessions" ? sessionsPanel : inspector}</div>
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

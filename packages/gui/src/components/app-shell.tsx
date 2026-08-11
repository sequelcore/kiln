import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  OPERATOR_THEME_LABELS,
  OPERATOR_THEME_NAMES,
  createOperatorCockpitReadOnlyViewState,
  createOperatorWorkspaceHomeProjection,
  listOperatorCommands,
  normalizeManagedAgentOperatorEvents,
  projectOperatorCockpitReadOnlyView,
  projectWorkflowActivity,
  type GuiAppDescriptor,
  type GuiMemoryLatticeGraphRequest,
  type GuiOutboundFrame,
  type GuiInboundFrame,
  type GuiDeliberationLevelId,
  type KilnConfigSetupAction,
  type OperatorWorkspaceTreeEntry,
  type OperatorThemeName,
} from "@kilnai/gateway-contracts";
import { GuiGatewayClient } from "../api/client.js";
import { useGuiWs } from "../lib/use-gui-ws.js";
import { useSessionStore } from "../lib/session-store/index.js";
import { deriveChangedFiles, derivePendingApprovals, deriveWorkItems } from "../lib/session-store/index.js";
import { deriveSessionContinuity } from "../lib/session-continuity.js";
import { buildComposerContinuityHint } from "../lib/session-continuity-view.js";
import type { OperatorSurfaceKind } from "./operator-surface-tabs.js";
import type { CommandPaletteItem } from "./command-palette.js";
import { ErrorBanner } from "./error-banner.js";
import { ProviderStatus } from "./provider-status.js";
import { WorkbenchSurfaces } from "./workbench-surfaces.js";
import { useWorkspaceDocuments } from "./use-workspace-documents.js";
import { useCockpitActions } from "./use-cockpit-actions.js";
import {
  operatorCommandToPaletteItem,
  resolveActiveChatWorkspaceSurface,
  resolveDrawerLabels,
  resolveWorkbenchTitle,
  themeToPaletteItem,
} from "./app-shell-view-model.js";
import { createAppShellCommandExecutor } from "./app-shell-command-actions.js";
import { buildComposerTurnOptions } from "./app-shell-composer-submission.js";
import { createProviderPickerActions } from "./app-shell-provider-actions.js";
import { createAppShellFrameHandler } from "./app-shell-frame-handler.js";
import {
  WorkbenchInspectorPanel,
  WorkbenchSessionsPanel,
} from "./workbench-side-panels.js";
import {
  persistSidebarCollapsedPreference,
  readSidebarCollapsedPreference,
  resolveGatewayHttpBaseUrl,
  toWsUrl,
  OPERATOR_TERMINAL_PANEL_ID,
} from "./app-shell-runtime.js";
import {
  AppGatewayTargetSelector,
  DeliberationControl,
  RuntimeBootstrapGate,
  TurnAuthorityControl,
  type RequestableTurnAuthority,
} from "./app-shell-controls.js";
import {
  WorkbenchBody,
  InspectorRail,
  MobileWorkbenchDrawer,
  WorkbenchChrome,
  WorkbenchMain,
} from "./workbench-chrome.js";
import {
  DesktopWorkbenchHeader,
  MobileWorkbenchHeader,
  PrimarySidebar,
  type InspectorMode,
  type MobileDrawerMode,
  type WorkbenchSurface,
} from "./workbench-navigation.js";
import { useUiStore } from "../lib/ui-store.js";
import { isActivityTimelineEntry, projectConversationTimelineEntries } from "../lib/timeline-visibility.js";

const CommandPalette = lazy(async () => {
  const module = await import("./command-palette.js");
  return { default: module.CommandPalette };
});
const ProviderPicker = lazy(async () => {
  const module = await import("./provider-picker.js");
  return { default: module.ProviderPicker };
});
const OperatorTerminalDock = lazy(async () => {
  const module = await import("./operator-terminal-dock.js");
  return { default: module.OperatorTerminalDock };
});

const NARROW_LAYOUT_QUERY = "(max-width: 1024px)";
const GATEWAY_BOOTSTRAP_TIMEOUT_MS = 10_000;
const EMPTY_DELIBERATION_LEVELS: readonly GuiDeliberationLevelId[] = [];
const EMPTY_APP_DESCRIPTORS: readonly GuiAppDescriptor[] = [];

const GUI_COCKPIT_INSTANCE_ID = "local-gui";

interface CommandSurfaceState {
  readonly paletteOpen: boolean;
  readonly paletteMode: "root" | "theme";
  readonly paletteQuery: string;
  readonly composerOpen: boolean;
  readonly composerQuery: string;
}

type CommandSurfaceAction =
  | { readonly type: "close-all" }
  | { readonly type: "close-composer" }
  | { readonly type: "close-palette" }
  | { readonly type: "open-composer" }
  | { readonly type: "open-palette" }
  | { readonly type: "set-composer-query"; readonly query: string }
  | { readonly type: "set-palette-mode"; readonly mode: "root" | "theme" }
  | { readonly type: "set-palette-open"; readonly open: boolean }
  | { readonly type: "set-palette-query"; readonly query: string };

const INITIAL_COMMAND_SURFACE_STATE: CommandSurfaceState = {
  paletteOpen: false,
  paletteMode: "root",
  paletteQuery: "",
  composerOpen: false,
  composerQuery: "",
};

function reduceCommandSurfaces(
  state: CommandSurfaceState,
  action: CommandSurfaceAction,
): CommandSurfaceState {
  switch (action.type) {
    case "close-all":
      return INITIAL_COMMAND_SURFACE_STATE;
    case "close-composer":
      return {
        ...state,
        composerOpen: false,
        composerQuery: "",
      };
    case "close-palette":
      return {
        ...state,
        paletteOpen: false,
        paletteMode: "root",
        paletteQuery: "",
      };
    case "open-composer":
      return {
        ...state,
        paletteOpen: false,
        paletteQuery: "",
        composerOpen: true,
        composerQuery: "",
      };
    case "open-palette":
      return {
        ...state,
        paletteOpen: true,
        paletteMode: "root",
        paletteQuery: "",
        composerOpen: false,
        composerQuery: "",
      };
    case "set-composer-query":
      return {
        ...state,
        composerQuery: action.query,
      };
    case "set-palette-mode":
      return {
        ...state,
        paletteMode: action.mode,
      };
    case "set-palette-open":
      return {
        ...state,
        paletteOpen: action.open,
      };
    case "set-palette-query":
      return {
        ...state,
        paletteQuery: action.query,
      };
  }
}

export function AppShell() {
  return useAppShellRuntimeView();
}

function useAppShellRuntimeView() {
  const [gatewayReady, setGatewayReady] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayAttempt, setGatewayAttempt] = useState(0);
  const [commandSurfaces, dispatchCommandSurface] = useReducer(
    reduceCommandSurfaces,
    INITIAL_COMMAND_SURFACE_STATE,
  );
  const {
    paletteOpen: isPaletteOpen,
    paletteMode,
    paletteQuery,
    composerOpen: composerCommandOpen,
    composerQuery: composerCommandQuery,
  } = commandSurfaces;
  const setPaletteMode = (mode: "root" | "theme") => {
    dispatchCommandSurface({ type: "set-palette-mode", mode });
  };
  const setPaletteQuery = (query: string) => {
    dispatchCommandSurface({ type: "set-palette-query", query });
  };
  const setPaletteOpen = (open: boolean) => {
    dispatchCommandSurface({ type: "set-palette-open", open });
  };
  const setComposerCommandQuery = (query: string) => {
    dispatchCommandSurface({ type: "set-composer-query", query });
  };
  const [governedWorkItemCount, setGovernedWorkItemCount] = useState<number | null>(null);
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false);
  const [hasMountedProviderPicker, setHasMountedProviderPicker] = useState(false);
  const providerPickerInvokerRef = useRef<HTMLElement | null>(null);
  const openProviderPicker = useCallback(() => {
    if (isProviderPickerOpen) return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    providerPickerInvokerRef.current = activeElement?.closest('[data-slot="command"]')
      ? document.getElementById("composer-input")
      : activeElement;
    setHasMountedProviderPicker(true);
    setIsProviderPickerOpen(true);
  }, [isProviderPickerOpen]);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_LAYOUT_QUERY).matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileDrawerMode, setMobileDrawerMode] = useState<MobileDrawerMode>("sessions");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false);
  const [workbenchSurface, setWorkbenchSurface] = useState<WorkbenchSurface>("chat");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("workspace");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [deliberationLevel, setDeliberationLevel] = useState<GuiDeliberationLevelId | null>(null);
  const [requestedAuthority, setRequestedAuthority] = useState<RequestableTurnAuthority>("auto");
  const [selectedGatewayTargetId, setSelectedGatewayTargetId] = useState<string | null>(null);
  const [activeSurface, setActiveSurface] = useState<OperatorSurfaceKind>("chat");
  const [memorySurfaceOpen, setMemorySurfaceOpen] = useState(false);
  const [memoryFilters, setMemoryFilters] = useState<GuiMemoryLatticeGraphRequest>({ depth: 0, limit: 25 });
  const [selectedMemoryRecordId, setSelectedMemoryRecordId] = useState<string | null>(null);
  const [memoryLatticeInvalidationTick, setMemoryLatticeInvalidationTick] = useState(0);
  const [setupActionInFlight, setSetupActionInFlight] = useState<KilnConfigSetupAction | null>(null);
  const [setupActionFeedback, setSetupActionFeedback] = useState<string | null>(null);
  const [operatorTerminalAvailable, setOperatorTerminalAvailable] = useState(false);
  const [operatorTerminalExpanded, setOperatorTerminalExpandedState] = useState(false);
  const operatorTerminalAvailableRef = useRef(false);
  const operatorTerminalExpandedRef = useRef(false);
  const operatorTerminalFocusOriginRef = useRef<HTMLElement | null>(null);
  const operatorTerminalListenersRef = useRef(new Set<(
    frame: Extract<GuiInboundFrame, { type: `operator_terminal_${string}` }>,
  ) => void>());
  const sendRef = useRef<((frame: GuiOutboundFrame) => void) | null>(null);
  const subscribeOperatorTerminal = useCallback((listener: (
    frame: Extract<GuiInboundFrame, { type: `operator_terminal_${string}` }>,
  ) => void) => {
    operatorTerminalListenersRef.current.add(listener);
    return () => operatorTerminalListenersRef.current.delete(listener);
  }, []);
  const setOperatorTerminalExpanded = useCallback((expanded: boolean) => {
    if (expanded) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement
        && !activeElement.closest(`#${OPERATOR_TERMINAL_PANEL_ID}`)) {
        operatorTerminalFocusOriginRef.current = activeElement;
      }
    }
    operatorTerminalExpandedRef.current = expanded;
    setOperatorTerminalExpandedState(expanded);
    if (!expanded) {
      queueMicrotask(() => {
        const origin = operatorTerminalFocusOriginRef.current;
        const fallback = document.querySelector<HTMLElement>(`[aria-controls="${OPERATOR_TERMINAL_PANEL_ID}"]`);
        (origin?.isConnected ? origin : fallback)?.focus();
      });
    }
  }, []);
  const setOperatorTerminalCapability = useCallback((available: boolean) => {
    operatorTerminalAvailableRef.current = available;
    setOperatorTerminalAvailable(available);
    if (!available && operatorTerminalExpandedRef.current) {
      setOperatorTerminalExpanded(false);
    }
  }, [setOperatorTerminalExpanded]);
  const toggleOperatorTerminal = useCallback(() => {
    if (!operatorTerminalAvailableRef.current) return;
    setOperatorTerminalExpanded(!operatorTerminalExpandedRef.current);
  }, [setOperatorTerminalExpanded]);
  const toggleOperatorTerminalFromShortcut = useEffectEvent(toggleOperatorTerminal);

  const status = useSessionStore((state) => state.status);
  const timelineEntries = useSessionStore((state) => state.timelineEntries);
  const sessionEvents = useSessionStore((state) => state.sessionEvents);
  const providers = useSessionStore((state) => state.providers);
  const providerModelDiscovery = useSessionStore((state) => state.providerModelDiscovery);
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
  const liveSessionId = useSessionStore((state) => state.liveSessionId);
  const continuationTargetId = useSessionStore((state) => state.continuationTargetId);
  const detachedSessionIds = useSessionStore((state) => state.detachedSessionIds);
  const messageCount = useSessionStore((state) => state.messages.length);
  const turnCounter = useSessionStore((state) => state.turnCounter);
  const authorityStatus = useSessionStore((state) => state.authorityStatus);
  const contextUsage = useSessionStore((state) => state.contextUsage);
  const activityPhase = useSessionStore((state) => state.activityPhase);
  const interactiveUseSnapshot = useSessionStore((state) => state.interactiveUseSnapshot);
  const browserSessionState = useSessionStore((state) => state.browserSessionState);
  const browserLiveViewportFrame = useSessionStore((state) => state.browserLiveViewportFrame);
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
  const onTurnCancelResult = useSessionStore((state) => state.onTurnCancelResult);
  const onVoiceSynthesisCompleted = useSessionStore((state) => state.onVoiceSynthesisCompleted);
  const onVoiceSynthesisFailed = useSessionStore((state) => state.onVoiceSynthesisFailed);
  const onError = useSessionStore((state) => state.onError);
  const onCleared = useSessionStore((state) => state.onCleared);
  const onProviderChanged = useSessionStore((state) => state.onProviderChanged);
  const onProviderAuthStarted = useSessionStore((state) => state.onProviderAuthStarted);
  const onProviderAuthCompleted = useSessionStore((state) => state.onProviderAuthCompleted);
  const onProviderAuthFailed = useSessionStore((state) => state.onProviderAuthFailed);
  const onExecConfirmed = useSessionStore((state) => state.onExecConfirmed);
  const onActivityPhase = useSessionStore((state) => state.onActivityPhase);
  const onInteractiveUseUpdated = useSessionStore((state) => state.onInteractiveUseUpdated);
  const onBrowserSessionUpdated = useSessionStore((state) => state.onBrowserSessionUpdated);
  const onBrowserLiveViewportFrame = useSessionStore((state) => state.onBrowserLiveViewportFrame);
  const onBrowserOperatorInputAck = useSessionStore((state) => state.onBrowserOperatorInputAck);
  const requestBrowserSessionControl = useSessionStore((state) => state.requestBrowserSessionControl);
  const sendBrowserOperatorInput = useSessionStore((state) => state.sendBrowserOperatorInput);
  const sendApprovalResponse = useSessionStore((state) => state.sendApprovalResponse);
  const sendMessage = useSessionStore((state) => state.sendMessage);
  const cancelActiveTurn = useSessionStore((state) => state.cancelActiveTurn);
  const controlGoal = useSessionStore((state) => state.controlGoal);
  const goalControlPending = useSessionStore((state) => state.goalControlPending);
  const onGoalControlResult = useSessionStore((state) => state.onGoalControlResult);
  const turnCancelPending = useSessionStore((state) => state.turnCancelPending);
  const sendClear = useSessionStore((state) => state.sendClear);
  const setPlanMode = useSessionStore((state) => state.setPlanMode);
  const switchProvider = useSessionStore((state) => state.switchProvider);
  const authenticateProvider = useSessionStore((state) => state.authenticateProvider);
  const disconnect = useSessionStore((state) => state.disconnect);
  const setTheme = useUiStore((state) => state.setTheme);
  const gatewayClient = useMemo(() => new GuiGatewayClient(resolveGatewayHttpBaseUrl()), []);
  const workspaceDocuments = useWorkspaceDocuments({
    gatewayClient,
    onError: setErrorBanner,
    onLastDocumentClosed: () => {
      if (activeSurface === "workspace") {
        setActiveSurface("chat");
      }
    },
  });
  const changedFiles = useMemo(() => deriveChangedFiles(timelineEntries), [timelineEntries]);
  const pendingApprovals = useMemo(() => derivePendingApprovals(timelineEntries), [timelineEntries]);
  const workItems = useMemo(() => deriveWorkItems(timelineEntries), [timelineEntries]);
  const activityEntries = useMemo(() => timelineEntries.filter(isActivityTimelineEntry), [timelineEntries]);
  const conversationEntries = useMemo(
    () => projectConversationTimelineEntries(timelineEntries, sessionEvents),
    [timelineEntries, sessionEvents],
  );
  const workflowActivity = useMemo(() => projectWorkflowActivity(sessionEvents), [sessionEvents]);
  const sessionContinuity = useMemo(() => deriveSessionContinuity({
    status,
    selectedSessionId,
    liveSessionId,
    continuationTargetId,
    messageCount,
    sessionEventCount: sessionEvents.length,
    detachedSessionIds,
  }), [
    status,
    selectedSessionId,
    liveSessionId,
    continuationTargetId,
    messageCount,
    sessionEvents.length,
    detachedSessionIds,
  ]);
  const composerContinuityHint = useMemo(
    () => buildComposerContinuityHint(sessionContinuity),
    [sessionContinuity],
  );
  const foregroundGoalIsLive = liveSessionId !== null
    && (selectedSessionId === null || selectedSessionId === liveSessionId)
    && !detachedSessionIds.includes(liveSessionId);
  const localOperatorWorkspaceState = useMemo(() => {
    const projectedAt = new Date().toISOString();
    const operatorEvents = normalizeManagedAgentOperatorEvents(sessionEvents, {
      defaultInstanceId: GUI_COCKPIT_INSTANCE_ID,
    });
    const cockpitProjection = projectOperatorCockpitReadOnlyView({
      projectedAt,
      attachTargets: [{
        instanceId: GUI_COCKPIT_INSTANCE_ID,
        label: "Local GUI",
        kind: "local",
        gatewayUrl: resolveGatewayHttpBaseUrl(),
      }],
      events: operatorEvents,
    });
    const cockpitView = createOperatorCockpitReadOnlyViewState({
      projection: cockpitProjection,
      viewState: {},
    });
    return {
      cockpitView,
      home: createOperatorWorkspaceHomeProjection({
        projectedAt,
        cockpitView,
        events: operatorEvents,
      }),
    };
  }, [sessionEvents]);
  const managedAgentCockpitView = localOperatorWorkspaceState.cockpitView.managedAgents;
  const managedAgentEconomicAttempts = localOperatorWorkspaceState.cockpitView.economicAttempts;
  const managedAgentUnprojectableEvidence = localOperatorWorkspaceState.cockpitView.unprojectableEvidence;
  const approvalCount = pendingApprovals.length;
  const activeModelCapabilities = activeProvider && activeModel
    ? providerDiscovery.find((entry) => entry.provider === activeProvider)?.modelCapabilities?.[activeModel]
    : undefined;
  const deliberationLevelOptions = activeModelCapabilities?.deliberation?.levels.map((level) => level.id)
    ?? EMPTY_DELIBERATION_LEVELS;
  const selectedDeliberationLevel = deliberationLevelOptions.includes(deliberationLevel ?? "")
    ? deliberationLevel
    : null;

  const openWorkspaceFile = async (entry: OperatorWorkspaceTreeEntry) => {
    setActiveSurface("workspace");
    await workspaceDocuments.openFile(entry);
  };

  const previewSetupSource = async (path: string) => {
    const name = path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
    setWorkbenchSurface("chat");
    await openWorkspaceFile({ path, name, kind: "file" });
  };

  useEffect(() => {
    persistSidebarCollapsedPreference(sidebarCollapsed);
    if (!sidebarCollapsed) {
      setSessionPopoverOpen(false);
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (deliberationLevelOptions.length === 0) {
      if (deliberationLevel !== null) {
        setDeliberationLevel(null);
      }
      return;
    }
    if (deliberationLevel && !deliberationLevelOptions.includes(deliberationLevel)) {
      setDeliberationLevel(null);
    }
  }, [deliberationLevel, deliberationLevelOptions]);

  const closePalette = () => {
    dispatchCommandSurface({ type: "close-palette" });
  };

  const closeComposerCommands = () => {
    dispatchCommandSurface({ type: "close-composer" });
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
          dispatchCommandSurface({ type: "close-palette" });
          return;
        }
        dispatchCommandSurface({ type: "open-palette" });
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openProviderPicker();
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
      if (event.ctrlKey && event.code === "Backquote" && operatorTerminalAvailableRef.current) {
        event.preventDefault();
        toggleOperatorTerminalFromShortcut();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "9") {
        event.preventDefault();
        setWorkbenchSurface("agents");
      }
      if (event.key === "Escape") {
        dispatchCommandSurface({ type: "close-all" });
        setDrawerOpen(false);
        setIsProviderPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Effect Events intentionally stay outside effect dependency arrays.
  }, [isNarrow, isPaletteOpen, openProviderPicker]);

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

  const persistThemePreference = (theme: OperatorThemeName) => {
    void gatewayClient.saveThemePreference(theme);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("theme", theme);
    window.history.replaceState({}, "", nextUrl.toString());
  };

  const { state: wsState, send } = useGuiWs(wsUrl, {
    onFrame: createAppShellFrameHandler({
      onWelcome,
      onSessionEvent,
      onDone,
      onTurnCancelResult,
      onGoalControlResult,
      onVoiceSynthesisCompleted,
      onVoiceSynthesisFailed,
      onError,
      onCleared,
      onProviderChanged,
      onProviderAuthStarted,
      onProviderAuthCompleted,
      onProviderAuthFailed,
      onProvidersRefreshed,
      onExecConfirmed,
      onActivityPhase,
      onInteractiveUseUpdated,
      onBrowserSessionUpdated,
      onBrowserLiveViewportFrame,
      onBrowserOperatorInputAck,
      onOperatorTerminalAvailability: setOperatorTerminalCapability,
      onOperatorTerminalFrame: (frame) => {
        for (const listener of operatorTerminalListenersRef.current) listener(frame);
      },
      setConnectionStatus,
      setTheme,
      persistThemePreference,
      sendThemeResult: (result) => sendRef.current?.(result),
      getProviders: () => useSessionStore.getState().providers,
      refetchDashboard: () => {
        void dashboardQuery.refetch();
      },
      setErrorBanner,
      clearErrorBanner,
      invalidateMemoryLattice: () => setMemoryLatticeInvalidationTick((tick) => tick + 1),
    }),
    onStateChange: (state) => {
      if (state === "open") {
        if (useSessionStore.getState().status === "idle") {
          setConnectionStatus("connecting");
        }
        clearErrorBanner();
      } else if (state === "connecting" || state === "reconnecting") {
        setOperatorTerminalCapability(false);
        setConnectionStatus("connecting");
      } else if (state === "closed") {
        setOperatorTerminalCapability(false);
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
    queryKey: ["gui", "dashboard", gatewayReady ? "ready" : "waiting", turnCounter],
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

  const executeSetupAction = async (action: KilnConfigSetupAction): Promise<void> => {
    if (setupActionInFlight) {
      return;
    }
    setSetupActionInFlight(action);
    setSetupActionFeedback(null);
    try {
      const result = await gatewayClient.executeConfigSetupAction(action);
      setSetupActionFeedback(result.message);
      await setupQuery.refetch();
    } catch (error) {
      setSetupActionFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setSetupActionInFlight(null);
    }
  };

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
  const operatorWorkspaceHome = dashboardData?.operatorWorkspaceHome ?? localOperatorWorkspaceState.home;
  const managedAgentAttentionCount = operatorWorkspaceHome.managedAgents.attentionCount;
  const workingDirectory = dashboardData?.workingDirectory;
  const domainLabel = dashboardData?.domainLabel;
  const appDescriptors = dashboardData?.apps ?? EMPTY_APP_DESCRIPTORS;
  const runtimeAppDescriptors = useMemo(
    () => appDescriptors.filter((app) => app.runtimeCapable),
    [appDescriptors],
  );
  const runtimeGatewayTargets = useMemo(
    () => operatorWorkspaceHome.gatewayTargets.filter((target) => {
      const appId = target.gatewayTarget.appId;
      if (!appId) return false;
      return runtimeAppDescriptors.some((app) => app.name === appId);
    }),
    [operatorWorkspaceHome.gatewayTargets, runtimeAppDescriptors],
  );
  const selectedGatewayTarget = runtimeGatewayTargets.find(
    (target) => target.gatewayTarget.targetId === selectedGatewayTargetId,
  ) ?? null;
  const selectedAppName = selectedGatewayTarget?.gatewayTarget.appId ?? null;
  const selectedTenantId = selectedGatewayTarget?.gatewayTarget.tenantId ?? null;
  const selectedRuntimeApp = runtimeAppDescriptors.find((app) => app.name === selectedAppName) ?? null;
  const cockpitActions = useCockpitActions({
    gatewayClient,
    selectedGatewayTarget,
    selectedSessionId,
    sendFrame: () => sendRef.current,
    onError: setErrorBanner,
  });
  const sendTargetedApprovalResponse = (
    approved: boolean,
    reason: string | undefined,
    approvalId: string,
  ): boolean => sendApprovalResponse(approved, reason, approvalId, {
    ...(selectedGatewayTarget ? { gatewayTargetId: selectedGatewayTarget.gatewayTarget.targetId } : {}),
  });
  const setTargetedPlanMode = (enabled: boolean): void => {
    if (enabled) {
      setGovernedWorkItemCount(null);
    }
    setPlanMode(enabled, {
      ...(selectedGatewayTarget ? { gatewayTargetId: selectedGatewayTarget.gatewayTarget.targetId } : {}),
    });
  };

  useEffect(() => {
    if (runtimeGatewayTargets.length === 0) {
      if (selectedGatewayTargetId !== null) {
        setSelectedGatewayTargetId(null);
      }
      return;
    }

    const dashboardAppName = dashboardData?.activeAppName;
    const dashboardTenantId = dashboardData?.activeTenantId;
    const existing = selectedGatewayTargetId
      ? runtimeGatewayTargets.find((target) => target.gatewayTarget.targetId === selectedGatewayTargetId)
      : null;
    const dashboardTarget = runtimeGatewayTargets.find((target) => {
      const gatewayTarget = target.gatewayTarget;
      if (dashboardAppName && gatewayTarget.appId !== dashboardAppName) return false;
      if (dashboardTenantId) return gatewayTarget.tenantId === dashboardTenantId;
      return !gatewayTarget.tenantId;
    });
    const firstTenantTarget = runtimeGatewayTargets.find((target) => target.gatewayTarget.tenantId);
    const nextTarget = existing ?? dashboardTarget ?? firstTenantTarget ?? runtimeGatewayTargets[0] ?? null;
    const nextTargetId = nextTarget?.gatewayTarget.targetId ?? null;

    if (selectedGatewayTargetId !== nextTargetId) {
      setSelectedGatewayTargetId(nextTargetId);
    }
  }, [
    dashboardData?.activeAppName,
    dashboardData?.activeTenantId,
    runtimeGatewayTargets,
    selectedGatewayTargetId,
  ]);

  const themeCommands: readonly CommandPaletteItem[] = OPERATOR_THEME_NAMES.map((theme) => (
    themeToPaletteItem(theme, OPERATOR_THEME_LABELS[theme])
  ));
  const rootCommands: CommandPaletteItem[] = [];
  for (const command of listOperatorCommands("gui")) {
    if (command.id !== "terminal" || operatorTerminalAvailable) {
      rootCommands.push(operatorCommandToPaletteItem(command));
    }
  }
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
    setGatewayError(null);
    setGatewayReady(false);
    setGatewayAttempt((count) => count + 1);
    markProviderCatalogRefreshing();
    if (wsState === "open") {
      send({ type: "refresh_providers" });
    }
    void dashboardQuery.refetch();
  };

  const startNewSession = () => {
    sendClear();
    setSelectedSessionId(null);
    setActiveSurface("chat");
    setWorkbenchSurface("chat");
    setDrawerOpen(false);
    setSessionPopoverOpen(false);
  };

  const executePaletteCommand = createAppShellCommandExecutor({
    closeComposerCommands,
    closePalette,
    startNewSession,
    setPaletteMode,
    setPaletteQuery,
    setPaletteOpen,
    openProviderPicker,
    deliberationLevelOptions,
    selectedDeliberationLevel,
    setDeliberationLevel,
    requestedAuthority,
    setRequestedAuthority,
    setSessionPopoverOpen,
    setTargetedPlanMode,
    setWorkbenchSurface,
    setTheme,
    persistThemePreference,
    toggleOperatorTerminal,
  });

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
    <WorkbenchSessionsPanel
      sessions={sessionList}
      selectedSessionId={selectedSessionId}
      continuity={sessionContinuity}
      onSelectSession={(sessionId) => {
        setSelectedSessionId(sessionId);
        setWorkbenchSurface("chat");
        setActiveSurface("chat");
        workspaceDocuments.clearSelection();
        setDrawerOpen(false);
        setSessionPopoverOpen(false);
      }}
      onStartNewSession={startNewSession}
    />
  );

  const inspector = (
    <WorkbenchInspectorPanel
      mode={inspectorMode}
      gatewayWorkingDirectory={workingDirectory}
      workspaceTree={dashboardData?.workspaceTree}
      workspaceClient={gatewayClient}
      worktreePath={selectedSessionMeta?.sessionLedger?.worktreePath ?? null}
      selectedFilePath={workspaceDocuments.selectedPath}
      changedFiles={changedFiles}
      approvals={pendingApprovals}
      onOpenFile={openWorkspaceFile}
      onApprove={(approvalId) => sendTargetedApprovalResponse(true, undefined, approvalId)}
      onDeny={(approvalId) => sendTargetedApprovalResponse(false, undefined, approvalId)}
    />
  );

  const activeChatWorkspaceSurface = resolveActiveChatWorkspaceSurface({
    workbenchSurface,
    activeSurface,
    hasBrowserSession: Boolean(browserSessionState),
    hasBrowserSnapshot: interactiveUseSnapshot?.target === "browser",
  });
  const workbenchTitle = resolveWorkbenchTitle(workbenchSurface, activeChatWorkspaceSurface);
  const drawerLabels = resolveDrawerLabels(mobileDrawerMode);
  const providerPickerActions = createProviderPickerActions({
    switchProvider,
    authenticateProvider,
    readErrorBanner: () => useSessionStore.getState().errorBanner,
    setErrorBanner,
    onProvidersRefreshed,
    sendRefreshProviders: () => {
      if (wsState === "open") {
        send({ type: "refresh_providers" });
      }
    },
    refetchDashboard: () => dashboardQuery.refetch(),
  });

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  return (
    <WorkbenchChrome>
      {errorBanner ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-50 flex justify-center sm:inset-x-6">
          <div className="pointer-events-auto w-full max-w-5xl">
            <ErrorBanner
              message={errorBanner}
              onDismiss={clearErrorBanner}
              onRetry={() => {
                clearErrorBanner();
                setGatewayAttempt((count) => count + 1);
              }}
            />
          </div>
        </div>
      ) : null}

      <Suspense fallback={null}>
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
      </Suspense>

      <WorkbenchBody>
        {!isNarrow ? (
          <PrimarySidebar
            activeSurface={workbenchSurface}
            collapsed={sidebarCollapsed}
            activityCount={activityEntries.length}
            managedAgentAttentionCount={managedAgentAttentionCount}
            sessionsOpen={sessionPopoverOpen}
            onSelectSurface={(surface) => {
              setWorkbenchSurface(surface);
              if (surface === "chat") {
                setActiveSurface(surface);
              }
            }}
            onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
            onSessionsOpenChange={setSessionPopoverOpen}
            onStartNewSession={startNewSession}
            sessions={sessionsPanel}
          />
        ) : null}
        <WorkbenchMain>
          {isNarrow ? (
            <MobileWorkbenchHeader
              activeSurface={workbenchSurface}
              drawerOpen={drawerOpen}
              drawerMode={mobileDrawerMode}
              onToggleDrawer={(mode) => {
                setMobileDrawerMode(mode);
                setDrawerOpen((open) => mobileDrawerMode === mode ? !open : true);
              }}
              onSelectSurface={(surface) => {
                setWorkbenchSurface(surface);
                if (surface === "chat") {
                  setActiveSurface(surface);
                }
              }}
              onStartNewSession={startNewSession}
              gatewayTargetSelector={(
                <AppGatewayTargetSelector
                  apps={runtimeAppDescriptors}
                  targets={runtimeGatewayTargets}
                  selectedGatewayTargetId={selectedGatewayTargetId}
                  onSelectGatewayTarget={setSelectedGatewayTargetId}
                />
              )}
              operatorTerminalAvailable={operatorTerminalAvailable}
              operatorTerminalExpanded={operatorTerminalExpanded}
              operatorTerminalPanelId={OPERATOR_TERMINAL_PANEL_ID}
              onToggleOperatorTerminal={toggleOperatorTerminal}
            />
          ) : null}
          {!isNarrow ? (
            <DesktopWorkbenchHeader
              title={workbenchTitle}
              activeSurface={workbenchSurface}
              activeChatSurface={activeChatWorkspaceSurface}
              inspectorOpen={inspectorOpen}
              inspectorMode={inspectorMode}
              changedCount={changedFiles.length}
              approvalCount={approvalCount}
              onSelectInspectorMode={(mode) => {
                setInspectorMode(mode);
                setInspectorOpen(true);
              }}
              onToggleInspector={() => setInspectorOpen((open) => !open)}
              gatewayTargetSelector={(
                <AppGatewayTargetSelector
                  apps={runtimeAppDescriptors}
                  targets={runtimeGatewayTargets}
                  selectedGatewayTargetId={selectedGatewayTargetId}
                  onSelectGatewayTarget={setSelectedGatewayTargetId}
                />
              )}
              operatorTerminalAvailable={operatorTerminalAvailable}
              operatorTerminalExpanded={operatorTerminalExpanded}
              operatorTerminalPanelId={OPERATOR_TERMINAL_PANEL_ID}
              onToggleOperatorTerminal={toggleOperatorTerminal}
            />
          ) : null}
          <div className={isNarrow && operatorTerminalExpanded ? "hidden" : "contents"}>
          <WorkbenchSurfaces
            activeSurface={workbenchSurface}
            chatWorkbench={{
              pendingApprovals,
              selectedSessionId,
              onApprove: (approvalId) => sendTargetedApprovalResponse(true, undefined, approvalId),
              onDeny: (approvalId) => sendTargetedApprovalResponse(false, undefined, approvalId),
              onOpenApprovals: () => {
                setInspectorMode("approvals");
                setInspectorOpen(true);
              },
            }}
            operatorSurfaceTabs={{
              activeSurface,
              browserSnapshot: interactiveUseSnapshot?.target === "browser" ? interactiveUseSnapshot : null,
              browserSession: browserSessionState,
              browserLiveViewportFrame,
              loadResourceDataUrl: (uri) => gatewayClient.loadResourceDataUrl(uri, cockpitActions.resourceTarget(uri)),
              onBrowserSessionControl: (action, options) => {
                requestBrowserSessionControl(action, options);
              },
              onBrowserOperatorInput: (request) => {
                sendBrowserOperatorInput(request);
              },
              memoryOpen: memorySurfaceOpen,
              files: workspaceDocuments.documents,
              selectedPath: workspaceDocuments.selectedPath,
              loadingPath: workspaceDocuments.loadingPath,
              error: workspaceDocuments.error,
              onSelectChat: () => {
                setActiveSurface("chat");
                workspaceDocuments.clearSelection();
              },
              onSelectBrowser: () => {
                setActiveSurface("browser");
                workspaceDocuments.clearSelection();
              },
              onSelectMemory: () => {
                openMemorySurface();
              },
              onCloseMemory: closeMemorySurface,
              onSelectFile: (path) => {
                setActiveSurface("workspace");
                workspaceDocuments.selectPath(path);
              },
              onCloseFile: workspaceDocuments.closeFile,
            }}
            transcript={{
              entries: conversationEntries,
              workflowActivity,
              loadResourceDataUrl: (uri) => gatewayClient.loadResourceDataUrl(uri, cockpitActions.resourceTarget(uri)),
              onApprove: (approvalId) => sendTargetedApprovalResponse(true, undefined, approvalId),
              onDeny: (approvalId) => sendTargetedApprovalResponse(false, undefined, approvalId),
            }}
            composer={{
              status,
              cancelPending: turnCancelPending,
              onCancel: cancelActiveTurn,
              activityPhase,
              activityToolName: activity?.toolName,
              activityDetails: activity?.details,
              planMode,
              governedWorkItemCount,
              continuityHint: composerContinuityHint,
              contextUsage,
              foregroundGoal: workflowActivity.foregroundGoal,
              onGoalControl: foregroundGoalIsLive ? controlGoal : undefined,
              pendingGoalAction: goalControlPending?.goalRunId === workflowActivity.foregroundGoal?.goal.id
                ? goalControlPending?.action
                : undefined,
              providerControl: (
                <ProviderStatus
                  compact
                  open={isProviderPickerOpen}
                  onOpenPicker={openProviderPicker}
                  domainLabel={domainLabel}
                  workingDirectory={workingDirectory}
                />
              ),
              deliberationControl: deliberationLevelOptions.length > 0 ? (
                <DeliberationControl
                  value={selectedDeliberationLevel}
                  options={deliberationLevelOptions}
                  onChange={setDeliberationLevel}
                />
              ) : null,
              authorityControl: (
                <TurnAuthorityControl
                  value={requestedAuthority}
                  authorityStatus={authorityStatus}
                  onChange={setRequestedAuthority}
                />
              ),
              onSubmit: (submission) => {
                const sent = sendMessage(submission.text, {
                  ...(submission.parts ? {
                    parts: submission.parts,
                    displayContent: submission.displayContent,
                  } : {}),
                  ...buildComposerTurnOptions({
                    selectedDeliberationLevel,
                    requestedAuthority,
                    governedWorkItemCount,
                    ...(selectedGatewayTarget ? { gatewayTargetId: selectedGatewayTarget.gatewayTarget.targetId } : {}),
                    ...(selectedAppName ? { appName: selectedAppName } : {}),
                    ...(selectedRuntimeApp?.runtime === "tenant" && selectedTenantId ? { tenantId: selectedTenantId } : {}),
                  }),
                });
                if (sent) {
                  setGovernedWorkItemCount(null);
                }
                return sent;
              },
              onTogglePlanMode: setTargetedPlanMode,
              onGovernedWorkItemCountChange: setGovernedWorkItemCount,
              commandMenu: {
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
                  dispatchCommandSurface({ type: "open-composer" });
                },
              },
            }}
            workflowOverview={{ entries: timelineEntries }}
            workItems={{
              items: workItems,
              onOpenResource: (uri, target) => void cockpitActions.openResource(uri, target),
            }}
            managedAgents={{
              viewState: managedAgentCockpitView,
              economicAttempts: managedAgentEconomicAttempts,
              unprojectableEvidence: managedAgentUnprojectableEvidence,
              onOpenResource: (uri, target) => void cockpitActions.openResource(uri, target),
              onCancel: cockpitActions.cancelManagedAgent,
              onPrompt: cockpitActions.promptManagedAgent,
            }}
            activityLog={{ entries: timelineEntries }}
            memory={{
              filters: memoryFilters,
              response: memoryLatticeQuery.data ?? null,
              loading: Boolean(memoryLatticeQuery.isFetching),
              error: memoryLatticeQuery.error instanceof Error ? memoryLatticeQuery.error : null,
              selectedRecordId: selectedMemoryRecordId,
              onRefresh: () => void memoryLatticeQuery.refetch(),
              onFiltersChange: setMemoryFilters,
              onSelectRecord: setSelectedMemoryRecordId,
            }}
            setup={{
              snapshot: setupQuery.data ?? null,
              loading: Boolean(setupQuery.isLoading),
              refreshing: Boolean(setupQuery.isFetching && !setupQuery.isLoading),
              error: setupQuery.error instanceof Error ? setupQuery.error : null,
              onRefresh: () => void setupQuery.refetch(),
              onExecuteAction: (action) => void executeSetupAction(action),
              onPreviewSource: (path) => void previewSetupSource(path),
              actionInFlight: setupActionInFlight,
              actionFeedback: setupActionFeedback,
              onThemeSelected: persistThemePreference,
            }}
          />
          </div>
          {operatorTerminalAvailable ? (
            <Suspense fallback={null}>
              <OperatorTerminalDock
                available
                expanded={operatorTerminalExpanded}
                layout={isNarrow ? "surface" : "drawer"}
                workspaceScope={workingDirectory ?? window.location.origin}
                onExpandedChange={setOperatorTerminalExpanded}
                send={send}
                subscribe={subscribeOperatorTerminal}
              />
            </Suspense>
          ) : null}
        </WorkbenchMain>
        {!isNarrow && inspectorOpen ? (
          <InspectorRail>
            {inspector}
          </InspectorRail>
        ) : null}
      </WorkbenchBody>

      <MobileWorkbenchDrawer
        open={isNarrow && drawerOpen}
        title={drawerLabels.title}
        description={drawerLabels.description}
        ariaLabel={drawerLabels.ariaLabel}
        closeLabel={drawerLabels.closeLabel}
        onOpenChange={(open) => {
          if (!open) {
            closeDrawer();
          }
        }}
      >
        {mobileDrawerMode === "sessions" ? sessionsPanel : inspector}
      </MobileWorkbenchDrawer>

      {hasMountedProviderPicker ? (
        <Suspense fallback={null}>
          <ProviderPicker
            open={isProviderPickerOpen}
            providers={providers}
            providerModelDiscovery={providerModelDiscovery}
            activeProvider={activeProvider}
            activeModel={activeModel}
            onSwitchProvider={providerPickerActions.onSwitchProvider}
            onRefreshProviders={providerPickerActions.onRefreshProviders}
            onAuthenticateProvider={providerPickerActions.onAuthenticateProvider}
            providerAuthenticating={providerAuthenticating}
            providerAuthProvider={providerAuthProvider}
            providerAuthMessage={providerAuthMessage}
            providerAuthDetails={providerAuthDetails}
            finalFocus={providerPickerInvokerRef}
            onOpenChange={(open) => setIsProviderPickerOpen(open)}
          />
        </Suspense>
      ) : null}
    </WorkbenchChrome>
  );
}

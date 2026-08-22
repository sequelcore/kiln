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
  isOperatorThemeName,
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
  type ExecutionRouteCatalog,
  type KilnConfigSetupAction,
  type KilnConfigurationOnboardingApplyRequest,
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
import { WorkbenchSurfaces } from "./workbench-surfaces.js";
import { useWorkspaceDocuments } from "./use-workspace-documents.js";
import { useCockpitActions, type ManagedAgentActionFailure } from "./use-cockpit-actions.js";
import {
  operatorCommandToPaletteItem,
  resolveActiveChatWorkspaceSurface,
  resolveDrawerLabels,
  resolveWorkbenchTitle,
  themeToPaletteItem,
} from "./app-shell-view-model.js";
import { createAppShellCommandExecutor } from "./app-shell-command-actions.js";
import { buildComposerTurnOptions } from "./app-shell-composer-submission.js";
import { createExecutionRoutePickerActions } from "./app-shell-execution-route-actions.js";
import { createAppShellFrameHandler } from "./app-shell-frame-handler.js";
import { ExecutionRoutePicker } from "./execution-route-picker.js";
import { ModelSelector } from "./ai-elements/model-selector.js";
import { ProviderGlyph } from "./provider-glyph.js";
import {
  WorkbenchInspectorPanel,
} from "./workbench-side-panels.js";
import { SessionList, type SessionHistoryLoadState } from "./session-list.js";
import {
  resolveGatewayHttpBaseUrl,
  readOperatorToken,
  toWsUrl,
  OPERATOR_TERMINAL_PANEL_ID,
} from "./app-shell-runtime.js";
import {
  persistSidebarCollapsedPreference,
  persistSidebarWidthPreference,
  readSidebarCollapsedPreference,
  readSidebarWidthPreference,
} from "./sidebar-layout.js";
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
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SettingsWorkspace } from "./settings-workspace.js";
import { SettingsPage } from "./settings-page.js";
import type { SettingsSection } from "./settings-navigation.js";
import { SetupPanel } from "./setup-panel.js";
import { AvailableModelsPanel } from "./available-models-panel.js";
import { ConfigurationOnboardingPanel } from "./configuration-onboarding-panel.js";

const CommandPalette = lazy(async () => {
  const module = await import("./command-palette.js");
  return { default: module.CommandPalette };
});
const OperatorTerminalDock = lazy(async () => {
  const module = await import("./operator-terminal-dock.js");
  return { default: module.OperatorTerminalDock };
});

const NARROW_LAYOUT_QUERY = "(max-width: 1024px)";
const GATEWAY_BOOTSTRAP_TIMEOUT_MS = 10_000;
const EMPTY_DELIBERATION_LEVELS: readonly GuiDeliberationLevelId[] = [];
const EMPTY_APP_DESCRIPTORS: readonly GuiAppDescriptor[] = [];
const EMPTY_EXECUTION_ROUTE_CATALOG: ExecutionRouteCatalog = { routes: [] };

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

interface AppShellProps {
  readonly settingsSection?: SettingsSection | null;
  readonly onOpenSettings?: (section: SettingsSection) => void;
  readonly onCloseSettings?: () => void;
}

export function AppShell(props: AppShellProps = {}) {
  return useAppShellRuntimeView(props);
}

function useAppShellRuntimeView(props: AppShellProps) {
  const [gatewayReady, setGatewayReady] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [themePreferenceError, setThemePreferenceError] = useState<string | null>(null);
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
  const [isExecutionRoutePickerOpen, setIsExecutionRoutePickerOpen] = useState(false);
  const [hasMountedExecutionRoutePicker, setHasMountedExecutionRoutePicker] = useState(false);
  const executionRoutePickerAnchorRef = useRef<HTMLButtonElement | null>(null);
  const executionRoutePickerInvokerRef = useRef<HTMLElement | null>(null);
  const openExecutionRoutePicker = useCallback(() => {
    if (isExecutionRoutePickerOpen) return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    executionRoutePickerInvokerRef.current = activeElement?.closest('[data-slot="command"]')
      ? document.getElementById("composer-input")
      : activeElement;
    setHasMountedExecutionRoutePicker(true);
    setIsExecutionRoutePickerOpen(true);
  }, [isExecutionRoutePickerOpen]);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_LAYOUT_QUERY).matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileDrawerMode, setMobileDrawerMode] = useState<MobileDrawerMode>("sessions");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidthPreference);
  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false);
  const [workbenchSurface, setWorkbenchSurface] = useState<WorkbenchSurface>("chat");
  const settingsSection = props.settingsSection ?? null;
  const openSettings = useCallback((section: SettingsSection) => {
    props.onOpenSettings?.(section);
  }, [props.onOpenSettings]);
  const selectWorkbenchSurface = useCallback((surface: WorkbenchSurface) => {
    setWorkbenchSurface(surface);
    props.onCloseSettings?.();
  }, [props.onCloseSettings]);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("workspace");
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
  const [onboardingApplying, setOnboardingApplying] = useState(false);
  const [onboardingFeedback, setOnboardingFeedback] = useState<string | null>(null);
  const [managedAgentActionFailure, setManagedAgentActionFailure] = useState<ManagedAgentActionFailure | null>(null);
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
  const providerDiscovery = useSessionStore((state) => state.providerDiscovery);
  const planMode = useSessionStore((state) => state.planMode);
  const activity = useSessionStore((state) => state.activity);
  const sessionControlFailure = useSessionStore((state) => state.sessionControlFailure);
  const providerCatalogStatus = useSessionStore((state) => state.providerCatalogStatus);
  const providerCatalogError = useSessionStore((state) => state.providerCatalogError);
  const executionRouteCatalog = useSessionStore((state) => state.executionRouteCatalog ?? EMPTY_EXECUTION_ROUTE_CATALOG);
  const activeRouteId = useSessionStore((state) => state.activeRouteId);
  const activeAccountOverrideId = useSessionStore((state) => state.activeAccountOverrideId);
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
  const markProviderCatalogRefreshing = useSessionStore((state) => state.markProviderCatalogRefreshing);
  const markProviderCatalogError = useSessionStore((state) => state.markProviderCatalogError);
  const onWelcome = useSessionStore((state) => state.onWelcome);
  const availableModels = useSessionStore((state) => state.availableModels);
  const executionTargetWizardResult = useSessionStore((state) => state.executionTargetWizardResult);
  const outboundSend = useSessionStore((state) => state.outboundSend);
  const onExecutionRoutesRefreshed = useSessionStore((state) => state.onExecutionRoutesRefreshed);
  const onExecutionTargetWizardResult = useSessionStore((state) => state.onExecutionTargetWizardResult);
  const onSessionEvent = useSessionStore((state) => state.onSessionEvent);
  const onDone = useSessionStore((state) => state.onDone);
  const onTurnCancelResult = useSessionStore((state) => state.onTurnCancelResult);
  const onVoiceSynthesisCompleted = useSessionStore((state) => state.onVoiceSynthesisCompleted);
  const onVoiceSynthesisFailed = useSessionStore((state) => state.onVoiceSynthesisFailed);
  const onError = useSessionStore((state) => state.onError);
  const onCleared = useSessionStore((state) => state.onCleared);
  const onExecutionRouteChanged = useSessionStore((state) => state.onExecutionRouteChanged);
  const onExecutionRouteChangeFailed = useSessionStore((state) => state.onExecutionRouteChangeFailed);
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
  const goalControlFailure = useSessionStore((state) => state.goalControlFailure);
  const onGoalControlResult = useSessionStore((state) => state.onGoalControlResult);
  const approvalResponseFailure = useSessionStore((state) => state.approvalResponseFailure);
  const onApprovalResponseResult = useSessionStore((state) => state.onApprovalResponseResult);
  const turnCancelPending = useSessionStore((state) => state.turnCancelPending);
  const sendClear = useSessionStore((state) => state.sendClear);
  const setPlanMode = useSessionStore((state) => state.setPlanMode);
  const selectExecutionRoute = useSessionStore((state) => state.selectExecutionRoute);
  const authenticateProvider = useSessionStore((state) => state.authenticateProvider);
  const disconnect = useSessionStore((state) => state.disconnect);
  const setTheme = useUiStore((state) => state.setTheme);
  const gatewayClient = useMemo(
    () => new GuiGatewayClient(resolveGatewayHttpBaseUrl(), readOperatorToken()),
    [],
  );
  const workspaceDocuments = useWorkspaceDocuments({
    gatewayClient,
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
  const activeExecutionRoute = executionRouteCatalog.routes.find((route) => route.routeId === activeRouteId) ?? null;
  const activeModelCapabilities = activeExecutionRoute
    ? providerDiscovery.find((entry) => entry.provider === activeExecutionRoute.providerId)
      ?.modelCapabilities?.[activeExecutionRoute.providerModelId]
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
    props.onCloseSettings?.();
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
        openExecutionRoutePicker();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "1") {
        event.preventDefault();
        selectWorkbenchSurface("chat");
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
        selectWorkbenchSurface("work");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "6") {
        event.preventDefault();
        selectWorkbenchSurface("activity");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "7") {
        event.preventDefault();
        selectWorkbenchSurface("memory");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "8") {
        event.preventDefault();
        openSettings("general");
      }
      if (event.ctrlKey && event.code === "Backquote" && operatorTerminalAvailableRef.current) {
        event.preventDefault();
        toggleOperatorTerminalFromShortcut();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "9") {
        event.preventDefault();
        selectWorkbenchSurface("agents");
      }
      if (event.key === "Escape") {
        dispatchCommandSurface({ type: "close-all" });
        setDrawerOpen(false);
        setIsExecutionRoutePickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Effect Events intentionally stay outside effect dependency arrays.
  }, [isNarrow, isPaletteOpen, openExecutionRoutePicker, openSettings, selectWorkbenchSurface]);

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

  const persistThemePreference = async (theme: OperatorThemeName): Promise<void> => {
    await gatewayClient.saveThemePreference(theme);
    setTheme(theme);
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
      onApprovalResponseResult,
      onVoiceSynthesisCompleted,
      onVoiceSynthesisFailed,
      onError,
      onCleared,
      onExecutionRouteChanged,
      onExecutionRouteChangeFailed,
      onProviderAuthStarted,
      onProviderAuthCompleted,
      onProviderAuthFailed,
      onExecutionRoutesRefreshed,
      onExecutionTargetWizardResult,
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
      onManagedAgentControlResult: (frame) => {
        if (frame.status === "failed") {
          setManagedAgentActionFailure({
            action: frame.action,
            invocationId: frame.invocationId,
            message: frame.reason ?? `Managed agent ${frame.action} failed.`,
          });
          return;
        }
        setManagedAgentActionFailure((current) => (
          current?.invocationId === frame.invocationId && current.action === frame.action ? null : current
        ));
      },
      invalidateMemoryLattice: () => setMemoryLatticeInvalidationTick((tick) => tick + 1),
    }),
    onStateChange: (state) => {
      if (state === "open") {
        if (useSessionStore.getState().status === "idle") {
          setConnectionStatus("connecting");
        }
        setGatewayError(null);
      } else if (state === "connecting" || state === "reconnecting") {
        setOperatorTerminalCapability(false);
        setConnectionStatus("connecting");
      } else if (state === "closed") {
        setOperatorTerminalCapability(false);
        setConnectionStatus("error");
        setGatewayError("Gateway disconnected.");
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
    queryFn: async () => gatewayClient.loadOperatorSessionHistory(),
    enabled: gatewayReady,
    refetchInterval: 2_000,
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
    enabled: gatewayReady && settingsSection === "health",
  });
  const onboardingQuery = useQuery({
    queryKey: ["gui", "configuration-onboarding", gatewayReady ? "ready" : "waiting"],
    queryFn: async () => gatewayClient.loadConfigurationOnboarding(),
    enabled: gatewayReady && settingsSection === "health",
  });
  const settingsQuery = useQuery({
    queryKey: ["gui", "settings", gatewayReady ? "ready" : "waiting"],
    queryFn: async () => gatewayClient.loadSettings(),
    enabled: gatewayReady && settingsSection !== null,
  });
  const settingsTheme = settingsQuery.data?.entries?.find((entry) => entry.key === "ui.theme")?.effective.value;
  useEffect(() => {
    if (!isOperatorThemeName(settingsTheme)) return;
    setTheme(settingsTheme);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("theme", settingsTheme);
    window.history.replaceState({}, "", nextUrl.toString());
  }, [setTheme, settingsTheme]);

  const applyOnboarding = async (
    request: KilnConfigurationOnboardingApplyRequest,
  ): Promise<void> => {
    if (onboardingApplying) return;
    setOnboardingApplying(true);
    setOnboardingFeedback(null);
    try {
      const result = await gatewayClient.applyConfigurationOnboarding(request);
      setOnboardingFeedback(result.nextAction);
      await Promise.all([onboardingQuery.refetch(), setupQuery.refetch()]);
    } catch (error) {
      setOnboardingFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setOnboardingApplying(false);
    }
  };

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
    if (sessionDetailQuery.data && sessionDetailQuery.data.id === selectedSessionId) {
      viewSessionDetail(sessionDetailQuery.data);
    }
  }, [selectedSessionId, sessionDetailQuery.data, viewSessionDetail]);

  useEffect(() => {
    if (dashboardQuery.error) {
      if (providerCatalogStatus !== "ready") {
        markProviderCatalogError("Could not load provider discovery.");
      }
    }
  }, [dashboardQuery.error, markProviderCatalogError, providerCatalogStatus]);

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
    onFailure: setManagedAgentActionFailure,
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
  const runtimeBootstrapReady = gatewayReady && wsState === "open" && providerCatalogStatus === "ready";
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
    setGatewayError(null);
    setGatewayReady(false);
    setGatewayAttempt((count) => count + 1);
    markProviderCatalogRefreshing();
    if (wsState === "open") {
      send({ type: "refresh_execution_routes" });
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
    props.onCloseSettings?.();
  };

  const executePaletteCommand = createAppShellCommandExecutor({
    closeComposerCommands,
    closePalette,
    startNewSession,
    setPaletteMode,
    setPaletteQuery,
    setPaletteOpen,
    openExecutionRoutePicker,
    openConfigurationSettings: () => openSettings("general"),
    deliberationLevelOptions,
    selectedDeliberationLevel,
    setDeliberationLevel,
    requestedAuthority,
    setRequestedAuthority,
    setSessionPopoverOpen,
    setTargetedPlanMode,
    setWorkbenchSurface: selectWorkbenchSurface,
    persistThemePreference,
    onThemePersistenceFailed: (error) => {
      setThemePreferenceError(error instanceof Error ? error.message : String(error));
    },
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
  const sessionHistoryLoadState: SessionHistoryLoadState = sessionsQuery.error
    ? sessionList.length > 0 ? "stale-error" : "fatal-error"
    : sessionsQuery.isPending && sessionList.length === 0
      ? "loading"
      : sessionList.length === 0
        ? "empty"
        : "ready";
  const sessionsPanel = (
    <SessionList
      sessions={sessionList}
      selectedSessionId={selectedSessionId}
      continuity={sessionContinuity}
      loadState={sessionHistoryLoadState}
      onRetryLoad={() => void sessionsQuery.refetch()}
      onSelect={(sessionId) => {
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
      workspaceLoadError={dashboardQuery.error ? "Could not load workspace state." : undefined}
      onRetryWorkspaceLoad={() => void dashboardQuery.refetch()}
      gatewayWorkingDirectory={workingDirectory}
      workspaceTree={dashboardData?.workspaceTree}
      workspaceClient={gatewayClient}
      worktreePath={selectedSessionMeta?.sessionLedger?.worktreePath ?? null}
      selectedFilePath={workspaceDocuments.selectedPath}
      changedFiles={changedFiles}
      approvals={pendingApprovals}
      approvalResponseFailure={approvalResponseFailure}
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
  const executionRoutePickerActions = createExecutionRoutePickerActions({
    selectExecutionRoute,
    readFailure: () => useSessionStore.getState().providerOperationFailure,
  });

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  return (
    <WorkbenchChrome>
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

      {themePreferenceError ? (
        <Alert variant="destructive" className="mx-4 mt-4">
          <AlertTitle>Theme was not saved</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{themePreferenceError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setThemePreferenceError(null)}>Dismiss</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <WorkbenchBody>
        {settingsSection ? (
          <SettingsWorkspace
            section={settingsSection}
            entries={settingsQuery.data?.entries ?? []}
            sidebarWidth={sidebarWidth}
            onSelectSection={openSettings}
            onSearchResultSelect={({ section, targetId }) => {
              window.setTimeout(() => document.getElementById(targetId ?? `settings-${section}-heading`)?.focus(), 0);
            }}
            onBack={() => props.onCloseSettings?.()}
          >
            <SettingsPage
              section={settingsSection}
              snapshot={settingsQuery.data ?? null}
              economicAttempts={settingsSection === "usage-and-limits" ? managedAgentEconomicAttempts : undefined}
              loading={Boolean(settingsQuery.isLoading || settingsQuery.isFetching)}
              error={settingsQuery.error instanceof Error ? settingsQuery.error : null}
              onRefresh={() => settingsQuery.refetch()}
              onPropose={(request) => gatewayClient.proposeSettingsMutation(request)}
              onApply={(request) => gatewayClient.applySettingsMutation(request)}
              onOpenYaml={workingDirectory ? () => {
                void previewSetupSource(`${workingDirectory.replace(/[\\/]+$/u, "")}/.kiln/kiln.yaml`);
              } : undefined}
              leadingContent={settingsSection === "models" ? (
                <AvailableModelsPanel
                  catalog={availableModels}
                  catalogRevision={executionRouteCatalog.revision}
                  wizardResult={executionTargetWizardResult}
                  send={outboundSend}
                  onRefresh={outboundSend ? () => {
                    markProviderCatalogRefreshing();
                    outboundSend({ type: "refresh_execution_routes" });
                  } : undefined}
                />
              ) : settingsSection === "health" ? (
                onboardingQuery.data?.status === "complete" ? (
                  <SetupPanel
                    snapshot={setupQuery.data ?? null}
                    loading={Boolean(setupQuery.isLoading)}
                    refreshing={Boolean(setupQuery.isFetching && !setupQuery.isLoading)}
                    error={setupQuery.error instanceof Error ? setupQuery.error : null}
                    onRefresh={() => void setupQuery.refetch()}
                    onExecuteAction={(action) => void executeSetupAction(action)}
                    onPreviewSource={(path) => void previewSetupSource(path)}
                    actionInFlight={setupActionInFlight}
                    actionFeedback={setupActionFeedback}
                  />
                ) : (
                  <section aria-label="First-run configuration" className="py-2">
                  <ConfigurationOnboardingPanel
                    snapshot={onboardingQuery.data ?? null}
                    loading={Boolean(onboardingQuery.isLoading)}
                    applying={onboardingApplying}
                    error={onboardingQuery.error instanceof Error ? onboardingQuery.error : null}
                    feedback={onboardingFeedback}
                    onRefresh={() => void onboardingQuery.refetch()}
                    onApply={(request) => void applyOnboarding(request)}
                  />
                  </section>
                )
              ) : undefined}
            />
          </SettingsWorkspace>
        ) : (
          <>
        {!isNarrow ? (
          <PrimarySidebar
            activeSurface={workbenchSurface}
            collapsed={sidebarCollapsed}
            sidebarWidth={sidebarWidth}
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
            onSidebarWidthChange={(width, persist) => {
              setSidebarWidth(width);
              if (persist) persistSidebarWidthPreference(width);
            }}
            onSessionsOpenChange={setSessionPopoverOpen}
            onStartNewSession={startNewSession}
            onOpenSettings={() => openSettings("general")}
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
              onOpenSettings={() => openSettings("general")}
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
              approvalResponseFailure,
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
              loadError: sessionDetailQuery.error ? "Could not load this session transcript." : undefined,
              onRetryLoad: () => void sessionDetailQuery.refetch(),
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
              goalControlFailure: goalControlFailure ?? undefined,
              sessionControlFailure: sessionControlFailure?.message,
              providerControl: (
                <Button
                  ref={executionRoutePickerAnchorRef}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Execution target selector. Current selection: ${activeExecutionRoute?.label ?? "none"}. Click to change.`}
                  aria-expanded={isExecutionRoutePickerOpen}
                  aria-controls="execution-route-picker"
                  aria-haspopup="dialog"
                  onClick={openExecutionRoutePicker}
                  className="h-8 min-w-0 max-w-full shrink justify-start px-2 text-left"
                >
                  {activeExecutionRoute ? (
                    <ProviderGlyph providerId={activeExecutionRoute.providerId} />
                  ) : null}
                  <span className="min-w-0 truncate">{activeExecutionRoute?.label ?? "Select execution target"}</span>
                </Button>
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
              actionFailure: managedAgentActionFailure,
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
          </>
        )}
      </WorkbenchBody>

      {settingsSection ? null : <MobileWorkbenchDrawer
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
      </MobileWorkbenchDrawer>}

      {hasMountedExecutionRoutePicker ? (
        <Suspense fallback={null}>
          <ModelSelector
            open={isExecutionRoutePickerOpen}
            onOpenChange={setIsExecutionRoutePickerOpen}
            title="Execution target"
            description="Choose an available execution target or an eligible account override."
            anchor={executionRoutePickerAnchorRef}
            finalFocus={executionRoutePickerInvokerRef}
          >
            <ExecutionRoutePicker
              catalog={executionRouteCatalog}
              activeRouteId={activeRouteId}
              activeAccountOverrideId={activeAccountOverrideId}
              onSelect={(selection) => {
                void executionRoutePickerActions.onSelectRoute(
                  selection.routeId,
                  selection.accountOverrideId,
                ).then(() => setIsExecutionRoutePickerOpen(false));
              }}
              onRepair={(request) => {
                switch (request.action) {
                  case "authenticate-provider":
                    authenticateProvider(request.providerId);
                    return;
                  case "refresh-route-catalog":
                    markProviderCatalogRefreshing();
                    send({ type: "refresh_execution_routes" });
                    return;
                }
              }}
            />
          </ModelSelector>
        </Suspense>
      ) : null}
    </WorkbenchChrome>
  );
}

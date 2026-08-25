/**
 * @fileoverview TUI Application entry point.
 * @module @kilnai/tui
 */

import { execSync } from "node:child_process";
import { createCliRenderer, MarkdownRenderable, SyntaxStyle, TextRenderable } from "@opentui/core";
import { getFieldStore } from "@kilnai/core";
import {
  getGuiProviderMetadata,
  listOperatorCommands,
  type ExecutionRouteCatalog,
  type ExecutionRouteCatalogEntry,
  type AvailableModelCatalog,
  type GuiProviderCatalogStatus,
  type GuiProviderDiscoveryResult,
  type GuiProviderModelDiscoveryProjection,
  type KilnConfigSetupSnapshot,
  type KilnSettingsApplyRequest,
  type KilnSettingsMutationResult,
  type KilnSettingsProposalProjection,
  type KilnSettingsProposalRequest,
  type KilnSettingsSnapshot,
  type OperatorCommandDefinition,
  type OperatorSessionSummary,
  type OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";
import {
  OPERATOR_THEME_LABELS,
  isOperatorThemeName,
} from "@kilnai/operator-appearance";
import type { SessionLike } from "./types.js";
import type { Message, DeliberationLevelId, ContinuationSidebarInfo, SlashCommand } from "./state.js";
import { createReactiveState, update } from "./state.js";
import type { KilnTheme } from "./theme.js";
import { defaultTheme, themeNames as listThemeNames, themes } from "./theme.js";
import { formatSetupSnapshot } from "./setup-format.js";
import { formatSettingsSnapshot } from "./settings-format.js";
import { buildSettingsProposalRequest, parseSettingsCommand } from "./settings-command.js";
import {
  initUI,
  createThemePicker,
  destroyThemePicker,
  createExecutionRoutePicker,
  destroyExecutionRoutePicker,
} from "./ui.js";
import { sendMessage } from "./handlers.js";
import {
  renderSidebarCost,
  renderSidebarContinuation,
  renderSidebarTurns,
  renderSidebarProvider,
  renderSidebarField,
  renderSidebarSessions,
  renderSidebarApprovals,
  renderSidebarChanges,
  renderSidebarWork,
  renderSidebarManagedAgents,
  renderSlashPopover,
} from "./render.js";
import { setTuiOperatorThemeHandler } from "./operator-theme-handler.js";
import { createTuiMarkdownSyntaxTheme } from "./markdown-syntax-theme.js";
import { applyTuiMarkdownCodeMaterial } from "./markdown-code-material.js";

export interface ProviderDisplayInfo {
  readonly id: string;
  readonly group: "subscription" | "harness" | "direct-api";
  readonly models: readonly string[];
  readonly free: boolean;
  readonly available?: boolean;
  readonly reason?: string;
}

/** Spinner frames for thinking indicator. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
type RequestableTurnAuthority = OperatorTurnRequestedAuthority;
const TURN_AUTHORITY_OPTIONS: readonly RequestableTurnAuthority[] = [
  "auto",
  "read_only",
  "audited",
  "destructive",
];
const TURN_AUTHORITY_LABELS: Record<RequestableTurnAuthority, string> = {
  auto: "auto",
  read_only: "read only",
  audited: "audited",
  destructive: "destructive",
};

function operatorCommandToSlashCommand(command: OperatorCommandDefinition): SlashCommand {
  return {
    id: command.id,
    trigger: command.trigger,
    title: command.title,
    description: command.description,
    type: "builtin",
  };
}
export async function startTui(
  createSession: () => Promise<SessionLike>,
  providerDisplayInfo: readonly ProviderDisplayInfo[],
  provider: string,
  domain = "unknown",
  theme: KilnTheme = defaultTheme,
  initialContinuationInfo: Record<string, ContinuationSidebarInfo> = {},
  refreshContinuationInfo?: () => Promise<Record<string, ContinuationSidebarInfo>>,
  providerModelsRef?: { current: Record<string, string[]> },
  providerDiscoveryRef?: { current: readonly GuiProviderDiscoveryResult[] },
  loadOperatorSessionHistory?: () => Promise<readonly OperatorSessionSummary[]>,
  onContinueSession?: (session: OperatorSessionSummary) => boolean,
  refreshProviderDiscovery?: () => Promise<void> | void,
  loadSetupSnapshot?: () => Promise<KilnConfigSetupSnapshot>,
  onFirstFrame?: () => void,
  providerModelDiscoveryRef?: { current: GuiProviderModelDiscoveryProjection | null },
  executionRouteCatalogRef?: { current: ExecutionRouteCatalog | null },
  loadSettingsSnapshot?: () => Promise<KilnSettingsSnapshot>,
  proposeSettingsMutation?: (request: KilnSettingsProposalRequest) => Promise<KilnSettingsProposalProjection>,
  applySettingsMutation?: (request: KilnSettingsApplyRequest) => Promise<KilnSettingsMutationResult>,
  approveSettingsProposal?: (proposalId: string) => Promise<string>,
): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
    useMouse: false,
    backgroundColor: theme.background,
  });

  renderer.setBackgroundColor?.(theme.background);

  const terminalWidth = renderer.width ?? 120;
  const terminalHeight = renderer.height ?? 40;

  const state = createReactiveState();
  update(state, "continuationInfoByProvider", initialContinuationInfo);

  const messageNodes: {
    msg: Message;
    node: InstanceType<typeof import("@opentui/core").TextRenderable>;
  }[] = [];
  const thinkingNodeRef = {
    node: null as InstanceType<
      typeof import("@opentui/core").TextRenderable
    > | null,
  };
  const spinnerRef = {
    interval: null as ReturnType<typeof setInterval> | null,
  };

  let currentTheme = theme;
  let markdownSyntaxStyle = SyntaxStyle.fromTheme(createTuiMarkdownSyntaxTheme(currentTheme));
  let localThemeIndex = 0;
  let themePickerOpen = false;
  let themePicker: ReturnType<typeof createThemePicker> | null = null;
  let executionRoutePickerOpen = false;
  let executionRoutePicker: ReturnType<typeof createExecutionRoutePicker> | null = null;

  const providerInfoById = new Map(providerDisplayInfo.map((entry) => [entry.id, entry]));
  let executionRouteCatalog = executionRouteCatalogRef?.current ?? { routes: [] };
  let availableModels: AvailableModelCatalog | null = null;
  let routeIds = executionRouteCatalog.routes.map((route) => route.routeId);
  const routeGroups = () => [{ title: "Execution targets", routes: routeIds }];

  let routePickerState = {
    routeIndex: 0,
    providerIndex: 0,
    accountOverrideIndex: 0,
    mode: "providers" as "providers" | "available-models" | "accounts" | "auth-key" | "auth-confirm",
    authKeyBuffer: "",
  };
  let providerDiscovery = providerDiscoveryRef?.current ?? [];
  let providerModelDiscovery = providerModelDiscoveryRef?.current ?? null;
  let providerCatalogStatus: GuiProviderCatalogStatus = "ready";
  let providerCatalogError: string | null = null;

  const isDeliberationLevel = (value: unknown): value is DeliberationLevelId => (
    typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value)
  );
  const syncDeliberationLevel = () => {
    const capabilities = providerDiscovery
      .find((entry) => entry.provider === state.currentProvider)
      ?.modelCapabilities?.[state.currentModel];
    const supported = (capabilities?.deliberation?.levels.map((level) => level.id) ?? []).filter(isDeliberationLevel);
    update(state, "supportedDeliberationLevels", supported);
    if (supported.length === 0) {
      if (state.currentDeliberationLevel !== undefined) {
        update(state, "currentDeliberationLevel", undefined);
      }
      return;
    }
    if (state.currentDeliberationLevel && !supported.includes(state.currentDeliberationLevel)) {
      update(state, "currentDeliberationLevel", undefined);
    }
  };
  update(state, "currentProvider", provider);
  const initialRouteIndex = executionRouteCatalog.routes.findIndex((route) => route.providerId === provider);
  if (initialRouteIndex >= 0) {
    routePickerState.routeIndex = initialRouteIndex;
    routePickerState.providerIndex = initialRouteIndex;
    update(state, "executionRoutePickerIndex", initialRouteIndex);
    const initialRoute = executionRouteCatalog.routes[initialRouteIndex];
    if (initialRoute) {
      update(state, "currentProvider", initialRoute.providerId);
      update(state, "currentModel", initialRoute.providerModelId);
    }
  }
  syncDeliberationLevel();

  const SLASH_COMMANDS = listOperatorCommands("tui").map(operatorCommandToSlashCommand);

  update(state, "slashCommands", SLASH_COMMANDS);

  function openSessionContinuationBrowser(noSessionsTone: "muted" | "error" = "muted"): void {
    if (state.sessions.length > 0) {
      update(state, "selectedSessionIndex", 0);
      update(state, "sessionContinuationMode", true);
      renderSidebarSessions(state, currentTheme, ui);
      ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Use arrow keys to select, Enter to continue")}`;
      return;
    }
    const color = noSessionsTone === "error" ? currentTheme.error : currentTheme.textMuted;
    ui.commandBarStatus.content = t`${fg(color)("No previous sessions available")}`;
  }

  if (providerModelsRef) {
    const pollModels = () => {
      const models = providerModelsRef.current;
      if (models) {
        providerDiscovery = providerDiscoveryRef?.current ?? providerDiscovery;
        providerModelDiscovery = providerModelDiscoveryRef?.current ?? providerModelDiscovery;
        syncDeliberationLevel();
        if (executionRoutePicker) {
          renderExecutionRoutePicker();
        }
      }
    };
    setInterval(pollModels, 500);
    pollModels();
  }

  if (executionRouteCatalogRef) {
    const pollRouteCatalog = () => {
      const catalog = executionRouteCatalogRef.current;
      if (!catalog) return;
      const selectedRouteId = executionRouteCatalog.routes[routePickerState.routeIndex]?.routeId
        ?? catalog.routes.find((route) => route.providerId === state.currentProvider)?.routeId;
      executionRouteCatalog = catalog;
      routeIds = catalog.routes.map((route) => route.routeId);
      const selectedIndex = selectedRouteId ? routeIds.indexOf(selectedRouteId) : -1;
      if (selectedIndex >= 0) {
        routePickerState.routeIndex = selectedIndex;
        routePickerState.providerIndex = selectedIndex;
      }
      if (executionRoutePicker) {
        renderExecutionRoutePicker();
      }
    };
    setInterval(pollRouteCatalog, 500);
    pollRouteCatalog();
  }

  const themeNames = listThemeNames() as Array<keyof typeof themes>;
  const themeValues = Object.values(themes);

  const { t, fg } = await import("@opentui/core");

  const ui = initUI(
    renderer,
    state,
    currentTheme,
    provider,
    domain,
    terminalWidth,
    terminalHeight,
    (text: string) => {
      // Always clear state.input when the textarea's onSubmit fires.
      // inputTextarea.clear() only clears the visual widget; state.input must
      // be reset separately or leftover text bleeds into subsequent keypresses.
      update(state, "input", "");

      if (text === "/clear") {
        void (async () => {
          const session = await createSession();
          const hasClear =
            typeof (session as unknown as { clear?: unknown }).clear ===
            "function";
          if (hasClear) {
            try {
              await (
                session as unknown as { clear: () => Promise<void> }
              ).clear();
            } catch {
              // fail-open
            }
          }
          const statusNode = new (
            await import("@opentui/core")
          ).TextRenderable(renderer, {
            content: t`${fg(currentTheme.accent)("Session cleared. Starting fresh next turn.")}`,
            width: "100%",
          });
          ui.chatScrollBox.content.add(statusNode);
          update(state, "messages", [...state.messages]);
        })();
        return;
      }

      if (text === "/plan" && !state.planMode) {
        void (async () => {
          update(state, "planMode", true);
          renderSidebarProvider(state, currentTheme, ui, domain);
          const planNode = new (
            await import("@opentui/core")
          ).TextRenderable(renderer, {
            content: t`${fg(currentTheme.warning)("Plan mode enabled. Run /exec when ready to execute.")}`,
            width: "100%",
          });
          ui.chatScrollBox.content.add(planNode);
        })();
        return;
      }

      if (text === "/exec" && state.planMode) {
        void (async () => {
          const session = await createSession();
          const executePlanMode = (session as unknown as { executePlanMode?: unknown }).executePlanMode;
          if (typeof executePlanMode === "function") {
            executePlanMode.call(session);
          }
          update(state, "planMode", false);
          renderSidebarProvider(state, currentTheme, ui, domain);
          const execNode = new (
            await import("@opentui/core")
          ).TextRenderable(renderer, {
            content: t`${fg(currentTheme.accent)("Execution mode enabled.")}`,
            width: "100%",
          });
          ui.chatScrollBox.content.add(execNode);
        })();
        return;
      }

      if (text === "/theme") {
        openThemePicker();
        return;
      }

      if (text === "/target") {
        openExecutionRoutePicker();
        return;
      }

      if (text === "/deliberation") {
        cycleDeliberationLevel();
        return;
      }

      if (text === "/authority") {
        cycleRequestedAuthority();
        return;
      }

      if (text === "/continue") {
        openSessionContinuationBrowser();
        return;
      }

      if (text === "/setup") {
        void showSetupStatus();
        return;
      }

      if (text === "/settings" || text.startsWith("/settings ")) {
        void handleSettingsCommand(text.slice("/settings".length).trim());
        return;
      }

      if (text === "/goal") {
        renderSidebarWork(state, currentTheme, ui);
        ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Goal workflow visible in work sidebar")}`;
        return;
      }

      update(state, "sessionContinuationMode", false);
      void sendMessage(
        {
          renderer,
          state,
          theme: () => currentTheme,
          markdownSyntaxStyle: () => markdownSyntaxStyle,
          ui,
          chatScrollBox: ui.chatScrollBox,
          sidebarToolsBox: ui.sidebarToolsBox,
          sidebarToolNode: null,
          messageNodes,
          createSession,
          refreshContinuationInfo,
          provider,
          domain,
          renderSidebarApprovals: () => renderSidebarApprovals(state, currentTheme, ui),
          renderSidebarChanges: () => renderSidebarChanges(state, currentTheme, ui),
          renderSidebarWork: () => renderSidebarWork(state, currentTheme, ui),
          renderSidebarManagedAgents: () => renderSidebarManagedAgents(state, currentTheme, ui),
        },
        text,
        thinkingNodeRef,
        () => renderSidebarCost(state, currentTheme, ui),
        () => renderSidebarTurns(state, currentTheme, ui),
        () => renderSidebarProvider(state, currentTheme, ui, domain),
        () => renderSidebarContinuation(state, currentTheme, ui),
        renderCommandBarStatus,
        startSpinner,
        stopSpinner,
        spinnerRef,
      );
    },
  );
  const clearOperatorThemeHandler = setTuiOperatorThemeHandler(async (request) => {
    const themeName = isOperatorThemeName(request.theme) ? request.theme : undefined;
    if (!themeName) {
      return { ok: false, error: `Unknown theme '${request.theme}'.` };
    }
    const requestedTheme = themes[themeName];
    if (!requestedTheme) {
      return { ok: false, error: `Unknown theme '${request.theme}'.` };
    }
    applyTheme(requestedTheme);
    ui.commandBarStatus.content = t`${fg(currentTheme.accent)(
      `Theme: ${OPERATOR_THEME_LABELS[themeName]}`,
    )}`;
    return { ok: true, appliedTheme: themeName };
  });

  function cycleDeliberationLevel(): void {
    if (state.supportedDeliberationLevels.length === 0) {
      ui.commandBarStatus.content = t`${fg(currentTheme.textMuted)("No deliberation levels are advertised for this model")}`;
      return;
    }
    const levels: Array<DeliberationLevelId | undefined> = [undefined, ...state.supportedDeliberationLevels];
    const currentIndex = levels.indexOf(state.currentDeliberationLevel);
    const nextLevel = levels[(currentIndex + 1) % levels.length];
    update(state, "currentDeliberationLevel", nextLevel);
    renderSidebarProvider(state, currentTheme, ui, domain);
    ui.commandBarStatus.content = t`${fg(currentTheme.accent)(`Deliberation: ${nextLevel ?? "provider default"}`)}`;
  }

  function cycleRequestedAuthority(): void {
    const currentIndex = TURN_AUTHORITY_OPTIONS.indexOf(state.currentRequestedAuthority);
    const nextAuthority = TURN_AUTHORITY_OPTIONS[
      (currentIndex + 1) % TURN_AUTHORITY_OPTIONS.length
    ];
    if (!nextAuthority) return;
    update(state, "currentRequestedAuthority", nextAuthority);
    renderSidebarProvider(state, currentTheme, ui, domain);
    ui.commandBarStatus.content = t`${fg(currentTheme.accent)(`Authority: ${TURN_AUTHORITY_LABELS[nextAuthority]}`)}`;
  }

  renderSidebarCost(state, currentTheme, ui);
  renderSidebarTurns(state, currentTheme, ui);
  renderSidebarProvider(state, currentTheme, ui, domain);
  renderSidebarContinuation(state, currentTheme, ui);
  renderSidebarField(state, currentTheme, ui);
  renderSidebarApprovals(state, currentTheme, ui);
  renderSidebarChanges(state, currentTheme, ui);
  renderSidebarWork(state, currentTheme, ui);
  renderSidebarManagedAgents(state, currentTheme, ui);

  // Load session history into sidebar
  if (loadOperatorSessionHistory) {
    try {
      const sessions = await loadOperatorSessionHistory();
      update(state, "sessions", [...sessions]);
      renderSidebarSessions(state, currentTheme, ui);
    } catch {
      // fail-open — sessions are optional
    }
  }

  renderer.start();

  const applySidebarVisibility = (visible: boolean): void => {
    ui.sidebar.width = visible ? 42 : 0;
    update(state, "sidebarVisible", visible);
  };

  applySidebarVisibility(renderer.width >= 100);
  onFirstFrame?.();

  if (typeof (renderer as unknown as { on?: unknown }).on === "function") {
    (
      renderer as unknown as { on: (event: string, cb: () => void) => void }
    ).on("resize", () => {
      applySidebarVisibility(renderer.width >= 100);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Execution target picker helpers
  // ─────────────────────────────────────────────────────────────────────────

  function getRouteEntries(): readonly ExecutionRouteCatalogEntry[] {
    return executionRouteCatalog.routes;
  }

  function getCurrentRoute(): ExecutionRouteCatalogEntry | undefined {
    return getRouteEntries()[routePickerState.routeIndex];
  }

  function getAccountOverrideOptions(
    route: ExecutionRouteCatalogEntry | undefined = getCurrentRoute(),
  ): readonly (string | undefined)[] {
    if (route?.accountSelection.mode !== "automatic") {
      return [];
    }
    const accountOverrideIds = route.accountOverrideIds ?? [];
    return accountOverrideIds.length > 0 ? [undefined, ...accountOverrideIds] : [];
  }

  function getCurrentProvider(): string {
    return getCurrentRoute()?.providerId ?? "";
  }

  function getProviderDiscovery(providerName: string): GuiProviderDiscoveryResult | undefined {
    return providerDiscovery.find((entry) => entry.provider === providerName);
  }

  function getProviderDiagnosticReason(providerName: string): string | undefined {
    return providerModelDiscovery?.entries.find((entry) => (
      entry.providerRoute.providerId === providerName
      && !entry.eligibility.eligible
      && entry.eligibility.reasonCodes.length > 0
    ))?.eligibility.reasonCodes.join(", ");
  }

  function routeIsSelectable(route: ExecutionRouteCatalogEntry | undefined): boolean {
    return route?.availability === "available";
  }

  function providerCanAuthenticate(providerName: string): boolean {
    const route = executionRouteCatalog.routes.find((entry) => entry.routeId === providerName);
    const providerId = route?.providerId ?? providerName;
    const metadata = getGuiProviderMetadata(providerId);
    if (!metadata?.authMethod) {
      return false;
    }
    const discovery = getProviderDiscovery(providerId);
    if (!discovery || discovery.available) {
      return false;
    }
    return discovery.authState === "missing"
      || discovery.authState === "expired"
      || /auth|api[_ -]?key|credential/i.test(discovery.reason);
  }

  function getProviderReason(providerName: string): string | undefined {
    const route = executionRouteCatalog.routes.find((entry) => entry.routeId === providerName);
    if (route) return getRouteReason(route);
    const reason = getProviderDiagnosticReason(providerName)
      ?? getProviderDiscovery(providerName)?.reason
      ?? providerInfoById.get(providerName)?.reason;
    return reason ? conciseUnavailableReason(reason) : undefined;
  }

  function providerIsSelectable(providerName: string): boolean {
    return routeIsSelectable(executionRouteCatalog.routes.find((entry) => entry.routeId === providerName));
  }

  function getRouteReason(route: ExecutionRouteCatalogEntry | undefined): string | undefined {
    if (!route || route.availability === "available") return undefined;
    const reason = route.reasonCodes.join(", ");
    const repair = route.repairActions.length > 0
      ? " (" + route.repairActions.join(", ") + ")"
      : "";
    return conciseUnavailableReason(
      route.availability + ": " + (reason || "route evidence unavailable") + repair,
    );
  }

  function markProviderCatalog(status: GuiProviderCatalogStatus, error: string | null = null): void {
    providerCatalogStatus = status;
    providerCatalogError = error;
    if (executionRoutePicker) {
      renderExecutionRoutePicker();
    }
  }

  function conciseUnavailableReason(reason: string): string {
    const normalized = reason.trim();
    if (normalized.length === 0) {
      return "";
    }
    if (/auth|api[_ -]?key|credential/i.test(normalized)) {
      return "Auth is missing.";
    }
    if (/daemon.*not reachable|not reachable|connection|ECONNREFUSED/i.test(normalized)) {
      return "Local service is unreachable.";
    }
    if (/empty model list|no installed models|no models/i.test(normalized)) {
      return "No models found.";
    }
    if (/endpoint.*failed|request failed/i.test(normalized)) {
      return "Model endpoint failed.";
    }
    return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;
  }

  function getProviderLabel(providerName: string): string {
    const route = executionRouteCatalog.routes.find((entry) => entry.routeId === providerName);
    if (route) return route.label;
    return providerInfoById.get(providerName)?.free
      ? `${providerName} (free)`
      : providerName;
  }

  function getProviderRowId(providerName: string): string {
    return `route-item-${providerName}`;
  }

  function findProviderRow(providerName: string):
    | InstanceType<typeof TextRenderable>
    | undefined {
    if (!executionRoutePicker) return undefined;
    const targetId = getProviderRowId(providerName);
    return executionRoutePicker.rows.find((row) => row.id === targetId);
  }

  /**
   * Destroys all dynamic data rows from scrollBox.content.
   * title and hint are in the outer panel, not the scrollBox, so they are
   * unaffected.
   */
  function clearPickerRows(): void {
    if (!executionRoutePicker) return;
    for (const row of executionRoutePicker.rows) {
      row.destroy();
    }
    executionRoutePicker.rows = [];
  }

  /**
   * Creates a single picker row TextRenderable.
   * height:1 — each row is exactly 1 terminal line, giving precise per-row
   * scrolling (height:2 doubles every delta and was the cause of the
   * "page jump" feel).
   */
  function makePickerRow(
    id: string,
    label: string,
    selected: boolean,
    selectedColor: string,
    normalColor: string,
    prefix: string,
  ): InstanceType<typeof TextRenderable> {
    return new TextRenderable(renderer, {
      id,
      content: t`${fg(selected ? selectedColor : normalColor)(prefix + label)}`,
      width: "100%",
      height: 1,
    });
  }

  /**
   * Fully rebuilds the data rows in the scrollBox.
   * Called only on mode/target switches — NOT on every up/down keypress.
   * Navigation updates are handled by updatePickerSelection() instead.
   */
  function renderExecutionRoutePicker(): void {
    if (!executionRoutePicker) return;

    clearPickerRows();

    const scrollContent = executionRoutePicker.scrollBox.content;
    if (providerCatalogStatus !== "ready") {
      executionRoutePicker.mode = "routes";
      executionRoutePicker.title.content = t`${fg(currentTheme.accent)(" Execution targets ")}`;
      const loadingLabel = providerCatalogStatus === "error"
        ? (providerCatalogError ?? "Provider discovery failed.")
        : providerCatalogStatus === "refreshing"
          ? "Refreshing execution targets..."
          : "Loading execution target catalog...";
      const row = makePickerRow(
        "provider-catalog-status",
        loadingLabel,
        true,
        providerCatalogStatus === "error" ? currentTheme.error : currentTheme.accent,
        currentTheme.textMuted,
        "",
      );
      scrollContent.add(row);
      executionRoutePicker.rows.push(row);
      executionRoutePicker.hint.content = providerCatalogStatus === "error"
        ? t`${fg(currentTheme.textMuted)("r retry  Esc cancel")}`
        : t`${fg(currentTheme.textMuted)("please wait  Esc cancel")}`;
      return;
    }

    if (routePickerState.mode === "available-models") {
      executionRoutePicker.mode = "routes";
      executionRoutePicker.title.content = t`${fg(currentTheme.accent)(" Available Models (read-only) ")}`;
      const entries = availableModels?.entries ?? [];
      const labels = entries.length > 0
        ? entries.map((entry) => `${entry.providerId}/${entry.providerModelId} - ${entry.discoveryState}, ${entry.eligibilityState}, ${entry.configuredState}`)
        : ["No current Runtime model evidence."];
      for (const [index, label] of labels.entries()) {
        const row = makePickerRow(`available-model-${index}`, label, false, currentTheme.accent, currentTheme.textMuted, "");
        scrollContent.add(row);
        executionRoutePicker.rows.push(row);
      }
      executionRoutePicker.hint.content = t`${fg(currentTheme.textMuted)("a back to routes  r refresh  Esc cancel")}`;
      return;
    }

    if (routePickerState.mode === "providers") {
      executionRoutePicker.mode = "routes";
      executionRoutePicker.title.content = t`${fg(currentTheme.accent)(" Select Execution Route ")}`;

      for (const group of routeGroups()) {
        const groupId = group.title.toLowerCase().replace(/\s+/g, "-");
        const headerRow = makePickerRow(
          `provider-group-${groupId}`,
          `[${group.title}]`,
          false,
          currentTheme.border,
          currentTheme.textMuted,
          "",
        );
        scrollContent.add(headerRow);
        executionRoutePicker.rows.push(headerRow);

        for (const routeId of group.routes) {
          const selected = routeIds[routePickerState.routeIndex] === routeId;
          const label = getProviderLabel(routeId);
          const reason = getProviderReason(routeId);
          const selectable = providerIsSelectable(routeId);
          const authenticatable = providerCanAuthenticate(routeId);
          const row = makePickerRow(
            getProviderRowId(routeId),
            selectable || !reason
              ? label
              : `${label} - ${authenticatable ? "sign in" : reason}`,
            selected,
            currentTheme.accent,
            currentTheme.textMuted,
            selected ? "● " : "○ ",
          );
          scrollContent.add(row);
          executionRoutePicker.rows.push(row);
        }
      }

      executionRoutePicker.hint.content = t`${fg(currentTheme.textMuted)("↑↓ navigate  Enter select/login  r refresh  Esc cancel")}`;
      return;
    }

    if (routePickerState.mode === "accounts") {
      const route = getCurrentRoute();
      const accountOptions = getAccountOverrideOptions(route);
      executionRoutePicker.mode = "accounts";
      executionRoutePicker.title.content = t`${fg(currentTheme.accent)(` ${route?.label ?? "Execution target"} account `)}`;
      for (const [index, accountOverrideId] of accountOptions.entries()) {
        const selected = index === routePickerState.accountOverrideIndex;
        const row = makePickerRow(
          `route-account-${index}`,
          accountOverrideId ?? "Automatic (Kiln)",
          selected,
          currentTheme.accent,
          currentTheme.textMuted,
          selected ? "• " : "◦ ",
        );
        scrollContent.add(row);
        executionRoutePicker.rows.push(row);
      }
      executionRoutePicker.hint.content = t`${fg(currentTheme.textMuted)("up/down navigate  Enter select  Esc back")}`;
      return;
    }

    if (routePickerState.mode === "auth-key") {
      executionRoutePicker.mode = "auth-key";
      const providerName = getCurrentProvider();
      executionRoutePicker.title.content = t`${fg(currentTheme.accent)(` ${providerName} API key `)}`;
      const masked = routePickerState.authKeyBuffer.length > 0
        ? "*".repeat(Math.min(routePickerState.authKeyBuffer.length, 48))
        : "<paste key>";
      const row = makePickerRow(
        `provider-auth-key-${providerName}`,
        masked,
        true,
        currentTheme.primary,
        currentTheme.textMuted,
        "",
      );
      scrollContent.add(row);
      executionRoutePicker.rows.push(row);
      executionRoutePicker.hint.content = t`${fg(currentTheme.textMuted)("paste key  Backspace edit  Enter link  Esc back")}`;
      return;
    }

    if (routePickerState.mode === "auth-confirm") {
      executionRoutePicker.mode = "auth-confirm";
      const providerName = getCurrentProvider();
      executionRoutePicker.title.content = t`${fg(currentTheme.accent)(` Authenticate ${providerName} `)}`;
      const row = makePickerRow(
        `provider-auth-confirm-${providerName}`,
        `Press Enter to start browser sign-in for ${providerName}`,
        true,
        currentTheme.primary,
        currentTheme.textMuted,
        "",
      );
      scrollContent.add(row);
      executionRoutePicker.rows.push(row);
      executionRoutePicker.hint.content = t`${fg(currentTheme.textMuted)("Enter authenticate  Esc back")}`;
      return;
    }

    // The route catalog is the sole picker authority. Authentication modes
    // return to the route list above; provider/model discovery is evidence only.
  }

  /**
   * Updates only the two rows whose visual state changed (prev → next
   * selection). Does NOT destroy/recreate any nodes, so child y-positions
   * remain stable and scrollChildIntoView() works correctly on the same tick.
   */
  function updatePickerSelection(prevIdx: number, nextIdx: number): void {
    if (!executionRoutePicker) return;

    const isProviders = routePickerState.mode === "providers";

    if (isProviders) {
      const prevProvider = routeIds[prevIdx];
      const nextProvider = routeIds[nextIdx];
      if (!prevProvider || !nextProvider) return;

      const prevRow = findProviderRow(prevProvider);
      const nextRow = findProviderRow(nextProvider);

      if (prevRow) {
        const reason = getProviderReason(prevProvider);
        const label = providerIsSelectable(prevProvider) || !reason
          ? getProviderLabel(prevProvider)
          : `${getProviderLabel(prevProvider)} - ${providerCanAuthenticate(prevProvider) ? "sign in" : reason}`;
        prevRow.content = t`${fg(currentTheme.textMuted)(`○ ${label}`)}`;
      }
      if (nextRow) {
        const reason = getProviderReason(nextProvider);
        const label = providerIsSelectable(nextProvider) || !reason
          ? getProviderLabel(nextProvider)
          : `${getProviderLabel(nextProvider)} - ${providerCanAuthenticate(nextProvider) ? "sign in" : reason}`;
        nextRow.content = t`${fg(currentTheme.accent)(`● ${label}`)}`;
      }
      return;
    }

    if (routePickerState.mode === "accounts") {
      const accountOptions = getAccountOverrideOptions();
      const prevRow = executionRoutePicker.rows[prevIdx];
      const nextRow = executionRoutePicker.rows[nextIdx];
      if (prevRow) {
        prevRow.content = t`${fg(currentTheme.textMuted)(`◦ ${accountOptions[prevIdx] ?? "Automatic (Kiln)"}`)}`;
      }
      if (nextRow) {
        nextRow.content = t`${fg(currentTheme.accent)(`• ${accountOptions[nextIdx] ?? "Automatic (Kiln)"}`)}`;
      }
      return;
    }

    const names = routeIds;
    const prevRow = executionRoutePicker.rows[prevIdx];
    const nextRow = executionRoutePicker.rows[nextIdx];

    if (prevRow) {
      const label = names[prevIdx] ?? "";
      prevRow.content = t`${fg(currentTheme.textMuted)(`  ${label}`)}`;
    }
    if (nextRow) {
      const label = names[nextIdx] ?? "";
      nextRow.content = t`${fg(currentTheme.primary)(`● ${label}`)}`;
    }
  }

  /**
   * Scrolls so the selected row is visible. Uses the native
   * scrollChildIntoView() which correctly handles absolute screen coords.
   *
   * @param center  When true, tries to center the selected row in the
   *                viewport (used on open / mode switch).
   */
  function scrollToSelectedRow(center = false): void {
    if (!executionRoutePicker) return;

    const targetRow = (() => {
      if (routePickerState.mode === "providers") {
        const selectedProvider = routeIds[routePickerState.providerIndex];
        return selectedProvider
          ? findProviderRow(selectedProvider)
          : undefined;
      }
      if (routePickerState.mode === "accounts") {
        return executionRoutePicker.rows[routePickerState.accountOverrideIndex];
      }
      return undefined;
    })();
    if (!targetRow) return;

    const scrollBox = executionRoutePicker.scrollBox;

    if (center) {
      const contentY = scrollBox.content.y;
      const currentScrollTop = scrollBox.scrollTop;
      const rowContentY = targetRow.y - contentY + currentScrollTop;
      const rowHeight = targetRow.height;
      const viewportH = scrollBox.viewport.height;
      const centeredScrollTop = Math.max(
        0,
        rowContentY - Math.floor((viewportH - rowHeight) / 2),
      );
      scrollBox.scrollTo(centeredScrollTop);
      return;
    }

    // Edge-scroll: let OpenTUI decide the minimal scroll needed.
    scrollBox.scrollChildIntoView(targetRow.id);
  }

  async function loadExecutionRouteCatalogFromSession(): Promise<void> {
    try {
      const session = await createSession();
      const catalog = (session as unknown as {
        executionRouteCatalog?: ExecutionRouteCatalog;
      }).executionRouteCatalog;
      availableModels = (session as unknown as { availableModels?: AvailableModelCatalog }).availableModels ?? availableModels;
      if (!catalog || !Array.isArray(catalog.routes) || catalog.routes.length === 0) return;
      const selectedRouteId = executionRouteCatalog.routes[routePickerState.routeIndex]?.routeId
        ?? catalog.routes.find((route) => route.providerId === state.currentProvider)?.routeId;
      executionRouteCatalog = catalog;
      routeIds = catalog.routes.map((route) => route.routeId);
      const selectedIndex = selectedRouteId ? routeIds.indexOf(selectedRouteId) : -1;
      routePickerState.routeIndex = selectedIndex >= 0 ? selectedIndex : 0;
      routePickerState.providerIndex = routePickerState.routeIndex;
      const selectedRoute = catalog.routes[routePickerState.routeIndex];
      if (selectedRoute) {
        update(state, "currentProvider", selectedRoute.providerId);
        update(state, "currentModel", selectedRoute.providerModelId);
      }
    update(state, "executionRoutePickerIndex", routePickerState.routeIndex);
      renderExecutionRoutePicker();
      process.nextTick(() => {
        scrollToSelectedRow(true);
      });
    } catch {
      // The picker remains usable with the latest catalog/ref projection.
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Execution target picker lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  void loadExecutionRouteCatalogFromSession();

  function openExecutionRoutePicker(): void {
    if (executionRoutePicker) return;

    const activeRouteIndex = executionRouteCatalog.routes.findIndex(
      (route) => route.routeId === state.currentProvider || route.providerId === state.currentProvider,
    );
    routePickerState.providerIndex = activeRouteIndex >= 0 ? activeRouteIndex : 0;
    routePickerState.routeIndex = routePickerState.providerIndex;
    routePickerState.accountOverrideIndex = 0;
    routePickerState.mode = "providers";

    executionRoutePickerOpen = true;
    executionRoutePicker = createExecutionRoutePicker(
      renderer,
      currentTheme,
      terminalWidth,
      terminalHeight,
    );

    update(state, "executionRoutePickerOpen", true);

    renderExecutionRoutePicker();
    executionRoutePicker.scrollBox.scrollTo(0);
    process.nextTick(() => {
      scrollToSelectedRow(true);
    });
    void loadExecutionRouteCatalogFromSession();
  }

  async function closeExecutionRoutePicker(
    apply: boolean,
    accountOverrideId?: string,
  ): Promise<void> {
    if (!executionRoutePicker) return;

    const destroyPicker = () => {
      if (!executionRoutePicker) return;
      destroyExecutionRoutePicker(executionRoutePicker);
      executionRoutePicker = null;
      executionRoutePickerOpen = false;
      update(state, "executionRoutePickerOpen", false);
    };

    if (!apply) {
      destroyPicker();
      return;
    }

    try {
      if (providerCatalogStatus !== "ready") {
        throw new Error(providerCatalogStatus === "error"
          ? (providerCatalogError ?? "Provider discovery is unavailable")
          : "Provider discovery is still loading");
      }
      const selectedRoute = getRouteEntries()[routePickerState.routeIndex];
      if (!selectedRoute || !routeIsSelectable(selectedRoute)) {
        throw new Error(getRouteReason(selectedRoute) ?? "Execution target is unavailable");
      }

      ui.commandBarStatus.content = t`${fg(currentTheme.accent)(`Selecting execution target ${selectedRoute.label}…`)}`;
      const session = await createSession();
      const switchExecutionRoute =
        (
          session as unknown as {
            switchExecutionRoute?: unknown;
          }
        ).switchExecutionRoute;
      if (typeof switchExecutionRoute !== "function") {
        throw new Error("Active session does not support execution target selection");
      }

      const selectRoute = switchExecutionRoute as (
        routeId: string,
        accountOverrideId?: string,
      ) => Promise<string>;
      if (accountOverrideId) {
        await selectRoute(selectedRoute.routeId, accountOverrideId);
      } else {
        await selectRoute(selectedRoute.routeId);
      }

      update(state, "currentProvider", selectedRoute.providerId);
      update(state, "currentModel", selectedRoute.providerModelId);
      syncDeliberationLevel();
      update(state, "routeMode", "user");
      update(state, "executionRoutePickerIndex", routePickerState.routeIndex);
      renderSidebarProvider(state, currentTheme, ui, domain);
      renderSidebarContinuation(state, currentTheme, ui);
      ui.commandBarStatus.content = t`${fg(currentTheme.accent)(`Execution target selected: ${selectedRoute.label}`)}`;
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Execution target selection failed";
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Execution target selection failed: ${message}`)}`;
    } finally {
      destroyPicker();
    }
  }

  async function refreshExecutionRoutesFromPicker(): Promise<void> {
    if (!executionRoutePicker) return;
    markProviderCatalog("refreshing");
    ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Refreshing execution targets...")}`;
    try {
      const session = await createSession();
      const sessionRefreshRoutes = (
        session as unknown as { refreshExecutionRoutes?: unknown }
      ).refreshExecutionRoutes;
      if (typeof sessionRefreshRoutes === "function") {
        await (sessionRefreshRoutes as () => Promise<void>).call(session);
      }
      const refreshedCatalog = (session as unknown as {
        executionRouteCatalog?: ExecutionRouteCatalog;
      }).executionRouteCatalog;
      if (refreshedCatalog && refreshedCatalog.routes.length > 0) {
        const selectedRouteId = getCurrentRoute()?.routeId;
        executionRouteCatalog = refreshedCatalog;
        routeIds = refreshedCatalog.routes.map((route) => route.routeId);
        const selectedIndex = selectedRouteId ? routeIds.indexOf(selectedRouteId) : -1;
        if (selectedIndex >= 0) {
          routePickerState.routeIndex = selectedIndex;
          routePickerState.providerIndex = selectedIndex;
        }
      }
      await refreshProviderDiscovery?.();
      providerDiscovery = providerDiscoveryRef?.current ?? providerDiscovery;
      providerModelDiscovery = providerModelDiscoveryRef?.current ?? providerModelDiscovery;
      markProviderCatalog("ready");
      renderExecutionRoutePicker();
      process.nextTick(() => {
        scrollToSelectedRow(false);
      });
      ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Execution target catalog refreshed")}`;
    } catch (error) {
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Execution target refresh failed";
      markProviderCatalog("error", message);
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Execution target refresh failed: ${message}`)}`;
    }
  }

  function returnToProviderMode(): void {
    if (!executionRoutePicker) return;
    if (routePickerState.mode === "providers") return;

    routePickerState.mode = "providers";
    routePickerState.accountOverrideIndex = 0;
    routePickerState.authKeyBuffer = "";
    renderExecutionRoutePicker();
    executionRoutePicker.scrollBox.scrollTo(0);
    process.nextTick(() => {
      scrollToSelectedRow(true);
    });
  }

  async function authenticateSelectedProvider(apiKey?: string): Promise<void> {
    const selectedProvider = getCurrentProvider();
    const metadata = getGuiProviderMetadata(selectedProvider);
    if (!metadata?.authMethod) {
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Provider '${selectedProvider}' does not support interactive authentication`)}`;
      return;
    }
    markProviderCatalog("refreshing");
    ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Provider authentication in progress...")}`;
    try {
      const session = await createSession();
      const authenticateProvider = (
        session as unknown as {
          authenticateProvider?: (
            providerName: string,
            options?: {
              readonly apiKey?: string;
              readonly tier?: "go" | "zen";
              readonly onStarted?: (details: { verificationUri: string; userCode: string; message?: string }) => void;
            },
          ) => Promise<void>;
        }
      ).authenticateProvider;
      if (typeof authenticateProvider !== "function") {
        throw new Error("Active session does not support provider authentication");
      }
      await authenticateProvider(selectedProvider, {
        ...(apiKey ? { apiKey } : {}),
        ...(metadata.authTier ? { tier: metadata.authTier } : {}),
        onStarted: (details) => {
          ui.commandBarStatus.content = t`${fg(currentTheme.accent)(`Open ${details.verificationUri} and enter ${details.userCode}`)}`;
        },
      });
      const authenticatedCatalog = (session as unknown as {
        executionRouteCatalog?: ExecutionRouteCatalog;
      }).executionRouteCatalog;
      if (!authenticatedCatalog || !Array.isArray(authenticatedCatalog.routes)) {
        throw new Error("Provider authentication completed without an execution target catalog");
      }
      const selectedRouteId = getCurrentRoute()?.routeId;
      executionRouteCatalog = authenticatedCatalog;
      routeIds = authenticatedCatalog.routes.map((route) => route.routeId);
      const selectedIndex = selectedRouteId ? routeIds.indexOf(selectedRouteId) : -1;
      routePickerState.routeIndex = selectedIndex >= 0 ? selectedIndex : 0;
      routePickerState.providerIndex = routePickerState.routeIndex;
      routePickerState.accountOverrideIndex = 0;
      providerDiscovery = providerDiscoveryRef?.current ?? providerDiscovery;
      providerModelDiscovery = providerModelDiscoveryRef?.current ?? providerModelDiscovery;
      markProviderCatalog("ready");
      routePickerState.mode = "providers";
      routePickerState.authKeyBuffer = "";
      renderExecutionRoutePicker();
      ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Provider authentication completed")}`;
    } catch (error) {
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Provider authentication failed";
      markProviderCatalog("error", message);
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Provider authentication failed: ${message}`)}`;
    }
  }

  function navigateExecutionRoutePicker(direction: number): void {
    if (!executionRoutePicker) return;

    const inProviderMode = routePickerState.mode === "providers";
    const inAccountMode = routePickerState.mode === "accounts";
    const choices = inAccountMode ? getAccountOverrideOptions() : routeIds;
    if (choices.length === 0) return;

    const prevIdx = inProviderMode
      ? routePickerState.providerIndex
      : inAccountMode
        ? routePickerState.accountOverrideIndex
        : routePickerState.routeIndex;
    const nextIdx = (prevIdx + direction + choices.length) % choices.length;
    if (nextIdx === prevIdx) return;

    if (inProviderMode) {
      routePickerState.providerIndex = nextIdx;
      routePickerState.routeIndex = nextIdx;
      update(state, "executionRoutePickerIndex", nextIdx);
    } else if (inAccountMode) {
      routePickerState.accountOverrideIndex = nextIdx;
    } else {
      routePickerState.routeIndex = nextIdx;
    }

    updatePickerSelection(prevIdx, nextIdx);
    process.nextTick(() => {
      scrollToSelectedRow(false);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Theme picker
  // ─────────────────────────────────────────────────────────────────────────

  function openThemePicker(): void {
    if (themePicker) return;

    themePickerOpen = true;
    const currentName =
      themeNames.find((name) => themes[name] === currentTheme) ??
      "phosphor";
    localThemeIndex = Math.max(0, themeNames.indexOf(currentName));

    themePicker = createThemePicker(
      renderer,
      currentTheme,
      themeNames,
      terminalWidth,
      terminalHeight,
      localThemeIndex,
    );
    update(state, "themePickerOpen", true);
  }

  function closeThemePicker(apply: boolean): void {
    if (!themePicker) return;

    if (!apply) {
      const selectedThemeName = themeNames[localThemeIndex];
      const selectedTheme = selectedThemeName
        ? themes[selectedThemeName]
        : undefined;
      applyTheme(selectedTheme ?? defaultTheme);
    }

    destroyThemePicker(themePicker);
    themePicker = null;
    themePickerOpen = false;
    update(state, "themePickerOpen", false);
  }

  function navigateThemePicker(direction: number): void {
    localThemeIndex =
      (localThemeIndex + direction + themeNames.length) % themeNames.length;

    if (themePicker) {
      for (let i = 0; i < themePicker.items.length; i++) {
        const isSelected = i === localThemeIndex;
        const name = themeNames[i];
        const prefix = isSelected ? "● " : "  ";
        const item = themePicker.items[i];
        if (item) {
          item.content = t`${fg(isSelected ? currentTheme.accent : currentTheme.textMuted)(prefix + name)}`;
        }
      }

      if (localThemeIndex >= 0 && localThemeIndex < themeValues.length) {
        const previewTheme = themeValues[localThemeIndex];
        if (previewTheme) {
          applyTheme(previewTheme);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Theme application
  // ─────────────────────────────────────────────────────────────────────────

  function applyTheme(newTheme: KilnTheme): void {
    currentTheme = newTheme;
    const previousMarkdownSyntaxStyle = markdownSyntaxStyle;
    markdownSyntaxStyle = SyntaxStyle.fromTheme(createTuiMarkdownSyntaxTheme(currentTheme));
    renderer.setBackgroundColor(currentTheme.background);
    ui.rootContainer.backgroundColor = currentTheme.background;
    ui.chatColumn.backgroundColor = currentTheme.background;
    ui.chatScrollBox.backgroundColor = currentTheme.background;
    ui.inputContainer.backgroundColor = currentTheme.backgroundElement;
    ui.commandBar.backgroundColor = currentTheme.background;
    ui.sidebar.backgroundColor = currentTheme.backgroundPanel;

    renderSidebarProvider(state, currentTheme, ui, domain);
    renderSidebarContinuation(state, currentTheme, ui);

    ui.sidebarCostText.content = t`${fg(currentTheme.textMuted)(`$${state.cost.toFixed(4)}`)}`;
    ui.sidebarCwdText.content = t`${fg(currentTheme.textMuted)(shortPath(process.cwd()))}`;
    ui.sidebarTurnsText.content = t`${fg(currentTheme.textMuted)(`turns: ${state.turns}  tok: ${state.inputTokens >= 1000 ? (state.inputTokens / 1000).toFixed(1) + "k" : state.inputTokens}/${state.outputTokens >= 1000 ? (state.outputTokens / 1000).toFixed(1) + "k" : state.outputTokens}`)}`;
    ui.sidebarDivider.content = t`${fg(currentTheme.border)("─".repeat(38))}`;

    if (executionRoutePicker) {
      renderExecutionRoutePicker();
    }

    renderInput();
    renderCommandBarStatus();
    ui.commandBarText.content = t`${fg(currentTheme.textMuted)("/settings [query|set|reset] /setup /target  ctrl+shift+P commands")}`;

    for (const { msg, node } of messageNodes) {
      const parent = node.parent;
      if (parent && "backgroundColor" in parent) {
        (parent as unknown as { backgroundColor: string }).backgroundColor =
          msg.role === "user"
            ? currentTheme.userBg
            : msg.role === "assistant"
              ? currentTheme.assistantBg
              : currentTheme.background;
      }
      if (node instanceof MarkdownRenderable) {
        node.fg = currentTheme.text;
        node.syntaxStyle = markdownSyntaxStyle;
        node.clearCache();
        applyTuiMarkdownCodeMaterial(node, currentTheme);
      }
    }

    previousMarkdownSyntaxStyle.destroy();

    update(state, "messages", [...state.messages]);
  }

  function shortPath(p: string): string {
    const base = require("node:path").basename(p);
    const parent = require("node:path").basename(
      require("node:path").dirname(p),
    );
    return parent ? `${parent}/${base}` : base;
  }

  function renderInput(): void {
    if (ui.inputTextarea) {
      ui.inputTextarea.textColor = currentTheme.text;
    }

    const input = state.input;
    if (input.startsWith("/")) {
      const query = input.slice(1).toLowerCase();
      const filtered = state.slashCommands.filter(cmd =>
        cmd.trigger.toLowerCase().includes(query)
      );
      update(state, "slashCommands", filtered.length > 0 ? filtered : SLASH_COMMANDS);
      update(state, "slashCommandIndex", 0);
      update(state, "slashPopoverOpen", true);
      renderSlashPopover(state, currentTheme, ui);
    } else {
      update(state, "slashPopoverOpen", false);
      update(state, "slashCommands", SLASH_COMMANDS);
      renderSlashPopover(state, currentTheme, ui);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Spinner / command bar
  // ─────────────────────────────────────────────────────────────────────────

  let spinnerIndex = 0;

  const PHASE_ICONS: Record<string, string> = {
    planning: "⚡",
    executing: "⟳",
    reasoning: "🤔",
    responding: "💬",
  };

  function renderCommandBarStatus(): void {
    if (state.status === "running") {
      const activity = state.currentActivity;
      const icon = activity.phase ? (PHASE_ICONS[activity.phase] ?? "") : "";
      const tool = activity.toolName ? `: ${activity.toolName}` : "";
      const details =
        activity.details && activity.details.length > 40
          ? ` (${activity.details.slice(0, 37)}...)`
          : activity.details
            ? ` (${activity.details})`
            : "";

      const spinner =
        SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length] ?? "⠋";

      if (activity.phase) {
        ui.commandBarStatus.content = t`${fg(currentTheme.accent)(spinner)} ${fg(currentTheme.text)(icon + activity.phase + tool + details)}`;
      } else {
        ui.commandBarStatus.content = t`${fg(currentTheme.accent)(spinner)} ${fg(currentTheme.textMuted)("thinking")}`;
      }

      spinnerIndex++;
    } else if (state.status === "error") {
      ui.commandBarStatus.content = t`${fg(currentTheme.error)("✗ error")}`;
    } else {
      ui.commandBarStatus.content = "";
    }
  }

  function startSpinner(): void {
    if (spinnerRef.interval) return;
    spinnerRef.interval = setInterval(() => {
      renderCommandBarStatus();
    }, 80);
  }

  function stopSpinner(): void {
    if (spinnerRef.interval) {
      clearInterval(spinnerRef.interval);
      spinnerRef.interval = null;
    }
    renderCommandBarStatus();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Field poll
  // ─────────────────────────────────────────────────────────────────────────

  async function showSetupStatus(): Promise<void> {
    if (!loadSetupSnapshot) {
      ui.commandBarStatus.content = t`${fg(currentTheme.error)("Setup status is unavailable in this TUI session")}`;
      return;
    }
    try {
      const snapshot = await loadSetupSnapshot();
      const node = new TextRenderable(renderer, {
        content: t`${fg(currentTheme.accent)("setup")}\n${fg(currentTheme.text)(formatSetupSnapshot(snapshot))}`,
        width: "100%",
      });
      ui.chatScrollBox.content.add(node);
      ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Setup status loaded")}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Setup status failed: ${message}`)}`;
    }
  }

  async function showSettings(query = ""): Promise<void> {
    if (!loadSettingsSnapshot) {
      ui.commandBarStatus.content = t`${fg(currentTheme.error)("Settings are unavailable in this TUI session")}`;
      return;
    }
    try {
      const snapshot = await loadSettingsSnapshot();
      const node = new TextRenderable(renderer, {
        content: t`${fg(currentTheme.accent)(query ? `settings · ${query}` : "settings")}\n${fg(currentTheme.text)(formatSettingsSnapshot(snapshot, query))}`,
        width: "100%",
      });
      ui.chatScrollBox.content.add(node);
      ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Settings loaded")}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Settings failed: ${message}`)}`;
    }
  }

  async function handleSettingsCommand(raw: string): Promise<void> {
    const command = parseSettingsCommand(raw);
    if (command.kind === "search") {
      await showSettings(command.query);
      return;
    }
    if (command.kind === "invalid") {
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(command.message)}`;
      return;
    }
    if (!loadSettingsSnapshot || !proposeSettingsMutation || !applySettingsMutation) {
      ui.commandBarStatus.content = t`${fg(currentTheme.error)("Settings mutation is unavailable in this TUI session")}`;
      return;
    }
    try {
      const snapshot = await loadSettingsSnapshot();
      const proposal = await proposeSettingsMutation(buildSettingsProposalRequest(command, snapshot.revisions));
      if (proposal.status === "invalid") {
        ui.commandBarStatus.content = t`${fg(currentTheme.error)(proposal.diagnostics.map((entry) => entry.message).join("; ") || "Settings proposal is invalid")}`;
        return;
      }
      if (proposal.approvalRequired && !command.approve) {
        ui.commandBarStatus.content = t`${fg(currentTheme.warning)(`Authority approval required (${proposal.authorityImpact}); re-run with --approve`)}`;
        return;
      }
      const approvalId = proposal.approvalRequired
        ? await approveSettingsProposal?.(proposal.proposalId)
        : undefined;
      if (proposal.approvalRequired && !approvalId) {
        ui.commandBarStatus.content = t`${fg(currentTheme.error)("TUI approval authority is unavailable")}`;
        return;
      }
      const result = await applySettingsMutation({
        proposalId: proposal.proposalId,
        ...(approvalId ? { approvalId } : {}),
      });
      const detail = `${result.outcome} · ${result.activation} · ${result.activationObservation.state}`;
      const node = new TextRenderable(renderer, {
        content: t`${fg(result.outcome === "rejected" ? currentTheme.error : currentTheme.accent)(`${command.kind} ${command.key}`)}\n${fg(currentTheme.text)(detail)}`,
        width: "100%",
      });
      ui.chatScrollBox.content.add(node);
      ui.commandBarStatus.content = t`${fg(result.outcome === "rejected" ? currentTheme.error : currentTheme.accent)(detail)}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Settings mutation failed: ${message}`)}`;
    }
  }

  const fieldPollInterval = setInterval(async () => {
    try {
      const snapshot = await getFieldStore().snapshot();
      const regions = [...snapshot.regions.values()];
      const saturation =
        regions.length > 0
          ? regions.reduce((sum, r) => sum + r.value, 0) / regions.length
          : 0;

      update(state, "fieldSnapshot", {
        dominantRegions: snapshot.dominantRegions.slice(),
        saturation,
        entropy: snapshot.entropy,
        status: "stable",
      });

      renderSidebarField(state, currentTheme, ui);
    } catch {
      // fail-open
    }
  }, 2_000);

  // ─────────────────────────────────────────────────────────────────────────
  // Key input
  // ─────────────────────────────────────────────────────────────────────────

  renderer.keyInput.on("keypress", (key) => {
    // Ctrl-C / exit
    if (
      key.sequence === "\x03" ||
      (key.ctrl && (key.name === "c" || key.sequence === "C"))
    ) {
      clearInterval(fieldPollInterval);
      renderer.destroy();
      process.exit(0);
      return;
    }

    // ── Theme picker ──────────────────────────────────────────────────────
    if (themePickerOpen) {
      if (key.sequence === "\x1b") {
        closeThemePicker(false);
        return;
      }
      if (key.sequence === "\r" || key.sequence === "\n") {
        closeThemePicker(true);
        return;
      }
      if (
        key.name === "up" ||
        key.sequence === "\x1b[A" ||
        key.name === "k"
      ) {
        navigateThemePicker(-1);
        return;
      }
      if (
        key.name === "down" ||
        key.sequence === "\x1b[B" ||
        key.name === "j"
      ) {
        navigateThemePicker(1);
        return;
      }
      return;
    }

    // ── Execution target picker ────────────────────────────────────────────
    if (executionRoutePickerOpen) {
      if (!executionRoutePicker) return;

      if (key.sequence === "\x1b") {
        if (
          providerCatalogStatus === "ready"
          && (
            routePickerState.mode === "accounts"
            || routePickerState.mode === "auth-key"
            || routePickerState.mode === "auth-confirm"
          )
        ) {
          returnToProviderMode();
          return;
        }
        void closeExecutionRoutePicker(false);
        return;
      }

      if (providerCatalogStatus !== "ready") {
        if (providerCatalogStatus !== "refreshing" && key.name === "r") {
          void refreshExecutionRoutesFromPicker();
        }
        return;
      }

      if (key.sequence === "\r" || key.sequence === "\n") {
        if (routePickerState.mode === "available-models") return;
        if (routePickerState.mode === "providers") {
          const selectedRoute = getCurrentRoute();
          const selectedProvider = selectedRoute?.providerId ?? "";
          if (!routeIsSelectable(selectedRoute) && providerCanAuthenticate(selectedRoute?.routeId ?? "")) {
            const metadata = getGuiProviderMetadata(selectedProvider);
            if (metadata?.authMethod === "api_key") {
              routePickerState.mode = "auth-key";
              routePickerState.authKeyBuffer = "";
              renderExecutionRoutePicker();
              return;
            }
            routePickerState.mode = "auth-confirm";
            renderExecutionRoutePicker();
            return;
          }
          if (!routeIsSelectable(selectedRoute)) {
            ui.commandBarStatus.content = t`${fg(currentTheme.warning)(getRouteReason(selectedRoute) ?? "Execution target is unavailable")}`;
            return;
          }
          if (getAccountOverrideOptions(selectedRoute).length > 0) {
            routePickerState.mode = "accounts";
            routePickerState.accountOverrideIndex = 0;
            renderExecutionRoutePicker();
            executionRoutePicker.scrollBox.scrollTo(0);
            process.nextTick(() => {
              scrollToSelectedRow(true);
            });
            return;
          }
          void closeExecutionRoutePicker(true);
          return;
        }
        if (routePickerState.mode === "accounts") {
          const accountOverrideId = getAccountOverrideOptions()[routePickerState.accountOverrideIndex];
          void closeExecutionRoutePicker(true, accountOverrideId);
          return;
        }
        if (routePickerState.mode === "auth-key") {
          const apiKey = routePickerState.authKeyBuffer.trim();
          if (apiKey.length === 0) {
            ui.commandBarStatus.content = t`${fg(currentTheme.error)("API key is required")}`;
            return;
          }
          void authenticateSelectedProvider(apiKey);
          return;
        }
        if (routePickerState.mode === "auth-confirm") {
          void authenticateSelectedProvider();
          return;
        }
        void closeExecutionRoutePicker(true);
        return;
      }

      if (routePickerState.mode === "auth-key") {
        if (key.name === "backspace" || key.sequence === "\x7f" || key.sequence === "\b") {
          routePickerState.authKeyBuffer = routePickerState.authKeyBuffer.slice(0, -1);
          renderExecutionRoutePicker();
          return;
        }
        if (typeof key.sequence === "string" && key.sequence.length === 1 && key.sequence >= " ") {
          routePickerState.authKeyBuffer += key.sequence;
          renderExecutionRoutePicker();
          return;
        }
        return;
      }

      if (routePickerState.mode === "auth-confirm") {
        return;
      }

      if (routePickerState.mode === "providers" && key.name === "r") {
        void refreshExecutionRoutesFromPicker();
        return;
      }

      if ((routePickerState.mode === "providers" || routePickerState.mode === "available-models") && key.name === "a") {
        routePickerState.mode = routePickerState.mode === "providers" ? "available-models" : "providers";
        renderExecutionRoutePicker();
        executionRoutePicker.scrollBox.scrollTo(0);
        return;
      }

      if (
        key.name === "up" ||
        key.sequence === "\x1b[A" ||
        key.name === "k"
      ) {
        navigateExecutionRoutePicker(-1);
        return;
      }

      if (
        key.name === "down" ||
        key.sequence === "\x1b[B" ||
        key.name === "j"
      ) {
        navigateExecutionRoutePicker(1);
        return;
      }

      return;
    }

    if (key.ctrl && key.name === "e") {
      cycleDeliberationLevel();
      return;
    }

    // ── Session browser navigation ─────────────────────────────────────────
    // Arrow keys navigate session list when there are sessions
    if (state.sessions.length > 0) {
      if (
        key.name === "up" ||
        key.sequence === "\x1b[A" ||
        key.name === "k"
      ) {
        const newIndex = state.selectedSessionIndex <= 0
          ? state.sessions.length - 1
          : state.selectedSessionIndex - 1;
        update(state, "selectedSessionIndex", newIndex);
        renderSidebarSessions(state, currentTheme, ui);
        return;
      }
      if (
        key.name === "down" ||
        key.sequence === "\x1b[B" ||
        key.name === "j"
      ) {
        const newIndex = state.selectedSessionIndex >= state.sessions.length - 1
          ? 0
          : state.selectedSessionIndex + 1;
        update(state, "selectedSessionIndex", newIndex);
        renderSidebarSessions(state, currentTheme, ui);
        return;
      }
    }

    // ── Approval queue ──────────────────────────────────────────────────────
    // 'a' to approve, 'd' to reject when there are pending approvals
    if (state.pendingApprovals.length > 0) {
      if (key.name === "a") {
        void (async () => {
          const session = await createSession();
          const hasApprove = typeof (session as unknown as { approve?: unknown }).approve === "function";
          if (hasApprove) {
            const pending = state.pendingApprovals[0];
            if (pending) {
              (session as unknown as { approve: (approvalId: string) => void }).approve(pending.approvalId);
            }
          }
          update(state, "pendingApprovals", state.pendingApprovals.slice(1));
          renderSidebarApprovals(state, currentTheme, ui);
        })();
        return;
      }
      if (key.name === "d") {
        void (async () => {
          const session = await createSession();
          const hasReject = typeof (session as unknown as { reject?: unknown }).reject === "function";
          if (hasReject) {
            const pending = state.pendingApprovals[0];
            if (pending) {
              (session as unknown as { reject: (reason: string, approvalId: string) => void }).reject("rejected by user", pending.approvalId);
            }
          }
          update(state, "pendingApprovals", state.pendingApprovals.slice(1));
          renderSidebarApprovals(state, currentTheme, ui);
        })();
        return;
      }
    }

    // ── Clipboard paste ───────────────────────────────────────────────────
    if (key.ctrl && (key.name === "v" || key.sequence === "\x16")) {
      try {
        let clip: string;
        if (process.platform === "win32") {
          clip = execSync("powershell -command Get-Clipboard", {
            encoding: "utf8",
            timeout: 1000,
          });
        } else if (process.platform === "darwin") {
          clip = execSync("pbpaste", { encoding: "utf8", timeout: 1000 });
        } else {
          clip = execSync(
            "xclip -selection clipboard -o 2>/dev/null || xsel -b -o 2>/dev/null",
            { encoding: "utf8", timeout: 1000, shell: "/bin/bash" },
          );
        }

        const text = clip
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "")
          .replace(/\n$/, "");
        if (text) {
          update(state, "input", state.input + text);
          renderInput();
        }
      } catch {
        // clipboard unavailable
      }
      return;
    }

    // ── Regular character input ───────────────────────────────────────────
    const cp = key.sequence.charCodeAt(0);
    if (
      key.sequence.length === 1 &&
      !key.ctrl &&
      !key.meta &&
      cp >= 32 &&
      cp !== 127 &&
      cp !== 13
    ) {
      update(state, "input", state.input + key.sequence);
      return;
    }

    // ── Enter / submit ────────────────────────────────────────────────────
    if (
      (key.sequence === "\r" || key.sequence === "\n") &&
      state.status !== "running"
    ) {
      const inputText = state.input.trim();

      if (inputText === "" && state.sessionContinuationMode && state.sessions.length > 0 && state.selectedSessionIndex >= 0) {
        const selectedSession = state.sessions[state.selectedSessionIndex];
        if (!selectedSession?.lastRoute) {
          update(state, "sessionContinuationMode", false);
          ui.commandBarStatus.content = t`${fg(currentTheme.warning)("Cannot continue: session route evidence is unavailable.")}`;
          return;
        }
        const selectedRoute = executionRouteCatalog.routes.find(
          (route) => route.routeId === selectedSession.lastRoute?.routeId,
        );
        if (!selectedRoute || !routeIsSelectable(selectedRoute)) {
          update(state, "sessionContinuationMode", false);
          ui.commandBarStatus.content = t`${fg(currentTheme.warning)(`Cannot continue: execution target ${selectedSession.lastRoute.routeId} is unavailable.`)}`;
          return;
        }
        if (!onContinueSession?.(selectedSession)) {
          update(state, "sessionContinuationMode", false);
          ui.commandBarStatus.content = t`${fg(currentTheme.warning)(`Cannot continue: execution target ${selectedRoute.routeId} is unavailable.`)}`;
          return;
        }
        update(state, "currentProvider", selectedRoute.providerId);
        update(state, "currentModel", selectedRoute.providerModelId);
        update(state, "routeMode", "user");
        update(state, "sessionContinuationMode", false);
        renderSidebarProvider(state, currentTheme, ui, domain);
        renderSidebarContinuation(state, currentTheme, ui);
        ui.commandBarStatus.content = t`${fg(currentTheme.accent)(`Continuing session ${selectedSession.sessionId.slice(0, 8)}...`)}`;
        return;
      }

      if (inputText === "") {
        return;
      }

      if (inputText === "/clear" || inputText === "/theme" || inputText === "/target" || inputText === "/deliberation" || inputText === "/authority" || inputText === "/continue" || inputText === "/plan" || inputText === "/setup" || inputText === "/settings" || inputText.startsWith("/settings ")) {
        // Commands are handled after clearing input
        ui.inputTextarea.clear();
        update(state, "input", "");

        if (inputText === "/clear") {
            void (async () => {
              const session = await createSession();
              const hasClear =
                typeof (session as unknown as { clear?: unknown }).clear ===
                "function";
              if (hasClear) {
                try {
                  await (
                    session as unknown as { clear: () => Promise<void> }
                  ).clear();
                } catch {
                  // fail-open
                }
              }
              const statusNode = new (
                await import("@opentui/core")
              ).TextRenderable(renderer, {
                content: t`${fg(currentTheme.accent)("Session cleared. Starting fresh next turn.")}`,
                width: "100%",
              });
              ui.chatScrollBox.content.add(statusNode);
              update(state, "messages", [...state.messages]);
            })();
            return;
          }

          if (inputText === "/theme") {
            openThemePicker();
            return;
          }

          if (inputText === "/target") {
            openExecutionRoutePicker();
            return;
          }

          if (inputText === "/deliberation") {
            cycleDeliberationLevel();
            return;
          }

          if (inputText === "/authority") {
            cycleRequestedAuthority();
            return;
          }

          if (inputText === "/continue") {
            openSessionContinuationBrowser("error");
            return;
          }

          if (inputText === "/setup") {
            void showSetupStatus();
            return;
          }

          if (inputText === "/settings" || inputText.startsWith("/settings ")) {
            void handleSettingsCommand(inputText.slice("/settings".length).trim());
            return;
          }
        }

        // If there's text, submit as normal message (after clearing input for slash commands)
        if (inputText) {
          ui.inputTextarea.clear();
          update(state, "input", "");
          update(state, "sessionContinuationMode", false);

          void sendMessage(
          {
            renderer,
            state,
            theme: () => currentTheme,
            markdownSyntaxStyle: () => markdownSyntaxStyle,
            ui,
            chatScrollBox: ui.chatScrollBox,
            sidebarToolsBox: ui.sidebarToolsBox,
            sidebarToolNode: null,
            messageNodes,
            createSession,
            refreshContinuationInfo,
            provider,
            domain,
            renderSidebarApprovals: () => renderSidebarApprovals(state, currentTheme, ui),
            renderSidebarChanges: () => renderSidebarChanges(state, currentTheme, ui),
            renderSidebarWork: () => renderSidebarWork(state, currentTheme, ui),
            renderSidebarManagedAgents: () => renderSidebarManagedAgents(state, currentTheme, ui),
          },
          inputText,
          thinkingNodeRef,
          () => renderSidebarCost(state, currentTheme, ui),
          () => renderSidebarTurns(state, currentTheme, ui),
          () => renderSidebarProvider(state, currentTheme, ui, domain),
          () => renderSidebarContinuation(state, currentTheme, ui),
          renderCommandBarStatus,
          startSpinner,
          stopSpinner,
          spinnerRef,
        );
      }
      return;
    }

    // ── Backspace ─────────────────────────────────────────────────────────
    if (key.sequence === "\u007f") {
      update(state, "input", state.input.slice(0, -1));
      renderInput();
      return;
    }

    // ── Slash command popover navigation ─────────────────────────────────
    if (state.slashPopoverOpen) {
      if (key.name === "up" || key.sequence === "\x1b[A" || key.name === "k") {
        const newIndex = Math.max(0, state.slashCommandIndex - 1);
        update(state, "slashCommandIndex", newIndex);
        renderSlashPopover(state, currentTheme, ui);
        return;
      }
      if (key.name === "down" || key.sequence === "\x1b[B" || key.name === "j") {
        const newIndex = Math.min(state.slashCommands.length - 1, state.slashCommandIndex + 1);
        update(state, "slashCommandIndex", newIndex);
        renderSlashPopover(state, currentTheme, ui);
        return;
      }
      if (key.sequence === "\r" || key.sequence === "\n") {
        // Execute selected command
        const cmd = state.slashCommands[state.slashCommandIndex];
        if (cmd) {
          ui.inputTextarea.clear();
          update(state, "input", "");
          update(state, "slashPopoverOpen", false);

          if (cmd.id === "clear") {
            void (async () => {
              const session = await createSession();
              const hasClear = typeof (session as unknown as { clear?: unknown }).clear === "function";
              if (hasClear) {
                try {
                  await (session as unknown as { clear: () => Promise<void> }).clear();
                } catch { /* fail-open */ }
              }
              const statusNode = new (await import("@opentui/core")).TextRenderable(renderer, {
                content: t`${fg(currentTheme.accent)("Session cleared.")}`,
                width: "100%",
              });
              ui.chatScrollBox.content.add(statusNode);
              update(state, "messages", [...state.messages]);
            })();
            return;
          }
          if (cmd.id === "theme") {
            openThemePicker();
            return;
          }
          if (cmd.id === "route") {
            openExecutionRoutePicker();
            return;
          }
          if (cmd.id === "deliberation") {
            cycleDeliberationLevel();
            return;
          }
          if (cmd.id === "authority") {
            cycleRequestedAuthority();
            return;
          }
          if (cmd.id === "continue") {
            openSessionContinuationBrowser();
            return;
          }
          if (cmd.id === "plan") {
            update(state, "planMode", true);
            renderSidebarProvider(state, currentTheme, ui, domain);
            ui.commandBarStatus.content = t`${fg(currentTheme.warning)("Plan mode enabled. Run /exec when ready to execute.")}`;
            return;
          }
          if (cmd.id === "exec") {
            void (async () => {
              const session = await createSession();
              const executePlanMode = (session as unknown as { executePlanMode?: unknown }).executePlanMode;
              if (typeof executePlanMode === "function") {
                executePlanMode.call(session);
              }
              update(state, "planMode", false);
              renderSidebarProvider(state, currentTheme, ui, domain);
              ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Execution mode enabled.")}`;
            })();
            return;
          }
          if (cmd.id === "setup") {
            void showSetupStatus();
            return;
          }
          if (cmd.id === "settings") {
            void handleSettingsCommand("");
            return;
          }
          if (cmd.id === "goal") {
            renderSidebarWork(state, currentTheme, ui);
            ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Goal workflow visible in work sidebar")}`;
            return;
          }
        }
        return;
      }
      if (key.sequence === "\x1b") {
        update(state, "slashPopoverOpen", false);
        update(state, "slashCommands", SLASH_COMMANDS);
        renderSlashPopover(state, currentTheme, ui);
        return;
      }
    }
  });

  await new Promise<void>((resolve) => renderer.once("destroy", resolve));
  markdownSyntaxStyle.destroy();
  clearOperatorThemeHandler();
}

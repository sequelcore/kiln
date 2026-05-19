/**
 * @fileoverview TUI Application entry point.
 * @module @kilnai/tui
 */

import { execSync } from "node:child_process";
import { createCliRenderer, TextRenderable } from "@opentui/core";
import { getFieldStore } from "@kilnai/core";
import {
  OPERATOR_THEME_LABELS,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  isOperatorThemeName,
  listOperatorCommands,
  type GuiProviderCatalogStatus,
  type GuiProviderDiscoveryResult,
  type KilnConfigSetupAction,
  type KilnConfigSetupSnapshot,
  type OperatorCommandDefinition,
  type OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";
import type { SessionLike } from "./types.js";
import type { Message, ReasoningEffort, ResumeSidebarInfo, SessionListItem, SlashCommand } from "./state.js";
import { createReactiveState, update } from "./state.js";
import type { KilnTheme } from "./theme.js";
import { defaultTheme, themes } from "./theme.js";
import {
  initUI,
  createThemePicker,
  destroyThemePicker,
  createProviderPicker,
  destroyProviderPicker,
} from "./ui.js";
import { sendMessage } from "./handlers.js";
import {
  renderSidebarCost,
  renderSidebarResume,
  renderSidebarTurns,
  renderSidebarProvider,
  renderSidebarField,
  renderSidebarSessions,
  renderSidebarApprovals,
  renderSidebarChanges,
  renderSidebarWork,
  renderSlashPopover,
} from "./render.js";
import { setTuiOperatorThemeHandler } from "./operator-theme-handler.js";

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
  initialResumeInfo: Record<string, ResumeSidebarInfo> = {},
  refreshResumeInfo?: () => Promise<Record<string, ResumeSidebarInfo>>,
  providerModelsRef?: { current: Record<string, string[]> },
  providerDiscoveryRef?: { current: readonly GuiProviderDiscoveryResult[] },
  loadSessions?: () => Promise<SessionListItem[]>,
  onResumeSession?: (session: SessionListItem) => void,
  refreshProviders?: () => Promise<void> | void,
  persistThemePreference?: (themeName: string) => Promise<void> | void,
  loadSetupSnapshot?: () => Promise<KilnConfigSetupSnapshot>,
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
  update(state, "resumeInfoByProvider", initialResumeInfo);

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
  let localThemeIndex = 0;
  let themePickerOpen = false;
  let themePicker: ReturnType<typeof createThemePicker> | null = null;
  let providerPickerOpen = false;
  let providerPicker: ReturnType<typeof createProviderPicker> | null = null;

  const validProviders = providerDisplayInfo.map((entry) => entry.id);
  const providerInfoById = new Map(providerDisplayInfo.map((entry) => [entry.id, entry]));
  const providerGroups = [
    { title: "Subscription", providers: providerDisplayInfo.filter((entry) => entry.group === "subscription").map((entry) => entry.id) },
    { title: "Harness", providers: providerDisplayInfo.filter((entry) => entry.group === "harness").map((entry) => entry.id) },
    { title: "Direct API", providers: providerDisplayInfo.filter((entry) => entry.group === "direct-api").map((entry) => entry.id) },
  ].filter((group) => group.providers.length > 0);

  let providerPickerState = {
    providerIndex: 0,
    modelIndex: 0,
    mode: "providers" as "providers" | "models" | "auth-key" | "auth-confirm",
    authKeyBuffer: "",
  };
  let providerModels = Object.fromEntries(
    providerDisplayInfo.map((entry) => [entry.id, [...entry.models]]),
  ) as Record<string, string[]>;
  let providerDiscovery = providerDiscoveryRef?.current ?? [];
  let providerCatalogStatus: GuiProviderCatalogStatus = "ready";
  let providerCatalogError: string | null = null;

  const isReasoningEffort = (value: unknown): value is ReasoningEffort => (
    value === "minimal"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
  );
  const syncReasoningEffort = () => {
    const capabilities = providerDiscovery
      .find((entry) => entry.provider === state.currentProvider)
      ?.modelCapabilities?.[state.currentModel];
    const supported = (capabilities?.supportedReasoningEfforts ?? []).filter(isReasoningEffort);
    update(state, "supportedReasoningEfforts", supported);
    if (supported.length === 0) {
      if (state.currentReasoningEffort !== undefined) {
        update(state, "currentReasoningEffort", undefined);
      }
      return;
    }
    const defaultEffort = isReasoningEffort(capabilities?.defaultReasoningEffort)
      ? capabilities.defaultReasoningEffort
      : supported[0]!;
    if (!state.currentReasoningEffort || !supported.includes(state.currentReasoningEffort)) {
      update(state, "currentReasoningEffort", defaultEffort);
    }
  };
  update(state, "currentProvider", provider);
  const initialProviderIndex = validProviders.findIndex((providerName) => providerName === provider);
  if (initialProviderIndex >= 0) {
    providerPickerState.providerIndex = initialProviderIndex;
    update(state, "providerPickerIndex", initialProviderIndex);
    const initialModel = providerModels[provider]?.[0];
    if (initialModel) {
      update(state, "currentModel", initialModel);
    }
  }
  syncReasoningEffort();

  const SLASH_COMMANDS = listOperatorCommands("tui").map(operatorCommandToSlashCommand);

  update(state, "slashCommands", SLASH_COMMANDS);

  if (providerModelsRef) {
    const pollModels = () => {
      const models = providerModelsRef.current;
      if (models) {
        providerModels = Object.fromEntries(
          validProviders.map((providerName) => [providerName, models[providerName] ?? []]),
        );
        providerDiscovery = providerDiscoveryRef?.current ?? providerDiscovery;
        syncReasoningEffort();
        if (providerPicker) {
          renderProviderPicker();
        }
      }
    };
    setInterval(pollModels, 500);
    pollModels();
  }

  const themeNames = Object.keys(themes);
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

      if (text === "/provider") {
        openProviderPicker();
        return;
      }

      if (text === "/effort") {
        cycleReasoningEffort();
        return;
      }

      if (text === "/authority") {
        cycleRequestedAuthority();
        return;
      }

      if (text === "/resume") {
        if (state.sessions.length > 0) {
          update(state, "selectedSessionIndex", 0);
          renderSidebarSessions(state, currentTheme, ui);
          ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Use arrow keys to select, Enter to resume")}`;
        } else {
          ui.commandBarStatus.content = t`${fg(currentTheme.textMuted)("No previous sessions available")}`;
        }
        return;
      }

      if (text === "/setup") {
        void showSetupStatus();
        return;
      }

      if (text === "/goal") {
        renderSidebarWork(state, currentTheme, ui);
        ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Goal workflow visible in work sidebar")}`;
        return;
      }

      void sendMessage(
        {
          renderer,
          state,
          theme: currentTheme,
          ui,
          chatScrollBox: ui.chatScrollBox,
          sidebarToolsBox: ui.sidebarToolsBox,
          sidebarToolNode: null,
          messageNodes,
          createSession,
          refreshResumeInfo,
          provider,
          domain,
          renderSidebarApprovals: () => renderSidebarApprovals(state, currentTheme, ui),
          renderSidebarChanges: () => renderSidebarChanges(state, currentTheme, ui),
          renderSidebarWork: () => renderSidebarWork(state, currentTheme, ui),
        },
        text,
        thinkingNodeRef,
        () => renderSidebarCost(state, currentTheme, ui),
        () => renderSidebarTurns(state, currentTheme, ui),
        () => renderSidebarProvider(state, currentTheme, ui, domain),
        () => renderSidebarResume(state, currentTheme, ui),
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
    if (request.scope === "persisted") {
      if (!persistThemePreference) {
        return { ok: false, error: "Persisted TUI theme changes are unavailable in this session." };
      }
      await persistThemePreference(themeName);
    }
    applyTheme(requestedTheme);
    ui.commandBarStatus.content = t`${fg(currentTheme.accent)(
      `Theme: ${OPERATOR_THEME_LABELS[themeName]}`,
    )}`;
    return { ok: true, appliedTheme: themeName };
  });

  function cycleReasoningEffort(): void {
    if (state.supportedReasoningEfforts.length === 0) {
      ui.commandBarStatus.content = t`${fg(currentTheme.textMuted)("No reasoning effort options for this model")}`;
      return;
    }
    const currentIndex = state.currentReasoningEffort
      ? state.supportedReasoningEfforts.indexOf(state.currentReasoningEffort)
      : -1;
    const nextEffort = state.supportedReasoningEfforts[
      (currentIndex + 1) % state.supportedReasoningEfforts.length
    ];
    if (!nextEffort) return;
    update(state, "currentReasoningEffort", nextEffort);
    renderSidebarProvider(state, currentTheme, ui, domain);
    ui.commandBarStatus.content = t`${fg(currentTheme.accent)(`Reasoning effort: ${nextEffort}`)}`;
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
  renderSidebarResume(state, currentTheme, ui);
  renderSidebarField(state, currentTheme, ui);
  renderSidebarApprovals(state, currentTheme, ui);
  renderSidebarChanges(state, currentTheme, ui);
  renderSidebarWork(state, currentTheme, ui);

  // Load session history into sidebar
  if (loadSessions) {
    try {
      const sessions = await loadSessions();
      const sessionItems: SessionListItem[] = sessions.map((s) => ({
        sessionId: s.sessionId,
        provider: s.provider,
        task: s.task,
        completedAt: s.completedAt,
        cost: s.cost,
      }));
      update(state, "sessions", sessionItems);
      if (sessionItems.length > 0) {
        update(state, "selectedSessionIndex", 0);
      }
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

  if (typeof (renderer as unknown as { on?: unknown }).on === "function") {
    (
      renderer as unknown as { on: (event: string, cb: () => void) => void }
    ).on("resize", () => {
      applySidebarVisibility(renderer.width >= 100);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Provider picker helpers
  // ─────────────────────────────────────────────────────────────────────────

  function getCurrentProvider(): string {
    return validProviders[providerPickerState.providerIndex] ?? "";
  }

  function getCurrentModels(): string[] {
    return providerModels[getCurrentProvider()] ?? [];
  }

  function getProviderDiscovery(providerName: string): GuiProviderDiscoveryResult | undefined {
    return providerDiscovery.find((entry) => entry.provider === providerName);
  }

  function providerIsSelectable(providerName: string): boolean {
    const discovery = getProviderDiscovery(providerName);
    if (discovery) {
      return discovery.available;
    }
    const info = providerInfoById.get(providerName);
    if (info?.available === false) {
      return false;
    }
    const models = providerModels[providerName] ?? [];
    return models.length > 0 || isGuiProviderModeless(providerName);
  }

  function providerCanAuthenticate(providerName: string): boolean {
    const metadata = getGuiProviderMetadata(providerName);
    if (!metadata?.authMethod) {
      return false;
    }
    const discovery = getProviderDiscovery(providerName);
    if (!discovery || discovery.available) {
      return false;
    }
    return discovery.authState === "missing"
      || discovery.authState === "expired"
      || /auth|api[_ -]?key|credential/i.test(discovery.reason);
  }

  function getProviderReason(providerName: string): string | undefined {
    const reason = getProviderDiscovery(providerName)?.reason ?? providerInfoById.get(providerName)?.reason;
    return reason ? conciseUnavailableReason(reason) : undefined;
  }

  function markProviderCatalog(status: GuiProviderCatalogStatus, error: string | null = null): void {
    providerCatalogStatus = status;
    providerCatalogError = error;
    if (providerPicker) {
      renderProviderPicker();
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
    return providerInfoById.get(providerName)?.free
      ? `${providerName} (free)`
      : providerName;
  }

  function getProviderRowId(providerName: string): string {
    return `provider-item-${providerName}`;
  }

  function findProviderRow(providerName: string):
    | InstanceType<typeof TextRenderable>
    | undefined {
    if (!providerPicker) return undefined;
    const targetId = getProviderRowId(providerName);
    return providerPicker.rows.find((row) => row.id === targetId);
  }

  /**
   * Destroys all dynamic data rows from scrollBox.content.
   * title and hint are in the outer panel, not the scrollBox, so they are
   * unaffected.
   */
  function clearPickerRows(): void {
    if (!providerPicker) return;
    for (const row of providerPicker.rows) {
      row.destroy();
    }
    providerPicker.rows = [];
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
   * Called only on mode/provider switches — NOT on every up/down keypress.
   * Navigation updates are handled by updatePickerSelection() instead.
   */
  function renderProviderPicker(): void {
    if (!providerPicker) return;

    clearPickerRows();

    const scrollContent = providerPicker.scrollBox.content;
    if (providerCatalogStatus !== "ready") {
      providerPicker.mode = "providers";
      providerPicker.title.content = t`${fg(currentTheme.accent)(" Providers ")}`;
      const loadingLabel = providerCatalogStatus === "error"
        ? (providerCatalogError ?? "Provider discovery failed.")
        : providerCatalogStatus === "refreshing"
          ? "Refreshing provider and model discovery..."
          : "Loading provider and model discovery...";
      const row = makePickerRow(
        "provider-catalog-status",
        loadingLabel,
        true,
        providerCatalogStatus === "error" ? currentTheme.error : currentTheme.accent,
        currentTheme.textMuted,
        "",
      );
      scrollContent.add(row);
      providerPicker.rows.push(row);
      providerPicker.hint.content = providerCatalogStatus === "error"
        ? t`${fg(currentTheme.textMuted)("r retry  Esc cancel")}`
        : t`${fg(currentTheme.textMuted)("please wait  Esc cancel")}`;
      return;
    }

    if (providerPickerState.mode === "providers") {
      providerPicker.mode = "providers";
      providerPicker.title.content = t`${fg(currentTheme.accent)(" Select Provider ")}`;

      for (const group of providerGroups) {
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
        providerPicker.rows.push(headerRow);

        for (const providerName of group.providers) {
          const selected = validProviders[providerPickerState.providerIndex] === providerName;
          const label = getProviderLabel(providerName);
          const reason = getProviderReason(providerName);
          const selectable = providerIsSelectable(providerName);
          const authenticatable = providerCanAuthenticate(providerName);
          const row = makePickerRow(
            getProviderRowId(providerName),
            selectable || !reason
              ? label
              : `${label} - ${authenticatable ? "sign in" : reason}`,
            selected,
            currentTheme.accent,
            currentTheme.textMuted,
            selected ? "● " : "○ ",
          );
          scrollContent.add(row);
          providerPicker.rows.push(row);
        }
      }

      providerPicker.hint.content = t`${fg(currentTheme.textMuted)("↑↓ navigate  Enter select/login  r refresh  Esc cancel")}`;
      return;
    }

    if (providerPickerState.mode === "auth-key") {
      providerPicker.mode = "auth-key";
      const providerName = getCurrentProvider();
      providerPicker.title.content = t`${fg(currentTheme.accent)(` ${providerName} API key `)}`;
      const masked = providerPickerState.authKeyBuffer.length > 0
        ? "*".repeat(Math.min(providerPickerState.authKeyBuffer.length, 48))
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
      providerPicker.rows.push(row);
      providerPicker.hint.content = t`${fg(currentTheme.textMuted)("paste key  Backspace edit  Enter link  Esc back")}`;
      return;
    }

    if (providerPickerState.mode === "auth-confirm") {
      providerPicker.mode = "auth-confirm";
      const providerName = getCurrentProvider();
      providerPicker.title.content = t`${fg(currentTheme.accent)(` Authenticate ${providerName} `)}`;
      const row = makePickerRow(
        `provider-auth-confirm-${providerName}`,
        `Press Enter to start browser sign-in for ${providerName}`,
        true,
        currentTheme.primary,
        currentTheme.textMuted,
        "",
      );
      scrollContent.add(row);
      providerPicker.rows.push(row);
      providerPicker.hint.content = t`${fg(currentTheme.textMuted)("Enter authenticate  Esc back")}`;
      return;
    }

    // Model mode
    providerPicker.mode = "models";
    const providerName = getCurrentProvider();
    const models = getCurrentModels();

    providerPicker.title.content = t`${fg(currentTheme.accent)(` ${providerName} models `)}`;

    for (let i = 0; i < models.length; i++) {
      const selected = i === providerPickerState.modelIndex;
      const label = models[i] ?? "";
      const row = makePickerRow(
        `model-item-${providerName}-${i}`,
        label,
        selected,
        currentTheme.primary,
        currentTheme.textMuted,
        selected ? "● " : "  ",
      );
      scrollContent.add(row);
      providerPicker.rows.push(row);
    }

    providerPicker.hint.content = t`${fg(currentTheme.textMuted)("↑↓ navigate  Enter select  Esc back")}`;
  }

  /**
   * Updates only the two rows whose visual state changed (prev → next
   * selection). Does NOT destroy/recreate any nodes, so child y-positions
   * remain stable and scrollChildIntoView() works correctly on the same tick.
   */
  function updatePickerSelection(prevIdx: number, nextIdx: number): void {
    if (!providerPicker) return;

    const isProviders = providerPickerState.mode === "providers";

    if (isProviders) {
      const prevProvider = validProviders[prevIdx];
      const nextProvider = validProviders[nextIdx];
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

    const names = getCurrentModels();
    const prevRow = providerPicker.rows[prevIdx];
    const nextRow = providerPicker.rows[nextIdx];

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
    if (!providerPicker) return;

    const targetRow = (() => {
      if (providerPickerState.mode === "providers") {
        const selectedProvider = validProviders[providerPickerState.providerIndex];
        return selectedProvider
          ? findProviderRow(selectedProvider)
          : undefined;
      }
      return providerPicker.rows[providerPickerState.modelIndex];
    })();
    if (!targetRow) return;

    const scrollBox = providerPicker.scrollBox;

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

  // ─────────────────────────────────────────────────────────────────────────
  // Provider picker lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  function openProviderPicker(): void {
    if (providerPicker) return;

    const activeProviderIndex = validProviders.findIndex(
      (providerName) => providerName === state.currentProvider,
    );
    providerPickerState.providerIndex =
      activeProviderIndex >= 0 ? activeProviderIndex : 0;
    const activeModels = getCurrentModels();
    const activeModelIndex = activeModels.indexOf(state.currentModel);
    providerPickerState.modelIndex = activeModelIndex >= 0 ? activeModelIndex : 0;
    providerPickerState.mode = "providers";

    providerPickerOpen = true;
    providerPicker = createProviderPicker(
      renderer,
      currentTheme,
      terminalWidth,
      terminalHeight,
    );

    update(state, "providerPickerOpen", true);

    renderProviderPicker();
    providerPicker.scrollBox.scrollTo(0);
    process.nextTick(() => {
      scrollToSelectedRow(true);
    });
  }

  async function closeProviderPicker(apply: boolean): Promise<void> {
    if (!providerPicker) return;

    const destroyPicker = () => {
      if (!providerPicker) return;
      destroyProviderPicker(providerPicker);
      providerPicker = null;
      providerPickerOpen = false;
      update(state, "providerPickerOpen", false);
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
      const selectedProvider = getCurrentProvider();
      if (!providerIsSelectable(selectedProvider)) {
        throw new Error(getProviderReason(selectedProvider) ?? `Provider '${selectedProvider}' is unavailable`);
      }
      const models = getCurrentModels();
      const selectedModel =
        providerPickerState.mode === "models"
          ? (models[providerPickerState.modelIndex] ?? "")
          : state.currentProvider === selectedProvider
            ? state.currentModel
            : "";
      const canSwitchWithoutModel = isGuiProviderModeless(selectedProvider);
      if (!selectedModel && !canSwitchWithoutModel) {
        throw new Error(`Provider '${selectedProvider}' requires a selected model.`);
      }

      const session = await createSession();
      const switchProvider =
        (
          session as unknown as {
            switchProvider?: unknown;
          }
        ).switchProvider;
      if (typeof switchProvider !== "function") {
        throw new Error("Active session does not support provider switching");
      }

      await (
        switchProvider as (
          providerName: string,
          modelName?: string,
        ) => Promise<string>
      )(selectedProvider, selectedModel || undefined);

      update(state, "currentProvider", selectedProvider);
      update(state, "currentModel", selectedModel);
      syncReasoningEffort();
      update(state, "routeMode", "user");
      update(state, "providerPickerIndex", providerPickerState.providerIndex);
      renderSidebarProvider(state, currentTheme, ui, domain);
      renderSidebarResume(state, currentTheme, ui);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Provider switch failed";
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Provider switch failed: ${message}`)}`;
    } finally {
      destroyPicker();
    }
  }

  async function refreshProviderDiscoveryFromPicker(): Promise<void> {
    if (!providerPicker) return;
    markProviderCatalog("refreshing");
    ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Refreshing provider and model discovery...")}`;
    try {
      const session = await createSession();
      const sessionRefreshProviders = (
        session as unknown as { refreshProviders?: unknown }
      ).refreshProviders;
      if (typeof sessionRefreshProviders === "function") {
        await (sessionRefreshProviders as () => Promise<void>).call(session);
      }
      await refreshProviders?.();
      providerDiscovery = providerDiscoveryRef?.current ?? providerDiscovery;
      const refreshedModels = providerModelsRef?.current;
      if (refreshedModels) {
        providerModels = Object.fromEntries(
          validProviders.map((providerName) => [providerName, refreshedModels[providerName] ?? []]),
        );
      }
      markProviderCatalog("ready");
      renderProviderPicker();
      process.nextTick(() => {
        scrollToSelectedRow(false);
      });
      ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Provider discovery refreshed")}`;
    } catch (error) {
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Provider discovery refresh failed";
      markProviderCatalog("error", message);
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Provider discovery refresh failed: ${message}`)}`;
    }
  }

  function returnToProviderMode(): void {
    if (!providerPicker) return;
    if (providerPickerState.mode === "providers") return;

    providerPickerState.mode = "providers";
    providerPickerState.authKeyBuffer = "";
    renderProviderPicker();
    providerPicker.scrollBox.scrollTo(0);
    process.nextTick(() => {
      scrollToSelectedRow(true);
    });
  }

  function enterModelMode(): void {
    if (!providerPicker) return;
    const models = getCurrentModels();
    if (models.length === 0) {
      return;
    }

    const activeModelIndex = models.indexOf(state.currentModel);
    providerPickerState.modelIndex = activeModelIndex >= 0 ? activeModelIndex : 0;
    providerPickerState.mode = "models";
    renderProviderPicker();
    providerPicker.scrollBox.scrollTo(0);
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
      await refreshProviders?.();
      providerDiscovery = providerDiscoveryRef?.current ?? providerDiscovery;
      const refreshedModels = providerModelsRef?.current;
      if (refreshedModels) {
        providerModels = Object.fromEntries(
          validProviders.map((providerName) => [providerName, refreshedModels[providerName] ?? []]),
        );
      }
      markProviderCatalog("ready");
      providerPickerState.mode = "providers";
      providerPickerState.authKeyBuffer = "";
      renderProviderPicker();
      ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Provider authentication completed")}`;
    } catch (error) {
      const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Provider authentication failed";
      markProviderCatalog("error", message);
      ui.commandBarStatus.content = t`${fg(currentTheme.error)(`Provider authentication failed: ${message}`)}`;
    }
  }

  function navigateProviderPicker(direction: number): void {
    if (!providerPicker) return;

    const inProviderMode = providerPickerState.mode === "providers";
    const choices = inProviderMode ? validProviders : getCurrentModels();
    if (choices.length === 0) return;

    const prevIdx = inProviderMode
      ? providerPickerState.providerIndex
      : providerPickerState.modelIndex;
    const nextIdx = (prevIdx + direction + choices.length) % choices.length;
    if (nextIdx === prevIdx) return;

    if (inProviderMode) {
      providerPickerState.providerIndex = nextIdx;
      update(state, "providerPickerIndex", nextIdx);
    } else {
      providerPickerState.modelIndex = nextIdx;
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
      Object.keys(themes).find((k) => themes[k] === currentTheme) ??
      "kiln-dark";
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
    renderer.setBackgroundColor(currentTheme.background);
    ui.rootContainer.backgroundColor = currentTheme.background;
    ui.chatColumn.backgroundColor = currentTheme.background;
    ui.chatScrollBox.backgroundColor = currentTheme.background;
    ui.inputContainer.backgroundColor = currentTheme.backgroundElement;
    ui.commandBar.backgroundColor = currentTheme.background;
    ui.sidebar.backgroundColor = currentTheme.backgroundPanel;

    renderSidebarProvider(state, currentTheme, ui, domain);
    renderSidebarResume(state, currentTheme, ui);

    ui.sidebarCostText.content = t`${fg(currentTheme.textMuted)(`$${state.cost.toFixed(4)}`)}`;
    ui.sidebarCwdText.content = t`${fg(currentTheme.textMuted)(shortPath(process.cwd()))}`;
    ui.sidebarTurnsText.content = t`${fg(currentTheme.textMuted)(`turns: ${state.turns}  tok: ${state.inputTokens >= 1000 ? (state.inputTokens / 1000).toFixed(1) + "k" : state.inputTokens}/${state.outputTokens >= 1000 ? (state.outputTokens / 1000).toFixed(1) + "k" : state.outputTokens}`)}`;
    ui.sidebarDivider.content = t`${fg(currentTheme.border)("─".repeat(38))}`;

    if (providerPicker) {
      renderProviderPicker();
    }

    renderInput();
    renderCommandBarStatus();
    ui.commandBarText.content = t`${fg(currentTheme.textMuted)("/setup /theme /provider  ctrl+shift+P commands")}`;

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
    }

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

    // ── Provider picker ───────────────────────────────────────────────────
    if (providerPickerOpen) {
      if (!providerPicker) return;

      if (key.sequence === "\x1b") {
        if (
          providerCatalogStatus === "ready"
          && (
            providerPickerState.mode === "models"
            || providerPickerState.mode === "auth-key"
            || providerPickerState.mode === "auth-confirm"
          )
        ) {
          returnToProviderMode();
          return;
        }
        void closeProviderPicker(false);
        return;
      }

      if (providerCatalogStatus !== "ready") {
        if (providerCatalogStatus !== "refreshing" && key.name === "r") {
          void refreshProviderDiscoveryFromPicker();
        }
        return;
      }

      if (key.sequence === "\r" || key.sequence === "\n") {
        if (providerPickerState.mode === "providers") {
          const selectedProvider = getCurrentProvider();
          if (!providerIsSelectable(selectedProvider) && providerCanAuthenticate(selectedProvider)) {
            const metadata = getGuiProviderMetadata(selectedProvider);
            if (metadata?.authMethod === "api_key") {
              providerPickerState.mode = "auth-key";
              providerPickerState.authKeyBuffer = "";
              renderProviderPicker();
              return;
            }
            providerPickerState.mode = "auth-confirm";
            renderProviderPicker();
            return;
          }
          if (
            getCurrentModels().length === 0
            && isGuiProviderModeless(selectedProvider)
            && providerIsSelectable(selectedProvider)
          ) {
            void closeProviderPicker(true);
            return;
          }
          enterModelMode();
          return;
        }
        if (providerPickerState.mode === "auth-key") {
          const apiKey = providerPickerState.authKeyBuffer.trim();
          if (apiKey.length === 0) {
            ui.commandBarStatus.content = t`${fg(currentTheme.error)("API key is required")}`;
            return;
          }
          void authenticateSelectedProvider(apiKey);
          return;
        }
        if (providerPickerState.mode === "auth-confirm") {
          void authenticateSelectedProvider();
          return;
        }
        void closeProviderPicker(true);
        return;
      }

      if (providerPickerState.mode === "auth-key") {
        if (key.name === "backspace" || key.sequence === "\x7f" || key.sequence === "\b") {
          providerPickerState.authKeyBuffer = providerPickerState.authKeyBuffer.slice(0, -1);
          renderProviderPicker();
          return;
        }
        if (typeof key.sequence === "string" && key.sequence.length === 1 && key.sequence >= " ") {
          providerPickerState.authKeyBuffer += key.sequence;
          renderProviderPicker();
          return;
        }
        return;
      }

      if (providerPickerState.mode === "auth-confirm") {
        return;
      }

      if (providerPickerState.mode === "providers" && key.name === "r") {
        void refreshProviderDiscoveryFromPicker();
        return;
      }

      if (
        key.name === "up" ||
        key.sequence === "\x1b[A" ||
        key.name === "k"
      ) {
        navigateProviderPicker(-1);
        return;
      }

      if (
        key.name === "down" ||
        key.sequence === "\x1b[B" ||
        key.name === "j"
      ) {
        navigateProviderPicker(1);
        return;
      }

      return;
    }

    if (key.ctrl && key.name === "e") {
      cycleReasoningEffort();
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
      // First: check for session resume (only when input is empty)
      const inputText = state.input.trim();

      // If input is empty and a session is selected, resume it
      if (inputText === "" && state.sessions.length > 0 && state.selectedSessionIndex >= 0) {
        const selectedSession = state.sessions[state.selectedSessionIndex];
        if (selectedSession && onResumeSession) {
          onResumeSession(selectedSession);
          update(state, "currentProvider", selectedSession.provider);
          update(state, "routeMode", "user");
          renderSidebarProvider(state, currentTheme, ui, domain);
          renderSidebarResume(state, currentTheme, ui);
          ui.commandBarStatus.content = t`${fg(currentTheme.accent)(`Resuming session ${selectedSession.sessionId.slice(0, 8)}...`)}`;
          return;
        }
      }

      // Process slash commands (must check before session resume check)
      if (inputText === "/clear" || inputText === "/theme" || inputText === "/provider" || inputText === "/effort" || inputText === "/authority" || inputText === "/resume" || inputText === "/plan" || inputText === "/setup") {
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

          if (inputText === "/provider") {
            openProviderPicker();
            return;
          }

          if (inputText === "/effort") {
            cycleReasoningEffort();
            return;
          }

          if (inputText === "/authority") {
            cycleRequestedAuthority();
            return;
          }

          if (inputText === "/resume") {
            // Focus on session browser - move selection to first session
            if (state.sessions.length > 0) {
              update(state, "selectedSessionIndex", 0);
              renderSidebarSessions(state, currentTheme, ui);
              ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Use arrow keys to select, Enter to resume")}`;
            } else {
              ui.commandBarStatus.content = t`${fg(currentTheme.error)("No sessions to resume")}`;
            }
            return;
          }

          if (inputText === "/setup") {
            void showSetupStatus();
            return;
          }
        }

        // If there's text, submit as normal message (after clearing input for slash commands)
        if (inputText) {
          ui.inputTextarea.clear();
          update(state, "input", "");

          void sendMessage(
          {
            renderer,
            state,
            theme: currentTheme,
            ui,
            chatScrollBox: ui.chatScrollBox,
            sidebarToolsBox: ui.sidebarToolsBox,
            sidebarToolNode: null,
            messageNodes,
            createSession,
            refreshResumeInfo,
            provider,
            domain,
            renderSidebarApprovals: () => renderSidebarApprovals(state, currentTheme, ui),
            renderSidebarChanges: () => renderSidebarChanges(state, currentTheme, ui),
            renderSidebarWork: () => renderSidebarWork(state, currentTheme, ui),
          },
          inputText,
          thinkingNodeRef,
          () => renderSidebarCost(state, currentTheme, ui),
          () => renderSidebarTurns(state, currentTheme, ui),
          () => renderSidebarProvider(state, currentTheme, ui, domain),
          () => renderSidebarResume(state, currentTheme, ui),
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
          if (cmd.id === "provider") {
            openProviderPicker();
            return;
          }
          if (cmd.id === "effort") {
            cycleReasoningEffort();
            return;
          }
          if (cmd.id === "authority") {
            cycleRequestedAuthority();
            return;
          }
          if (cmd.id === "resume") {
            if (state.sessions.length > 0) {
              update(state, "selectedSessionIndex", 0);
              renderSidebarSessions(state, currentTheme, ui);
              ui.commandBarStatus.content = t`${fg(currentTheme.accent)("Use arrow keys to select, Enter to resume")}`;
            } else {
              ui.commandBarStatus.content = t`${fg(currentTheme.textMuted)("No previous sessions available")}`;
            }
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
  clearOperatorThemeHandler();
}

const SETUP_ACTION_LABELS: Record<KilnConfigSetupAction, string> = {
  none: "current",
  "adopt-project-context": "adopt project context",
  "review-project-context": "review project context",
  "sync-repo-shims": "sync repo shims",
  "sync-native-projections": "sync native projections",
  "review-and-force-sync-repo-shims": "review shim drift",
  "adopt-or-back-up-native-guidance": "adopt native guidance",
  "review-native-projection-drift": "review native drift",
};

function formatSetupSnapshot(snapshot: KilnConfigSetupSnapshot): string {
  const actions = snapshot.recommendedActions.length > 0
    ? snapshot.recommendedActions.map((action) => SETUP_ACTION_LABELS[action]).join(", ")
    : SETUP_ACTION_LABELS.none;
  const repoShims = snapshot.repoShims.length > 0
    ? snapshot.repoShims.map((shim) => `  - ${shim.target}: ${shim.status}`).join("\n")
    : "  - none";
  const nativeProjections = snapshot.nativeProjections.length > 0
    ? snapshot.nativeProjections.map((projection) => `  - ${projection.targetId}: ${projection.status}`).join("\n")
    : "  - none";
  return [
    `project: ${snapshot.projectRoot}`,
    `project context: ${snapshot.projectContext.status}`,
    `actions: ${actions}`,
    "repo shims:",
    repoShims,
    "native projections:",
    nativeProjections,
  ].join("\n");
}

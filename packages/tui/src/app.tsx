/**
 * @fileoverview TUI Application entry point.
 * @module @kilnai/tui
 */

import { execSync } from "node:child_process";
import { createCliRenderer } from "@opentui/core";
import type { SessionLike } from "./types.js";
import type { Message } from "./state.js";
import { createReactiveState, update } from "./state.js";
import type { KilnTheme } from "./theme.js";
import { defaultTheme, themes } from "./theme.js";
import { initUI, createThemePicker, destroyThemePicker, createProviderPicker, destroyProviderPicker } from "./ui.js";
import { sendMessage } from "./handlers.js";
import { renderSidebarCost, renderSidebarTurns } from "./render.js";

/** Spinner frames for thinking indicator. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Main entry point for the TUI application.
 * @param createSession - Factory function to create a new session.
 * @param provider - Provider name to display.
 * @param domain - Domain name to display.
 * @param theme - Theme to use (defaults to kiln-dark).
 */
export async function startTui(
  createSession: () => Promise<SessionLike>,
  provider = "claude",
  domain = "unknown",
  theme: KilnTheme = defaultTheme
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
  const messageNodes: { msg: Message; node: InstanceType<typeof import("@opentui/core").TextRenderable> }[] = [];
  const thinkingNodeRef = { node: null as InstanceType<typeof import("@opentui/core").TextRenderable> | null };
  const spinnerRef = { interval: null as ReturnType<typeof setInterval> | null };
  let currentTheme = theme;
  let localThemeIndex = 0;
  let themePickerOpen = false;
  let themePicker: ReturnType<typeof createThemePicker> | null = null;
  let providerPickerOpen = false;
  let providerPicker: ReturnType<typeof createProviderPicker> | null = null;
  let providerPickerState = {
    providerIndex: 0,
    modelIndex: 0,
    mode: "providers" as "providers" | "models",
  };

  const VALID_PROVIDERS = ["claude", "codex", "opencode"];
  const PROVIDER_MODELS: Record<string, string[]> = {
    claude: ["sonnet-4-20250514", "haiku-4-20250514", "opus-4-20250514"],
    codex: ["codex-2-2025-01-24", "codex-2-2025-02-24"],
    opencode: ["opencode-o3", "opencode-o4", "opencode-o1"],
  };

  const themeNames = Object.keys(themes);
  const themeValues = Object.values(themes);

  const ui = initUI(
    renderer,
    state,
    currentTheme,
    provider,
    domain,
    terminalWidth,
    terminalHeight,
    (text: string) => {
      if (text === "/clear") {
        void (async () => {
          const session = await createSession();
          const hasClear = typeof (session as unknown as { clear?: unknown }).clear === "function";
          if (hasClear) {
            try { await (session as unknown as { clear: () => Promise<void> }).clear(); } catch { /* fail-open */ }
          }
          const statusNode = new (await import("@opentui/core")).TextRenderable(renderer, {
            content: t`${fg(currentTheme.accent)("Session cleared. Starting fresh next turn.")}`,
            width: "100%",
          });
          ui.chatScrollBox.content.add(statusNode);
          update(state, "messages", [...state.messages]);
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
          provider,
          domain,
        },
        text,
        thinkingNodeRef,
        () => renderSidebarCost(state, currentTheme, ui),
        () => renderSidebarTurns(state, currentTheme, ui),
        renderCommandBarStatus,
        startSpinner,
        stopSpinner,
        spinnerRef
      );
    }
  );

  renderSidebarCost(state, currentTheme, ui);
  renderSidebarTurns(state, currentTheme, ui);
  renderer.start();

  // Sidebar visibility based on terminal width
  const applySidebarVisibility = (visible: boolean): void => {
    ui.sidebar.width = visible ? 42 : 0;
    update(state, "sidebarVisible", visible);
  };
  applySidebarVisibility(renderer.width >= 100);
  if (typeof (renderer as unknown as { on?: unknown }).on === "function") {
    (renderer as unknown as { on: (event: string, cb: () => void) => void }).on("resize", () => {
      applySidebarVisibility(renderer.width >= 100);
    });
  }

  // Theme picker functions
  function openThemePicker(): void {
    if (themePicker) return;
    themePickerOpen = true;
    const currentName = Object.keys(themes).find(
      (k) => themes[k] === currentTheme
    ) ?? "kiln-dark";
    localThemeIndex = Math.max(0, themeNames.indexOf(currentName));

    themePicker = createThemePicker(
      renderer,
      currentTheme,
      themeNames,
      terminalWidth,
      terminalHeight,
      localThemeIndex
    );
    update(state, "themePickerOpen", true);
  }

  function closeThemePicker(apply: boolean): void {
    if (!themePicker) return;
    if (!apply) {
      const selectedThemeName = themeNames[localThemeIndex];
      const selectedTheme = selectedThemeName ? themes[selectedThemeName] : undefined;
      applyTheme(selectedTheme ?? defaultTheme);
    }
    destroyThemePicker(themePicker);
    themePicker = null;
    themePickerOpen = false;
    update(state, "themePickerOpen", false);
  }

  function openProviderPicker(): void {
    if (providerPicker) return;
    providerPickerOpen = true;
    providerPicker = createProviderPicker(
      renderer,
      currentTheme,
      VALID_PROVIDERS,
      PROVIDER_MODELS,
      terminalWidth,
      terminalHeight,
      providerPickerState.providerIndex,
      providerPickerState.modelIndex
    );
    update(state, "providerPickerOpen", true);
    update(state, "currentProvider", VALID_PROVIDERS[providerPickerState.providerIndex] ?? "claude");
  }

  function closeProviderPicker(apply: boolean): void {
    if (!providerPicker) return;
    if (apply) {
      const selectedProvider = VALID_PROVIDERS[providerPickerState.providerIndex] ?? "claude";
      const selectedModel = PROVIDER_MODELS[selectedProvider]?.[providerPickerState.modelIndex] ?? "";
      update(state, "currentProvider", selectedProvider);
      update(state, "currentModel", selectedModel);
      
      // Switch provider in gateway
      void (async () => {
        try {
          const session = await createSession();
          const hasSwitchProvider = typeof (session as unknown as { switchProvider?: unknown }).switchProvider === "function";
          if (hasSwitchProvider) {
            await (session as unknown as { switchProvider: (provider: string) => Promise<string> }).switchProvider(selectedProvider);
          }
        } catch {
          // Fail-open: provider switch is best-effort
        }
        ui.sidebarProviderText.content = t`${fg(currentTheme.accent)("[" + selectedProvider + "]")} ${fg(currentTheme.text)(domain)} ${fg(currentTheme.textMuted)(selectedModel ? "· " + selectedModel : "")}`;
      })();
    }
    destroyProviderPicker(providerPicker);
    providerPicker = null;
    providerPickerOpen = false;
    update(state, "providerPickerOpen", false);
  }

  function navigateProviderPicker(direction: number): void {
    if (!providerPicker) return;
    
    if (providerPickerState.mode === "providers") {
      providerPickerState.providerIndex = (providerPickerState.providerIndex + direction + VALID_PROVIDERS.length) % VALID_PROVIDERS.length;
      providerPickerState.modelIndex = 0;
      providerPickerState.mode = "providers";
      providerPicker.title.content = t`${fg(currentTheme.accent)(" Select Provider ")}`;
      for (let i = 0; i < providerPicker.providers.length; i++) {
        const isSelected = i === providerPickerState.providerIndex;
        const prefix = isSelected ? "● " : "○ ";
        const provider = VALID_PROVIDERS[i] ?? "";
        providerPicker.providers[i]!.content = t`${fg(isSelected ? currentTheme.accent : currentTheme.textMuted)(prefix + provider)}`;
        providerPicker.providers[i]!.visible = true;
      }
      for (const modelItem of providerPicker.models) {
        modelItem!.visible = false;
      }
    } else {
      const currentProvider = VALID_PROVIDERS[providerPickerState.providerIndex] ?? "";
      const models = PROVIDER_MODELS[currentProvider] ?? [];
      if (models.length === 0) {
        providerPickerState.mode = "providers";
        return;
      }
      providerPickerState.modelIndex = (providerPickerState.modelIndex + direction + models.length) % models.length;
      for (let i = 0; i < providerPicker.models.length; i++) {
        const isSelected = i === providerPickerState.modelIndex;
        const prefix = isSelected ? "● " : "  ";
        const model = models[i] ?? "";
        if (providerPicker.models[i]) {
          providerPicker.models[i]!.content = t`${fg(isSelected ? currentTheme.primary : currentTheme.textMuted)(prefix + model)}`;
        }
      }
    }
  }

  function navigateThemePicker(direction: number): void {
    localThemeIndex = (localThemeIndex + direction + themeNames.length) % themeNames.length;
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

  function applyTheme(newTheme: KilnTheme): void {
    currentTheme = newTheme;
    renderer.setBackgroundColor(currentTheme.background);
    ui.rootContainer.backgroundColor = currentTheme.background;
    ui.chatColumn.backgroundColor = currentTheme.background;
    ui.chatScrollBox.backgroundColor = currentTheme.background;
    ui.inputContainer.backgroundColor = currentTheme.backgroundElement;
    ui.commandBar.backgroundColor = currentTheme.background;
    ui.sidebar.backgroundColor = currentTheme.backgroundPanel;
    ui.sidebarProviderText.content = t`${fg(currentTheme.accent)("[" + provider + "]")} ${fg(currentTheme.text)(domain)}`;
    ui.sidebarCostText.content = t`${fg(currentTheme.textMuted)(`$${state.cost.toFixed(4)}`)}`;
    ui.sidebarCwdText.content = t`${fg(currentTheme.textMuted)(shortPath(process.cwd()))}`;
    ui.sidebarTurnsText.content = t`${fg(currentTheme.textMuted)(`turns: ${state.turns}  tok: ${state.inputTokens >= 1000 ? (state.inputTokens / 1000).toFixed(1) + "k" : state.inputTokens}/${state.outputTokens >= 1000 ? (state.outputTokens / 1000).toFixed(1) + "k" : state.outputTokens}`)}`;
    ui.sidebarDivider.content = t`${fg(currentTheme.border)("─".repeat(38))}`;
    renderInput();
    renderCommandBarStatus();
    ui.commandBarText.content = t`${fg(currentTheme.textMuted)("/theme /provider  ctrl+shift+P commands")}`;
    for (const { msg, node } of messageNodes) {
      const parent = node.parent;
      if (parent && "backgroundColor" in parent) {
        (parent as unknown as { backgroundColor: string }).backgroundColor = msg.role === "user" ? currentTheme.userBg : msg.role === "assistant" ? currentTheme.assistantBg : currentTheme.background;
      }
    }
    update(state, "messages", [...state.messages]);
  }

  function shortPath(p: string): string {
    const base = require("node:path").basename(p);
    const parent = require("node:path").basename(require("node:path").dirname(p));
    return parent ? `${parent}/${base}` : base;
  }

  function renderInput(): void {
    if (ui.inputTextarea) {
      ui.inputTextarea.textColor = currentTheme.text;
    }
  }

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
      const details = activity.details && activity.details.length > 40
        ? ` (${activity.details.slice(0, 37)}...)`
        : activity.details ? ` (${activity.details})` : "";
      
      const spinner = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length] ?? "⠋";
      
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

  const { t, fg } = await import("@opentui/core");

  // Input handling
  renderer.keyInput.on("keypress", (key) => {
    if (key.sequence === "\x03" || (key.ctrl && (key.name === "c" || key.sequence === "C"))) {
      renderer.destroy();
      process.exit(0);
      return;
    }

    if (themePickerOpen) {
      if (key.sequence === "\x1b") {
        closeThemePicker(false);
        return;
      }
      if (key.sequence === "\r" || key.sequence === "\n") {
        closeThemePicker(true);
        return;
      }
      if (key.name === "up" || key.sequence === "\x1b[A" || key.name === "k") {
        navigateThemePicker(-1);
        return;
      }
      if (key.name === "down" || key.sequence === "\x1b[B" || key.name === "j") {
        navigateThemePicker(1);
        return;
      }
      return;
    }

    if (providerPickerOpen) {
      if (!providerPicker) return;
      if (key.sequence === "\x1b") {
        if (providerPickerState.mode === "models") {
          providerPickerState.mode = "providers";
          providerPicker.title.content = t`${fg(currentTheme.accent)(" Select Provider ")}`;
          for (const providerItem of providerPicker.providers) {
            if (providerItem) providerItem.visible = true;
          }
          for (const modelItem of providerPicker.models) {
            if (modelItem) modelItem.visible = false;
          }
          return;
        }
        closeProviderPicker(false);
        return;
      }
      if (key.sequence === "\r" || key.sequence === "\n") {
        if (providerPickerState.mode === "providers") {
          const currentProvider = VALID_PROVIDERS[providerPickerState.providerIndex] ?? "";
          const models = PROVIDER_MODELS[currentProvider] ?? [];
          if (models.length > 0) {
            providerPickerState.mode = "models";
            providerPicker.title.content = t`${fg(currentTheme.accent)(` ${currentProvider} models `)}`;
            for (const providerItem of providerPicker.providers) {
              if (providerItem) providerItem.visible = false;
            }
            for (let i = 0; i < providerPicker.models.length; i++) {
              const modelItem = providerPicker.models[i];
              if (modelItem) {
                modelItem.visible = i < models.length;
                if (i < models.length) {
                  const isSelected = i === providerPickerState.modelIndex;
                  const prefix = isSelected ? "● " : "  ";
                  modelItem.content = t`${fg(isSelected ? currentTheme.primary : currentTheme.textMuted)(prefix + models[i])}`;
                }
              }
            }
          }
          return;
        }
        closeProviderPicker(true);
        return;
      }
      if (key.name === "up" || key.sequence === "\x1b[A" || key.name === "k") {
        navigateProviderPicker(-1);
        return;
      }
      if (key.name === "down" || key.sequence === "\x1b[B" || key.name === "j") {
        navigateProviderPicker(1);
        return;
      }
      return;
    }

    if (key.ctrl && (key.name === "v" || key.sequence === "\x16")) {
      try {
        let clip: string;
        if (process.platform === "win32") {
          clip = execSync("powershell -command Get-Clipboard", { encoding: "utf8", timeout: 1000 });
        } else if (process.platform === "darwin") {
          clip = execSync("pbpaste", { encoding: "utf8", timeout: 1000 });
        } else {
          clip = execSync("xclip -selection clipboard -o 2>/dev/null || xsel -b -o 2>/dev/null", { encoding: "utf8", timeout: 1000, shell: "/bin/bash" });
        }
        const text = clip.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "");
        if (text) {
          update(state, "input", state.input + text);
          renderInput();
        }
      } catch {
        // Clipboard unavailable
      }
      return;
    }

    const cp = key.sequence.charCodeAt(0);
    if (key.sequence.length === 1 && !key.ctrl && !key.meta && cp >= 32 && cp !== 127 && cp !== 13) {
      update(state, "input", state.input + key.sequence);
      return;
    }

    if ((key.sequence === "\r" || key.sequence === "\n") && state.status !== "running") {
      const text = state.input.trim();
      if (text) {
        ui.inputTextarea.clear();
        if (text === "/clear") {
          void (async () => {
            const session = await createSession();
            const hasClear = typeof (session as unknown as { clear?: unknown }).clear === "function";
            if (hasClear) {
              try { await (session as unknown as { clear: () => Promise<void> }).clear(); } catch { /* fail-open */ }
            }
            const statusNode = new (await import("@opentui/core")).TextRenderable(renderer, {
              content: t`${fg(currentTheme.accent)("Session cleared. Starting fresh next turn.")}`,
              width: "100%",
            });
            ui.chatScrollBox.content.add(statusNode);
            update(state, "messages", [...state.messages]);
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
            provider,
            domain,
          },
          text,
          thinkingNodeRef,
          () => renderSidebarCost(state, currentTheme, ui),
          () => renderSidebarTurns(state, currentTheme, ui),
          renderCommandBarStatus,
          startSpinner,
          stopSpinner,
          spinnerRef
        );
      }
      return;
    }

    if (key.sequence === "\u007f") {
      update(state, "input", state.input.slice(0, -1));
      renderInput();
      return;
    }
  });

  await new Promise<void>((resolve) => renderer.once("destroy", resolve));
}

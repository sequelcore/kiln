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
import { initUI, createThemePicker, destroyThemePicker } from "./ui.js";
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
    ui.sidebarTurnsText.content = t`${fg(currentTheme.textMuted)(`turns: ${state.turns}  tok: ${state.inputTokens + state.outputTokens}`)}`;
    ui.sidebarDivider.content = t`${fg(currentTheme.border)("─".repeat(38))}`;
    renderInput();
    renderCommandBarStatus();
    ui.commandBarText.content = t`${fg(currentTheme.textMuted)("/theme  ctrl+shift+P commands")}`;
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

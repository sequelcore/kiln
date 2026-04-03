/**
 * @fileoverview UI creation functions for TUI components.
 * @module @kilnai/tui
 */

import { basename, dirname } from "node:path";
import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  ScrollBoxRenderable,
  t,
  fg,
  RGBA,
  type CliRenderer,
} from "@opentui/core";
import type { ReactiveState } from "./state.js";
import type { KilnTheme } from "./theme.js";

/**
 * Shortens a file path to parent/base format.
 */
export function shortPath(p: string): string {
  const base = basename(p);
  const parent = basename(dirname(p));
  return parent ? `${parent}/${base}` : base;
}

/**
 * UI initialization result containing all created renderables.
 */
export interface UIComponents {
  rootContainer: InstanceType<typeof BoxRenderable>;
  mainRow: InstanceType<typeof BoxRenderable>;
  chatColumn: InstanceType<typeof BoxRenderable>;
  chatScrollBox: InstanceType<typeof ScrollBoxRenderable>;
  sidebar: InstanceType<typeof BoxRenderable>;
  sidebarProviderText: InstanceType<typeof TextRenderable>;
  sidebarCostText: InstanceType<typeof TextRenderable>;
  sidebarCwdText: InstanceType<typeof TextRenderable>;
  sidebarTurnsText: InstanceType<typeof TextRenderable>;
  sidebarDivider: InstanceType<typeof TextRenderable>;
  sidebarToolsBox: InstanceType<typeof ScrollBoxRenderable>;
  inputContainer: InstanceType<typeof BoxRenderable>;
  inputTextarea: InstanceType<typeof TextareaRenderable>;
  commandBar: InstanceType<typeof BoxRenderable>;
  commandBarStatus: InstanceType<typeof TextRenderable>;
  commandBarText: InstanceType<typeof TextRenderable>;
}

/**
 * Initializes and returns all UI components.
 */
export function initUI(
  renderer: CliRenderer,
  state: ReactiveState,
  theme: KilnTheme,
  provider: string,
  domain: string,
  terminalWidth: number,
  terminalHeight: number,
  onSubmit: (text: string) => void
): UIComponents {
  const rootContainer = new BoxRenderable(renderer, {
    id: "root",
    flexDirection: "column",
    width: terminalWidth,
    height: terminalHeight,
    backgroundColor: theme.background,
    zIndex: 1,
  });
  renderer.root.add(rootContainer);

  const mainRow = new BoxRenderable(renderer, {
    id: "main-row",
    flexDirection: "row",
    width: terminalWidth,
    flexGrow: 1,
    flexShrink: 1,
  });
  rootContainer.add(mainRow);

  const chatColumn = new BoxRenderable(renderer, {
    id: "chat-column",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    width: terminalWidth - 43,
    paddingLeft: 2,
    paddingRight: 2,
    backgroundColor: theme.background,
  });
  mainRow.add(chatColumn);

  const chatScrollBox = new ScrollBoxRenderable(renderer, {
    id: "chat",
    flexGrow: 1,
    width: "100%",
    paddingTop: 1,
    paddingBottom: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    zIndex: 1,
    backgroundColor: theme.background,
  });
  chatColumn.add(chatScrollBox);

  const inputContainer = new BoxRenderable(renderer, {
    id: "input",
    flexShrink: 0,
    flexGrow: 0,
    width: "100%",
    minHeight: 1,
    maxHeight: 4,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
    backgroundColor: theme.backgroundElement,
    zIndex: 2,
  });
  chatColumn.add(inputContainer);

  const inputTextarea = new TextareaRenderable(renderer, {
    id: "input-textarea",
    minHeight: 1,
    maxHeight: 4,
    textColor: theme.text,
    focusedTextColor: theme.text,
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    placeholder: "",
    wrapMode: "word",
    onSubmit: () => {
      const text = inputTextarea.plainText.trim();
      if (text && state.status !== "running" && !state.themePickerOpen) {
        inputTextarea.clear();
        if (text === "/clear" || text === "/theme") {
          return;
        }
        onSubmit(text);
      }
    },
  });
  inputContainer.add(inputTextarea);

  inputTextarea.focus();

  const commandBar = new BoxRenderable(renderer, {
    id: "command-bar",
    flexShrink: 0,
    flexGrow: 0,
    flexDirection: "row",
    width: "100%",
    height: 3,
    paddingTop: 1,
    paddingBottom: 1,
    backgroundColor: theme.background,
    zIndex: 1,
  });
  chatColumn.add(commandBar);

  const commandBarStatus = new TextRenderable(renderer, {
    id: "command-bar-status",
    content: "",
    width: "auto",
  });
  commandBar.add(commandBarStatus);

  const commandBarSpacer = new BoxRenderable(renderer, {
    id: "command-bar-spacer",
    flexGrow: 1,
  });
  commandBar.add(commandBarSpacer);

  const commandBarText = new TextRenderable(renderer, {
    id: "command-bar-text",
    content: t`${fg(theme.textMuted)("/theme  ctrl+shift+P commands")}`,
  });
  commandBar.add(commandBarText);

  const sidebar = new BoxRenderable(renderer, {
    id: "sidebar",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    width: 42,
    paddingLeft: 2,
    paddingRight: 1,
    paddingTop: 1,
    backgroundColor: theme.backgroundPanel,
  });
  mainRow.add(sidebar);

  const sidebarProviderText = new TextRenderable(renderer, {
    id: "sidebar-provider",
    content: t`${fg(theme.accent)("[" + provider + "]")} ${fg(theme.text)(domain)}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarProviderText);

  const sidebarCostText = new TextRenderable(renderer, {
    id: "sidebar-cost",
    content: t`${fg(theme.textMuted)("$0.0000")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarCostText);

  const sidebarCwdText = new TextRenderable(renderer, {
    id: "sidebar-cwd",
    content: t`${fg(theme.textMuted)(shortPath(process.cwd()))}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarCwdText);

  const sidebarTurnsText = new TextRenderable(renderer, {
    id: "sidebar-turns",
    content: t`${fg(theme.textMuted)("turns: 0  tok: 0")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarTurnsText);

  const sidebarDivider = new TextRenderable(renderer, {
    id: "sidebar-divider",
    content: t`${fg(theme.border)("─".repeat(38))}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarDivider);

  const sidebarToolsLabel = new TextRenderable(renderer, {
    id: "sidebar-tools-label",
    content: t`${fg(theme.textMuted)("tools")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarToolsLabel);

  const sidebarToolsBox = new ScrollBoxRenderable(renderer, {
    id: "sidebar-tools",
    flexGrow: 1,
    width: "100%",
    stickyScroll: true,
    stickyStart: "bottom",
  });
  sidebar.add(sidebarToolsBox);

  return {
    rootContainer,
    mainRow,
    chatColumn,
    chatScrollBox,
    sidebar,
    sidebarProviderText,
    sidebarCostText,
    sidebarCwdText,
    sidebarTurnsText,
    sidebarDivider,
    sidebarToolsBox,
    inputContainer,
    inputTextarea,
    commandBar,
    commandBarStatus,
    commandBarText,
  };
}

/**
 * Theme picker overlay components.
 */
export interface ThemePickerComponents {
  scrim: InstanceType<typeof BoxRenderable>;
  panel: InstanceType<typeof BoxRenderable>;
  title: InstanceType<typeof TextRenderable>;
  items: InstanceType<typeof TextRenderable>[];
  hint: InstanceType<typeof TextRenderable>;
}

/**
 * Creates theme picker overlay.
 */
export function createThemePicker(
  renderer: CliRenderer,
  theme: KilnTheme,
  themeNames: string[],
  terminalWidth: number,
  terminalHeight: number,
  initialIndex: number
): ThemePickerComponents {
  const scrim = new BoxRenderable(renderer, {
    id: "theme-picker-scrim",
    position: "absolute",
    left: 0,
    top: 0,
    width: terminalWidth,
    height: terminalHeight,
    backgroundColor: RGBA.fromInts(0, 0, 0, 150),
    zIndex: 3000,
    alignItems: "center",
    justifyContent: "center",
  });
  renderer.root.add(scrim);

  const panelWidth = 40;
  const panel = new BoxRenderable(renderer, {
    id: "theme-picker-panel",
    flexDirection: "column",
    width: panelWidth,
    backgroundColor: theme.backgroundPanel,
    border: true,
    borderColor: theme.accent,
  });
  scrim.add(panel);

  const title = new TextRenderable(renderer, {
    id: "theme-picker-title",
    content: t`${fg(theme.accent)(" Select Theme ")}`,
    width: "100%",
    height: 2,
  });
  panel.add(title);

  const items: InstanceType<typeof TextRenderable>[] = [];
  for (let i = 0; i < themeNames.length; i++) {
    const name = themeNames[i];
    const isSelected = i === initialIndex;
    const prefix = isSelected ? "● " : "  ";
    const item = new TextRenderable(renderer, {
      id: `theme-item-${i}`,
      content: t`${fg(isSelected ? theme.accent : theme.textMuted)(prefix + name)}`,
      width: "100%",
      height: 2,
    });
    panel.add(item);
    items.push(item);
  }

  const hint = new TextRenderable(renderer, {
    id: "theme-picker-hint",
    content: t`${fg(theme.textMuted)("↑↓ navigate  Enter select  Esc cancel")}`,
    width: "100%",
    height: 2,
  });
  panel.add(hint);

  return { scrim, panel, title, items, hint };
}

/**
 * Destroys theme picker overlay.
 */
export function destroyThemePicker(picker: ThemePickerComponents): void {
  picker.scrim.destroy();
}

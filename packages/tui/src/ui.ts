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
import { operatorEmptyStatePhraseAt } from "@kilnai/gateway-contracts";
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
  sidebarResumeText: InstanceType<typeof TextRenderable>;
  sidebarFieldText: InstanceType<typeof TextRenderable>;
  sidebarDivider: InstanceType<typeof TextRenderable>;
  sidebarToolsBox: InstanceType<typeof ScrollBoxRenderable>;
  sidebarManagedAgentsText: InstanceType<typeof TextRenderable>;
  sidebarWorkText: InstanceType<typeof TextRenderable>;
  sidebarSessionsText: InstanceType<typeof TextRenderable>;
  sidebarApprovalsText: InstanceType<typeof TextRenderable>;
  sidebarChangesText: InstanceType<typeof TextRenderable>;
  inputContainer: InstanceType<typeof BoxRenderable>;
  inputTextarea: InstanceType<typeof TextareaRenderable>;
  commandBar: InstanceType<typeof BoxRenderable>;
  commandBarStatus: InstanceType<typeof TextRenderable>;
  commandBarText: InstanceType<typeof TextRenderable>;
  slashPopover: InstanceType<typeof BoxRenderable>;
  slashPopoverText: InstanceType<typeof TextRenderable>;
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
    placeholder: operatorEmptyStatePhraseAt(0),
    wrapMode: "word",
    onSubmit: () => {
      const text = inputTextarea.plainText.trim();
      if (text && state.status !== "running" && !state.themePickerOpen) {
        inputTextarea.clear();
        if (text === "/clear" || text === "/theme" || text === "/provider" || text === "/effort" || text === "/authority" || text === "/resume" || text === "/plan" || text === "/exec" || text === "/setup") {
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
    content: t`${fg(theme.textMuted)("/setup /theme /provider  ctrl+shift+P commands")}`,
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

  const sidebarBrandText = new TextRenderable(renderer, {
    id: "sidebar-brand",
    content: t`${fg(theme.accent)("KILN")} ${fg(theme.textMuted)("control plane")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarBrandText);

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

  const sidebarResumeText = new TextRenderable(renderer, {
    id: "sidebar-resume",
    content: t`${fg(theme.textMuted)("resume: --\nruntime: --\nctx: --\nsrcs: --\nwhy: --\nused: --\nsel: --")}`,
    width: "100%",
    height: 8,
  });
  sidebar.add(sidebarResumeText);

  const sidebarFieldText = new TextRenderable(renderer, {
    id: "sidebar-field",
    content: t`${fg(theme.textMuted)("field [?]\ndom: --\nsat: 0%  H: 0.00")}`,
    width: "100%",
    height: 4,
  });
  sidebar.add(sidebarFieldText);

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

  const sidebarManagedAgentsLabel = new TextRenderable(renderer, {
    id: "sidebar-managed-agents-label",
    content: t`${fg(theme.textMuted)("managed agents")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarManagedAgentsLabel);

  const sidebarManagedAgentsText = new TextRenderable(renderer, {
    id: "sidebar-managed-agents",
    content: t`${fg(theme.textMuted)("(none)")}`,
    width: "100%",
    flexGrow: 1,
  });
  sidebar.add(sidebarManagedAgentsText);

  const sidebarWorkLabel = new TextRenderable(renderer, {
    id: "sidebar-work-label",
    content: t`${fg(theme.textMuted)("work")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarWorkLabel);

  const sidebarWorkText = new TextRenderable(renderer, {
    id: "sidebar-work",
    content: t`${fg(theme.textMuted)("(none)")}`,
    width: "100%",
    flexGrow: 1,
  });
  sidebar.add(sidebarWorkText);

  const sidebarSessionsLabel = new TextRenderable(renderer, {
    id: "sidebar-sessions-label",
    content: t`${fg(theme.textMuted)("sessions")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarSessionsLabel);

  const sidebarSessionsText = new TextRenderable(renderer, {
    id: "sidebar-sessions",
    content: t`${fg(theme.textMuted)("(no sessions)")}`,
    width: "100%",
    flexGrow: 1,
  });
  sidebar.add(sidebarSessionsText);

  const sidebarApprovalsLabel = new TextRenderable(renderer, {
    id: "sidebar-approvals-label",
    content: t`${fg(theme.textMuted)("approvals")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarApprovalsLabel);

  const sidebarApprovalsText = new TextRenderable(renderer, {
    id: "sidebar-approvals",
    content: t`${fg(theme.textMuted)("(none)")}`,
    width: "100%",
    flexGrow: 1,
  });
  sidebar.add(sidebarApprovalsText);

  const sidebarChangesLabel = new TextRenderable(renderer, {
    content: t`${fg(theme.textMuted)("changes")}`,
    width: "100%",
    height: 2,
  });
  sidebar.add(sidebarChangesLabel);

  const sidebarChangesText = new TextRenderable(renderer, {
    id: "sidebar-changes",
    content: t`${fg(theme.textMuted)("(none)")}`,
    width: "100%",
    flexGrow: 1,
  });
  sidebar.add(sidebarChangesText);

  const slashPopover = new BoxRenderable(renderer, {
    id: "slash-popover",
    width: "100%",
    maxHeight: 10,
    flexDirection: "column",
    backgroundColor: theme.background,
    zIndex: 100,
    visible: false,
  });

  const slashPopoverText = new TextRenderable(renderer, {
    id: "slash-popover-text",
    content: t`${fg(theme.text)("")}`,
    width: "100%",
    flexGrow: 1,
  });
  slashPopover.add(slashPopoverText);

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
    sidebarResumeText,
    sidebarFieldText,
    sidebarDivider,
    sidebarToolsBox,
    sidebarManagedAgentsText,
    sidebarWorkText,
    sidebarSessionsText,
    sidebarApprovalsText,
    sidebarChangesText,
    inputContainer,
    inputTextarea,
    commandBar,
    commandBarStatus,
    commandBarText,
    slashPopover,
    slashPopoverText,
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

/**
 * Provider picker overlay components.
 *
 * ARCHITECTURE NOTE:
 * title and hint live OUTSIDE the scrollBox (in a wrapper column panel) so
 * their height never offsets the y-coordinates of data rows inside the
 * scrollBox.  Only data rows are ever added to / removed from scrollBox.content.
 * This makes scrollChildIntoView() work correctly with no manual math.
 */
export interface ProviderPickerComponents {
  scrim: InstanceType<typeof BoxRenderable>;
  /** Outer column panel that holds title + scrollBox + hint. */
  panel: InstanceType<typeof BoxRenderable>;
  title: InstanceType<typeof TextRenderable>;
  /** The scrollable region that contains ONLY data rows. */
  scrollBox: InstanceType<typeof ScrollBoxRenderable>;
  hint: InstanceType<typeof TextRenderable>;
  /** Live data rows currently in scrollBox.content. */
  rows: InstanceType<typeof TextRenderable>[];
  mode: "providers" | "models" | "auth-key" | "auth-confirm";
}

/**
 * Creates the provider picker overlay shell.
 *
 * Layout (top→bottom inside panel):
 *   ┌─────────────────────────┐
 *   │  title  (TextRenderable) │  ← fixed, outside scroll
 *   ├─────────────────────────┤
 *   │  scrollBox               │  ← only data rows scroll here
 *   ├─────────────────────────┤
 *   │  hint   (TextRenderable) │  ← fixed, outside scroll
 *   └─────────────────────────┘
 *
 * Data rows are managed entirely by app.tsx via renderProviderPicker().
 */
export function createProviderPicker(
  renderer: CliRenderer,
  theme: KilnTheme,
  terminalWidth: number,
  terminalHeight: number
): ProviderPickerComponents {
  const scrim = new BoxRenderable(renderer, {
    id: "provider-picker-scrim",
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

  const panelWidth = 50;

  // Reserve rows for: title(2) + hint(2) + border(2) = 6
  // Give the scrollbox the remaining space up to a cap.
  const scrollBoxHeight = Math.min(terminalHeight - 4 - 6, 18);

  // Outer column panel: border + title + scrollbox + hint
  const panel = new BoxRenderable(renderer, {
    id: "provider-picker-panel",
    flexDirection: "column",
    width: panelWidth,
    backgroundColor: theme.backgroundPanel,
    border: true,
    borderColor: theme.accent,
  });
  scrim.add(panel);

  // Title row — fixed, never scrolls
  const title = new TextRenderable(renderer, {
    id: "provider-picker-title",
    content: t`${fg(theme.accent)(" Select Provider ")}`,
    width: "100%",
    height: 2,
  });
  panel.add(title);

  // Scrollable data area — ONLY data rows go in here
  const scrollBox = new ScrollBoxRenderable(renderer, {
    id: "provider-picker-scrollbox",
    width: "100%",
    height: scrollBoxHeight,
    backgroundColor: theme.backgroundPanel,
    scrollY: true,
  });
  panel.add(scrollBox);

  // Hint row — fixed, never scrolls
  const hint = new TextRenderable(renderer, {
    id: "provider-picker-hint",
    content: t`${fg(theme.textMuted)("↑↓ navigate  Enter select  Esc cancel")}`,
    width: "100%",
    height: 2,
  });
  panel.add(hint);

  return {
    scrim,
    panel,
    title,
    scrollBox,
    hint,
    rows: [],
    mode: "providers",
  };
}

/**
 * Destroys provider picker overlay.
 */
export function destroyProviderPicker(picker: ProviderPickerComponents): void {
  picker.scrim.destroy();
}

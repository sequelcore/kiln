/**
 * @fileoverview Render helper functions for TUI UI updates.
 * @module @kilnai/tui
 */

import { t, fg } from "@opentui/core";
import type { ReactiveState, Message } from "./state.js";
import type { KilnTheme } from "./theme.js";
import type { UIComponents } from "./ui.js";

/**
 * Renders the sidebar cost display.
 */
export function renderSidebarCost(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  if (state.status === "running") {
    ui.sidebarCostText.content = t`${fg(theme.textMuted)("thinking...")}`;
  } else {
    ui.sidebarCostText.content = t`${fg(theme.textMuted)(`$${state.cost.toFixed(4)}`)}`;
  }
}

/**
 * Renders the sidebar turns and tokens display.
 */
export function renderSidebarTurns(
  state: ReactiveState,
  theme: KilnTheme,
  ui: UIComponents
): void {
  const total = state.inputTokens + state.outputTokens;
  ui.sidebarTurnsText.content = t`${fg(theme.textMuted)(`turns: ${state.turns}  tok: ${total}`)}`;
}

/**
 * Renders the input field colors.
 */
export function renderInput(
  theme: KilnTheme,
  ui: UIComponents
): void {
  if (ui.inputTextarea) {
    ui.inputTextarea.textColor = theme.text;
  }
}

/**
 * Generates content for a message based on its role.
 */
export function msgContent(
  m: Message,
  theme: KilnTheme
): ReturnType<typeof t> | string {
  if (m.role === "user") return t`${fg(theme.userFg)("you")}: ${m.content}`;
  if (m.role === "tool") return t`${fg(theme.toolFg)(`⟳ ${m.toolName ?? "tool"}`)}`;
  if (m.role === "error") return t`${fg(theme.error)("error")}: ${m.content}`;
  return m.content;
}

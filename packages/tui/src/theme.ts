/**
 * @fileoverview Theme system for TUI.
 * @module @kilnai/tui
 */

import {
  DEFAULT_OPERATOR_THEME_NAME,
  OPERATOR_THEME_NAMES,
  isOperatorThemeName,
  operatorColorToHex,
  resolveOperatorThemePalette,
  type OperatorThemeName,
  type OperatorThemePalette,
} from "@kilnai/gateway-contracts";

export interface KilnTheme {
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  border: string;
  borderActive: string;
  text: string;
  textMuted: string;
  accent: string;
  primary: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  userFg: string;
  userBg: string;
  userBorder: string;
  assistantBg: string;
  toolFg: string;
  thinkingFg: string;
  cursorFg: string;
}

function createTheme(palette: OperatorThemePalette): KilnTheme {
  return {
    background: operatorColorToHex(palette.surface.canvas),
    backgroundPanel: operatorColorToHex(palette.surface.default),
    backgroundElement: operatorColorToHex(palette.control.secondary),
    border: operatorColorToHex(palette.surface.border),
    borderActive: operatorColorToHex(palette.control.focus),
    text: operatorColorToHex(palette.text.default),
    textMuted: operatorColorToHex(palette.text.muted),
    accent: operatorColorToHex(palette.control.accent),
    primary: operatorColorToHex(palette.conversation.message.action),
    success: operatorColorToHex(palette.status.success.foreground),
    error: operatorColorToHex(palette.status.error.foreground),
    warning: operatorColorToHex(palette.status.warning.foreground),
    info: operatorColorToHex(palette.status.info.foreground),
    userFg: operatorColorToHex(palette.conversation.message.foreground),
    userBg: operatorColorToHex(palette.conversation.message.surface),
    userBorder: operatorColorToHex(palette.surface.border),
    assistantBg: operatorColorToHex(palette.surface.default),
    toolFg: operatorColorToHex(palette.status.success.foreground),
    thinkingFg: operatorColorToHex(palette.text.muted),
    cursorFg: operatorColorToHex(palette.terminal.cursor),
  };
}

export const phosphorTheme: KilnTheme = createTheme(resolveOperatorThemePalette("phosphor"));
export const vesperTheme: KilnTheme = createTheme(resolveOperatorThemePalette("vesper"));
export const automataTheme: KilnTheme = createTheme(resolveOperatorThemePalette("automata"));
export const defaultTheme = phosphorTheme;

export const themes: Record<OperatorThemeName, KilnTheme> = {
  phosphor: phosphorTheme,
  vesper: vesperTheme,
  automata: automataTheme,
  "system-follow": phosphorTheme,
};

export function getTheme(name?: string): KilnTheme {
  if (!name || !isOperatorThemeName(name)) return themes[DEFAULT_OPERATOR_THEME_NAME];
  return themes[name];
}

export function themeNames(): OperatorThemeName[] {
  return [...OPERATOR_THEME_NAMES];
}

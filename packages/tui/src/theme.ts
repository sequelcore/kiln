/**
 * @fileoverview Theme system for TUI.
 * @module @kilnai/tui
 */

import {
  OPERATOR_THEME_NAMES,
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
    backgroundPanel: operatorColorToHex(palette.surface.panel),
    backgroundElement: operatorColorToHex(palette.surface.interactive),
    border: operatorColorToHex(palette.border.default),
    borderActive: operatorColorToHex(palette.border.focus),
    text: operatorColorToHex(palette.text.default),
    textMuted: operatorColorToHex(palette.text.muted),
    accent: operatorColorToHex(palette.brand.accent),
    primary: operatorColorToHex(palette.action.primary),
    success: operatorColorToHex(palette.status.success.foreground),
    error: operatorColorToHex(palette.status.danger.foreground),
    warning: operatorColorToHex(palette.status.warning.foreground),
    info: operatorColorToHex(palette.status.info.foreground),
    userFg: operatorColorToHex(palette.text.default),
    userBg: operatorColorToHex(palette.surface.selected),
    userBorder: operatorColorToHex(palette.border.default),
    assistantBg: operatorColorToHex(palette.surface.panel),
    toolFg: operatorColorToHex(palette.status.success.foreground),
    thinkingFg: operatorColorToHex(palette.text.muted),
    cursorFg: operatorColorToHex(palette.action.primary),
  };
}

export const kilnDark: KilnTheme = createTheme(resolveOperatorThemePalette("kiln-dark"));
export const kilnGraphite: KilnTheme = createTheme(resolveOperatorThemePalette("kiln-graphite"));
export const kilnLight: KilnTheme = createTheme(resolveOperatorThemePalette("kiln-light"));
export const defaultTheme = kilnDark;

export const themes: Record<string, KilnTheme> = {
  "kiln-dark": kilnDark,
  "kiln-graphite": kilnGraphite,
  "kiln-light": kilnLight,
  "system-follow": kilnDark,
};

export function getTheme(name?: string): KilnTheme {
  if (!name) return defaultTheme;
  return themes[name as OperatorThemeName] ?? defaultTheme;
}

export function themeNames(): string[] {
  return [...OPERATOR_THEME_NAMES];
}

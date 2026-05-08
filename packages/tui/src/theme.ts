/**
 * @fileoverview Theme system for TUI.
 * @module @kilnai/tui
 */

import {
  OPERATOR_THEME_NAMES,
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
    background: palette.background,
    backgroundPanel: palette.backgroundPanel,
    backgroundElement: palette.backgroundElement,
    border: palette.border,
    borderActive: palette.borderActive,
    text: palette.text,
    textMuted: palette.textMuted,
    accent: palette.accent,
    primary: palette.primary,
    success: palette.success,
    error: palette.error,
    warning: palette.warning,
    info: palette.info,
    userFg: palette.text,
    userBg: palette.backgroundElement,
    userBorder: palette.border,
    assistantBg: palette.backgroundPanel,
    toolFg: palette.success,
    thinkingFg: palette.textMuted,
    cursorFg: palette.success,
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

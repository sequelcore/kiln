/**
 * @fileoverview Theme system for TUI.
 * @module @kilnai/tui
 */

import {
  isOperatorThemeName,
  OPERATOR_THEME_DEFINITIONS_BY_ID,
  OPERATOR_THEME_NAMES,
  type OperatorThemeName,
  type OperatorThemePalette,
  operatorColorToHex,
} from "@kilnai/operator-appearance";

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
  codeBg: string;
  codeFg: string;
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
    codeBg: operatorColorToHex(palette.conversation.code.background),
    codeFg: operatorColorToHex(palette.conversation.code.foreground),
  };
}

const phosphorPalette = OPERATOR_THEME_DEFINITIONS_BY_ID.phosphor.variants.dark;
const sequelPalette = OPERATOR_THEME_DEFINITIONS_BY_ID.sequel.variants.dark;
const vesperPalette = OPERATOR_THEME_DEFINITIONS_BY_ID.vesper.variants.dark;
const automataPalette = OPERATOR_THEME_DEFINITIONS_BY_ID.automata.variants.light;
if (!phosphorPalette || !sequelPalette || !vesperPalette || !automataPalette) {
  throw new Error("Built-in TUI theme variants are unavailable.");
}
export const phosphorTheme: KilnTheme = createTheme(phosphorPalette);
export const sequelTheme: KilnTheme = createTheme(sequelPalette);
export const vesperTheme: KilnTheme = createTheme(vesperPalette);
export const automataTheme: KilnTheme = createTheme(automataPalette);
export const defaultTheme = phosphorTheme;

export const themes: Record<OperatorThemeName, KilnTheme> = {
  phosphor: phosphorTheme,
  sequel: sequelTheme,
  vesper: vesperTheme,
  automata: automataTheme,
};

export function getTheme(name?: string): KilnTheme {
  if (!name || !isOperatorThemeName(name)) return themes.phosphor;
  return themes[name];
}

export function themeNames(): OperatorThemeName[] {
  return [...OPERATOR_THEME_NAMES];
}

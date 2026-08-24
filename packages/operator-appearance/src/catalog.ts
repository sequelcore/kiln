import {
  AUTOMATA_OPERATOR_THEME,
  OPERATOR_THEME_DEFINITIONS,
  OPERATOR_THEME_PALETTES,
  PHOSPHOR_OPERATOR_THEME,
  VESPER_OPERATOR_THEME,
} from "./palettes.js";
import type { OperatorAppearancePreference, OperatorThemeDefinition, OperatorThemeName } from "./types.js";

export const OPERATOR_THEME_NAMES: readonly [OperatorThemeName, OperatorThemeName, OperatorThemeName] = [
  "automata",
  "phosphor",
  "vesper",
];

export function isOperatorThemeName(value: unknown): value is OperatorThemeName {
  return typeof value === "string" && OPERATOR_THEME_NAMES.some((theme) => theme === value);
}

export const OPERATOR_THEME_LABELS: Readonly<Record<OperatorThemeName, string>> = {
  automata: "Automata",
  phosphor: "Phosphor",
  vesper: "Vesper",
};

export const FIXED_FALLBACK_OPERATOR_THEME_IDS: Readonly<{
  readonly light: "automata";
  readonly dark: "phosphor";
}> = {
  light: "automata",
  dark: "phosphor",
};

export const DEFAULT_OPERATOR_APPEARANCE_PREFERENCE: OperatorAppearancePreference = {
  mode: "system",
  themeByScheme: {
    light: FIXED_FALLBACK_OPERATOR_THEME_IDS.light,
    dark: FIXED_FALLBACK_OPERATOR_THEME_IDS.dark,
  },
};

export const OPERATOR_THEME_DEFINITIONS_BY_ID: Readonly<Record<OperatorThemeName, OperatorThemeDefinition>> = {
  automata: AUTOMATA_OPERATOR_THEME,
  phosphor: PHOSPHOR_OPERATOR_THEME,
  vesper: VESPER_OPERATOR_THEME,
};

export {
  AUTOMATA_OPERATOR_THEME,
  OPERATOR_THEME_DEFINITIONS,
  OPERATOR_THEME_PALETTES,
  PHOSPHOR_OPERATOR_THEME,
  VESPER_OPERATOR_THEME,
};

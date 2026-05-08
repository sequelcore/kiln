export interface OperatorThemePalette {
  readonly background: string;
  readonly backgroundPanel: string;
  readonly backgroundElement: string;
  readonly border: string;
  readonly borderActive: string;
  readonly text: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly primary: string;
  readonly success: string;
  readonly error: string;
  readonly warning: string;
  readonly info: string;
}

export const OPERATOR_THEME_NAMES = [
  "kiln-dark",
  "kiln-graphite",
  "kiln-light",
  "system-follow",
] as const;

export type OperatorThemeName = (typeof OPERATOR_THEME_NAMES)[number];
export type ConcreteOperatorThemeName = Exclude<OperatorThemeName, "system-follow">;

export const OPERATOR_THEME_LABELS: Record<OperatorThemeName, string> = {
  "kiln-dark": "Kiln Obsidian",
  "kiln-graphite": "Kiln Graphite",
  "kiln-light": "Kiln Paper",
  "system-follow": "System",
};

export const OPERATOR_THEME_PALETTES: Record<ConcreteOperatorThemeName, OperatorThemePalette> = {
  "kiln-dark": {
    background: "#07080a",
    backgroundPanel: "#0d0f13",
    backgroundElement: "#151922",
    border: "#303743",
    borderActive: "#646b78",
    text: "#e8eaed",
    textMuted: "#9ca3ad",
    accent: "#f2a65a",
    primary: "#76c7e8",
    success: "#73c991",
    error: "#f87171",
    warning: "#e0b557",
    info: "#8ab4f8",
  },
  "kiln-graphite": {
    background: "#101114",
    backgroundPanel: "#17191e",
    backgroundElement: "#20242c",
    border: "#3b424d",
    borderActive: "#737b88",
    text: "#ecebe6",
    textMuted: "#a8a39a",
    accent: "#d98f45",
    primary: "#82cfff",
    success: "#75c486",
    error: "#ff7b72",
    warning: "#dab75c",
    info: "#9ab7ff",
  },
  "kiln-light": {
    background: "#f7f7f4",
    backgroundPanel: "#efefeb",
    backgroundElement: "#e4e5df",
    border: "#c8c9c0",
    borderActive: "#6f766d",
    text: "#1d1f1b",
    textMuted: "#5f665e",
    accent: "#9a4d16",
    primary: "#0b6785",
    success: "#246b3d",
    error: "#b42318",
    warning: "#73530f",
    info: "#355f9f",
  },
};

export function isOperatorThemeName(value: unknown): value is OperatorThemeName {
  return typeof value === "string" && (OPERATOR_THEME_NAMES as readonly string[]).includes(value);
}

export function isDarkOperatorTheme(theme: OperatorThemeName, systemPrefersDark = true): boolean {
  if (theme === "system-follow") {
    return systemPrefersDark;
  }
  return theme !== "kiln-light";
}

export function resolveOperatorThemePalette(
  theme: OperatorThemeName,
  systemPrefersDark = true,
): OperatorThemePalette {
  if (theme === "system-follow") {
    return systemPrefersDark ? OPERATOR_THEME_PALETTES["kiln-dark"] : OPERATOR_THEME_PALETTES["kiln-light"];
  }
  return OPERATOR_THEME_PALETTES[theme];
}

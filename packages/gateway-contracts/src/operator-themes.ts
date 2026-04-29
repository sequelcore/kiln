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
  "kiln-light",
  "system-follow",
  "dracula",
  "catppuccin-mocha",
  "nord",
  "tokyo-night",
  "gruvbox-dark",
  "rose-pine",
  "kanagawa-wave",
  "everforest-dark",
  "ayu-dark",
  "one-dark",
  "night-owl",
] as const;

export type OperatorThemeName = (typeof OPERATOR_THEME_NAMES)[number];
export type ConcreteOperatorThemeName = Exclude<OperatorThemeName, "system-follow">;

export const OPERATOR_THEME_LABELS: Record<OperatorThemeName, string> = {
  "kiln-dark": "Kiln Dark",
  "kiln-light": "Kiln Light",
  "system-follow": "System",
  dracula: "Dracula",
  "catppuccin-mocha": "Catppuccin Mocha",
  nord: "Nord",
  "tokyo-night": "Tokyo Night",
  "gruvbox-dark": "Gruvbox Dark",
  "rose-pine": "Rose Pine",
  "kanagawa-wave": "Kanagawa Wave",
  "everforest-dark": "Everforest Dark",
  "ayu-dark": "Ayu Dark",
  "one-dark": "One Dark",
  "night-owl": "Night Owl",
};

export const OPERATOR_THEME_PALETTES: Record<ConcreteOperatorThemeName, OperatorThemePalette> = {
  "kiln-dark": {
    background: "#11131a",
    backgroundPanel: "#161925",
    backgroundElement: "#1d2230",
    border: "#515d78",
    borderActive: "#8090b0",
    text: "#d9e1f2",
    textMuted: "#93a0b8",
    accent: "#b8a1ff",
    primary: "#7ad7ff",
    success: "#8fe1a5",
    error: "#ff8b99",
    warning: "#f3c96b",
    info: "#9fb0c7",
  },
  "kiln-light": {
    background: "#f7f9fc",
    backgroundPanel: "#eef2f8",
    backgroundElement: "#e2e8f1",
    border: "#aab6c7",
    borderActive: "#687896",
    text: "#1d2430",
    textMuted: "#586579",
    accent: "#7a4fd6",
    primary: "#0b6fae",
    success: "#16703a",
    error: "#b3263a",
    warning: "#8a5a00",
    info: "#4d6280",
  },
  dracula: {
    background: "#21222c",
    backgroundPanel: "#282a36",
    backgroundElement: "#343746",
    border: "#52576d",
    borderActive: "#7f8fc0",
    text: "#f8f8f2",
    textMuted: "#a1abc9",
    accent: "#bd93f9",
    primary: "#8be9fd",
    success: "#50fa7b",
    error: "#ff6b6b",
    warning: "#ffb86c",
    info: "#8aa1c1",
  },
  "catppuccin-mocha": {
    background: "#1e1e2e",
    backgroundPanel: "#181825",
    backgroundElement: "#313244",
    border: "#585b70",
    borderActive: "#7f849c",
    text: "#cdd6f4",
    textMuted: "#a6adc8",
    accent: "#cba6f7",
    primary: "#89dceb",
    success: "#a6e3a1",
    error: "#f38ba8",
    warning: "#fab387",
    info: "#89b4fa",
  },
  nord: {
    background: "#2e3440",
    backgroundPanel: "#3b4252",
    backgroundElement: "#434c5e",
    border: "#5c6780",
    borderActive: "#81a1c1",
    text: "#eceff4",
    textMuted: "#a7b1c2",
    accent: "#b48ead",
    primary: "#88c0d0",
    success: "#a3be8c",
    error: "#bf616a",
    warning: "#ebcb8b",
    info: "#81a1c1",
  },
  "tokyo-night": {
    background: "#1a1b26",
    backgroundPanel: "#16161e",
    backgroundElement: "#24283b",
    border: "#3b4261",
    borderActive: "#6f7bb3",
    text: "#c0caf5",
    textMuted: "#9aa5ce",
    accent: "#bb9af7",
    primary: "#7dcfff",
    success: "#9ece6a",
    error: "#f7768e",
    warning: "#e0af68",
    info: "#7aa2f7",
  },
  "gruvbox-dark": {
    background: "#282828",
    backgroundPanel: "#32302f",
    backgroundElement: "#3c3836",
    border: "#665c54",
    borderActive: "#928374",
    text: "#ebdbb2",
    textMuted: "#bdae93",
    accent: "#d3869b",
    primary: "#83a598",
    success: "#b8bb26",
    error: "#fb4934",
    warning: "#fabd2f",
    info: "#8ec07c",
  },
  "rose-pine": {
    background: "#191724",
    backgroundPanel: "#1f1d2e",
    backgroundElement: "#26233a",
    border: "#524f67",
    borderActive: "#6e6a86",
    text: "#e0def4",
    textMuted: "#908caa",
    accent: "#c4a7e7",
    primary: "#9ccfd8",
    success: "#31748f",
    error: "#eb6f92",
    warning: "#f6c177",
    info: "#9ccfd8",
  },
  "kanagawa-wave": {
    background: "#1f1f28",
    backgroundPanel: "#16161d",
    backgroundElement: "#2a2a37",
    border: "#54546d",
    borderActive: "#7e9cd8",
    text: "#dcd7ba",
    textMuted: "#a6a69c",
    accent: "#957fb8",
    primary: "#7fb4ca",
    success: "#98bb6c",
    error: "#e46876",
    warning: "#ffa066",
    info: "#7e9cd8",
  },
  "everforest-dark": {
    background: "#2b3339",
    backgroundPanel: "#323c41",
    backgroundElement: "#3a454a",
    border: "#56635f",
    borderActive: "#7fbbb3",
    text: "#d3c6aa",
    textMuted: "#9da9a0",
    accent: "#d699b6",
    primary: "#7fbbb3",
    success: "#a7c080",
    error: "#e67e80",
    warning: "#dbbc7f",
    info: "#83c092",
  },
  "ayu-dark": {
    background: "#0f1419",
    backgroundPanel: "#14191f",
    backgroundElement: "#1b2129",
    border: "#344050",
    borderActive: "#59c2ff",
    text: "#e6e1cf",
    textMuted: "#9aa5b1",
    accent: "#d2a6ff",
    primary: "#59c2ff",
    success: "#aad94c",
    error: "#ff7383",
    warning: "#ffb454",
    info: "#95bfff",
  },
  "one-dark": {
    background: "#1e2127",
    backgroundPanel: "#282c34",
    backgroundElement: "#2f343f",
    border: "#4b5263",
    borderActive: "#61afef",
    text: "#abb2bf",
    textMuted: "#8b93a6",
    accent: "#c678dd",
    primary: "#61afef",
    success: "#98c379",
    error: "#e06c75",
    warning: "#e5c07b",
    info: "#56b6c2",
  },
  "night-owl": {
    background: "#011627",
    backgroundPanel: "#0b1f33",
    backgroundElement: "#12243a",
    border: "#27415f",
    borderActive: "#82aaff",
    text: "#d6deeb",
    textMuted: "#7f93b3",
    accent: "#c792ea",
    primary: "#82aaff",
    success: "#22da6e",
    error: "#ff5874",
    warning: "#ecc48d",
    info: "#7fdbca",
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

/**
 * @fileoverview Theme system for TUI.
 * @module @kilnai/tui
 */

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

type BasePalette = {
  bg0: string;
  bg1: string;
  bg2: string;
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
};

function createTheme(p: BasePalette): KilnTheme {
  return {
    background: p.bg0,
    backgroundPanel: p.bg1,
    backgroundElement: p.bg2,
    border: p.border,
    borderActive: p.borderActive,
    text: p.text,
    textMuted: p.textMuted,
    accent: p.accent,
    primary: p.primary,
    success: p.success,
    error: p.error,
    warning: p.warning,
    info: p.info,
    userFg: p.text,
    userBg: p.bg2,
    userBorder: p.border,
    assistantBg: p.bg1,
    toolFg: p.success,
    thinkingFg: p.textMuted,
    cursorFg: p.success,
  };
}

export const kilnDark: KilnTheme = createTheme({
  bg0: "#11131a",
  bg1: "#161925",
  bg2: "#1d2230",
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
});

export const dracula: KilnTheme = createTheme({
  bg0: "#21222c",
  bg1: "#282a36",
  bg2: "#343746",
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
});

export const catppuccinMocha: KilnTheme = createTheme({
  bg0: "#1e1e2e",
  bg1: "#181825",
  bg2: "#313244",
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
});

export const nord: KilnTheme = createTheme({
  bg0: "#2e3440",
  bg1: "#3b4252",
  bg2: "#434c5e",
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
});

export const tokyoNight: KilnTheme = createTheme({
  bg0: "#1a1b26",
  bg1: "#16161e",
  bg2: "#24283b",
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
});

export const gruvboxDark: KilnTheme = createTheme({
  bg0: "#282828",
  bg1: "#32302f",
  bg2: "#3c3836",
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
});

export const rosePine: KilnTheme = createTheme({
  bg0: "#191724",
  bg1: "#1f1d2e",
  bg2: "#26233a",
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
});

export const kanagawaWave: KilnTheme = createTheme({
  bg0: "#1f1f28",
  bg1: "#16161d",
  bg2: "#2a2a37",
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
});

export const everforestDark: KilnTheme = createTheme({
  bg0: "#2b3339",
  bg1: "#323c41",
  bg2: "#3a454a",
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
});

export const ayuDark: KilnTheme = createTheme({
  bg0: "#0f1419",
  bg1: "#14191f",
  bg2: "#1b2129",
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
});

export const oneDark: KilnTheme = createTheme({
  bg0: "#1e2127",
  bg1: "#282c34",
  bg2: "#2f343f",
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
});

export const nightOwl: KilnTheme = createTheme({
  bg0: "#011627",
  bg1: "#0b1f33",
  bg2: "#12243a",
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
});

export const defaultTheme = kilnDark;

export const themes: Record<string, KilnTheme> = {
  "kiln-dark": kilnDark,
  dracula,
  "catppuccin-mocha": catppuccinMocha,
  nord,
  "tokyo-night": tokyoNight,
  "gruvbox-dark": gruvboxDark,
  "rose-pine": rosePine,
  "kanagawa-wave": kanagawaWave,
  "everforest-dark": everforestDark,
  "ayu-dark": ayuDark,
  "one-dark": oneDark,
  "night-owl": nightOwl,
};

export function getTheme(name?: string): KilnTheme {
  if (!name) return defaultTheme;
  return themes[name] ?? defaultTheme;
}

export function themeNames(): string[] {
  return Object.keys(themes);
}
export interface KilnTheme {
  // Surfaces
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  // Borders
  border: string;
  borderActive: string;
  // Text
  text: string;
  textMuted: string;
  // Semantic
  accent: string;
  primary: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  // Chat-specific
  userFg: string;
  toolFg: string;
  thinkingFg: string;
  cursorFg: string;
}

export const kilnDark: KilnTheme = {
  background: "#0f0f0f",
  backgroundPanel: "#161616",
  backgroundElement: "#1a1a1a",
  border: "#2a2a2a",
  borderActive: "#4a4a4a",
  text: "#e2e8f0",
  textMuted: "#64748b",
  accent: "#a78bfa",
  primary: "#7dd3fc",
  success: "#86efac",
  error: "#f87171",
  warning: "#fbbf24",
  info: "#94a3b8",
  userFg: "#7dd3fc",
  toolFg: "#86efac",
  thinkingFg: "#64748b",
  cursorFg: "#86efac",
};

export const defaultTheme = kilnDark;

// Dracula — https://draculatheme.com/contribute
export const dracula: KilnTheme = {
  background: "#21222c",
  backgroundPanel: "#282a36",
  backgroundElement: "#343746",
  border: "#44475a",
  borderActive: "#6272a4",
  text: "#f8f8f2",
  textMuted: "#6272a4",
  accent: "#bd93f9",
  primary: "#8be9fd",
  success: "#50fa7b",
  error: "#ff5555",
  warning: "#ffb86c",
  info: "#6272a4",
  userFg: "#8be9fd",
  toolFg: "#50fa7b",
  thinkingFg: "#6272a4",
  cursorFg: "#50fa7b",
};

// Catppuccin Mocha — https://github.com/catppuccin/catppuccin
export const catppuccinMocha: KilnTheme = {
  background: "#1e1e2e",
  backgroundPanel: "#181825",
  backgroundElement: "#313244",
  border: "#45475a",
  borderActive: "#585b70",
  text: "#cdd6f4",
  textMuted: "#6c7086",
  accent: "#cba6f7",
  primary: "#89dceb",
  success: "#a6e3a1",
  error: "#f38ba8",
  warning: "#fab387",
  info: "#7f849c",
  userFg: "#89dceb",
  toolFg: "#a6e3a1",
  thinkingFg: "#6c7086",
  cursorFg: "#a6e3a1",
};

// Nord — https://www.nordtheme.com/docs/colors-and-palettes
export const nord: KilnTheme = {
  background: "#2e3440",
  backgroundPanel: "#3b4252",
  backgroundElement: "#434c5e",
  border: "#4c566a",
  borderActive: "#81a1c1",
  text: "#eceff4",
  textMuted: "#616e88",
  accent: "#b48ead",
  primary: "#88c0d0",
  success: "#a3be8c",
  error: "#bf616a",
  warning: "#ebcb8b",
  info: "#5e81ac",
  userFg: "#88c0d0",
  toolFg: "#a3be8c",
  thinkingFg: "#616e88",
  cursorFg: "#a3be8c",
};

// Tokyo Night — https://github.com/enkia/tokyo-night-vscode-theme
export const tokyoNight: KilnTheme = {
  background: "#1a1b26",
  backgroundPanel: "#16161e",
  backgroundElement: "#24283b",
  border: "#292e42",
  borderActive: "#565f89",
  text: "#c0caf5",
  textMuted: "#565f89",
  accent: "#bb9af7",
  primary: "#7dcfff",
  success: "#9ece6a",
  error: "#f7768e",
  warning: "#e0af68",
  info: "#414868",
  userFg: "#7dcfff",
  toolFg: "#9ece6a",
  thinkingFg: "#565f89",
  cursorFg: "#9ece6a",
};

export const themes: Record<string, KilnTheme> = {
  "kiln-dark": kilnDark,
  "dracula": dracula,
  "catppuccin-mocha": catppuccinMocha,
  "nord": nord,
  "tokyo-night": tokyoNight,
};

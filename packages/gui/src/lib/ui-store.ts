import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  isDarkOperatorTheme,
  isOperatorThemeName,
  resolveOperatorThemePalette,
  type OperatorThemeName,
  type OperatorThemePalette,
} from "@kilnai/gateway-contracts";

export type KilnTheme = OperatorThemeName;

interface UiState {
  readonly theme: KilnTheme;
  setTheme: (theme: KilnTheme) => void;
}

const TOKEN_MAP: Record<keyof OperatorThemePalette, string> = {
  background: "--color-background",
  backgroundPanel: "--color-background-panel",
  backgroundElement: "--color-background-element",
  border: "--color-border",
  borderActive: "--color-border-active",
  text: "--color-text",
  textMuted: "--color-text-muted",
  accent: "--color-accent",
  primary: "--color-primary",
  success: "--color-success",
  error: "--color-error",
  warning: "--color-warning",
  info: "--color-info",
};

function resolvedDataTheme(theme: KilnTheme): "dark" | "light" {
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return isDarkOperatorTheme(theme, systemPrefersDark) ? "dark" : "light";
}

function applyTheme(theme: KilnTheme): void {
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const palette = resolveOperatorThemePalette(theme, systemPrefersDark);
  const root = document.documentElement;
  root.dataset.theme = resolvedDataTheme(theme);
  root.dataset.kilnTheme = theme;
  for (const [key, token] of Object.entries(TOKEN_MAP) as Array<[keyof OperatorThemePalette, string]>) {
    root.style.setProperty(token, palette[key]);
  }
  root.style.setProperty("--color-user-fg", "var(--color-text)");
  root.style.setProperty("--color-user-bg", "color-mix(in srgb, var(--color-primary) 12%, var(--color-background-element))");
  root.style.setProperty("--color-user-border", "var(--color-border)");
  root.style.setProperty("--color-assistant-bg", "var(--color-background-panel)");
  root.style.setProperty("--color-tool-fg", "var(--color-success)");
  root.style.setProperty("--color-thinking-fg", "var(--color-text-muted)");
  root.style.setProperty("--color-cursor-fg", "var(--color-success)");
}

// System-follow media query listener — set once, kept for the lifetime of the app.
let systemFollowCleanup: (() => void) | null = null;

function setupSystemFollow(active: boolean): void {
  if (systemFollowCleanup) {
    systemFollowCleanup();
    systemFollowCleanup = null;
  }
  if (!active) return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    applyTheme("system-follow");
  };
  mq.addEventListener("change", handler);
  systemFollowCleanup = () => mq.removeEventListener("change", handler);
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "kiln-dark" as KilnTheme,
      setTheme: (theme: KilnTheme) => {
        if (!isOperatorThemeName(theme)) return;
        set({ theme });
        setupSystemFollow(theme === "system-follow");
        applyTheme(theme);
      },
    }),
    {
      name: "kiln.gui.ui",
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const theme = isOperatorThemeName(state.theme) ? state.theme : "kiln-dark";
        setupSystemFollow(theme === "system-follow");
        applyTheme(theme);
      },
    },
  ),
);

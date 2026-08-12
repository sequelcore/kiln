import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_OPERATOR_THEME_NAME,
  isOperatorThemeName,
  type OperatorThemeName,
} from "@kilnai/gateway-contracts";
import { applyOperatorTheme } from "./operator-theme-projection.js";
import { KILN_GUI_UI_STORAGE_KEY, KILN_GUI_UI_STORAGE_VERSION } from "./ui-preferences.js";

export type KilnTheme = OperatorThemeName;

interface UiState {
  readonly theme: KilnTheme;
  setTheme: (theme: KilnTheme) => void;
}

function applyTheme(theme: KilnTheme): void {
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyOperatorTheme(theme, systemPrefersDark);
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
      theme: DEFAULT_OPERATOR_THEME_NAME,
      setTheme: (theme: KilnTheme) => {
        if (!isOperatorThemeName(theme)) return;
        set({ theme });
        setupSystemFollow(theme === "system-follow");
        applyTheme(theme);
      },
    }),
    {
      name: KILN_GUI_UI_STORAGE_KEY,
      version: KILN_GUI_UI_STORAGE_VERSION,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const theme = isOperatorThemeName(state.theme) ? state.theme : DEFAULT_OPERATOR_THEME_NAME;
        setupSystemFollow(theme === "system-follow");
        applyTheme(theme);
      },
    },
  ),
);

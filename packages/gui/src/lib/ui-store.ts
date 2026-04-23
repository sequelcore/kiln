import { create } from "zustand";
import { persist } from "zustand/middleware";

export type KilnTheme = "kiln-dark" | "kiln-light" | "system-follow";

interface UiState {
  readonly theme: KilnTheme;
  setTheme: (theme: KilnTheme) => void;
}

function resolvedDataTheme(theme: KilnTheme): "dark" | "light" {
  if (theme === "system-follow") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme === "kiln-dark" ? "dark" : "light";
}

function applyTheme(theme: KilnTheme): void {
  document.documentElement.dataset.theme = resolvedDataTheme(theme);
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
    document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
  };
  mq.addEventListener("change", handler);
  systemFollowCleanup = () => mq.removeEventListener("change", handler);
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "kiln-dark" as KilnTheme,
      setTheme: (theme: KilnTheme) => {
        set({ theme });
        setupSystemFollow(theme === "system-follow");
        applyTheme(theme);
      },
    }),
    {
      name: "kiln.gui.ui",
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        setupSystemFollow(state.theme === "system-follow");
        applyTheme(state.theme);
      },
    },
  ),
);

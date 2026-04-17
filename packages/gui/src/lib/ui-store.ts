import { create } from "zustand";

type Theme = "dark" | "light" | "system";

interface UiState {
  readonly theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: "dark",
  setTheme: (theme) => set({ theme }),
}));

import {
  type ColorScheme,
  DEFAULT_OPERATOR_APPEARANCE_PREFERENCE,
  isOperatorAppearancePreference,
  isOperatorThemeName,
  type OperatorAppearancePreference,
  type OperatorThemeName,
} from "@kilnai/operator-appearance";
import { create } from "zustand";
import { applyOperatorAppearance, applyOperatorTheme } from "./operator-theme-projection.js";
import { KILN_GUI_UI_STORAGE_KEY, KILN_GUI_UI_STORAGE_VERSION, readGuiLaunchTheme } from "./ui-preferences.js";

export type KilnTheme = OperatorThemeName;

interface UiState {
  readonly preference: OperatorAppearancePreference;
  readonly theme: KilnTheme;
  readonly scheme: ColorScheme;
  readonly sessionTheme: KilnTheme | null;
  syncAppearancePreference: (preference: OperatorAppearancePreference) => void;
  setAppearancePreference: (preference: OperatorAppearancePreference) => void;
  previewAppearance: (preference: OperatorAppearancePreference) => void;
  setTheme: (theme: KilnTheme) => void;
  clearSessionTheme: () => void;
}

let systemSchemeCleanup: (() => void) | null = null;

function observedScheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function cacheCanonicalPreference(preference: OperatorAppearancePreference): void {
  localStorage.setItem(
    KILN_GUI_UI_STORAGE_KEY,
    JSON.stringify({
      version: KILN_GUI_UI_STORAGE_VERSION,
      preference,
    }),
  );
}

function applyCanonicalPreference(preference: OperatorAppearancePreference): {
  readonly theme: KilnTheme;
  readonly scheme: ColorScheme;
} {
  const resolution = applyOperatorAppearance(preference, observedScheme());
  if (!isOperatorThemeName(resolution.themeId)) {
    throw new Error(`Resolved theme '${resolution.themeId}' is not available in the GUI catalog.`);
  }
  return { theme: resolution.themeId, scheme: resolution.scheme };
}

function setupSystemObservation(
  preference: OperatorAppearancePreference,
  apply: (selection: { readonly theme: KilnTheme; readonly scheme: ColorScheme }) => void,
): void {
  systemSchemeCleanup?.();
  systemSchemeCleanup = null;
  if (preference.mode !== "system") return;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = () => apply(applyCanonicalPreference(preference));
  media.addEventListener("change", handleChange);
  systemSchemeCleanup = () => media.removeEventListener("change", handleChange);
}

function readCachedPreference(): OperatorAppearancePreference {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KILN_GUI_UI_STORAGE_KEY) ?? "null");
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      parsed.version === KILN_GUI_UI_STORAGE_VERSION &&
      "preference" in parsed &&
      isOperatorAppearancePreference(parsed.preference)
    )
      return parsed.preference;
  } catch {
    // A malformed projection is discarded in favor of the built-in bootstrap.
  }
  return DEFAULT_OPERATOR_APPEARANCE_PREFERENCE;
}

const bootstrapPreference = readCachedPreference();
const bootstrapSessionTheme = readGuiLaunchTheme(window.location.search);
const bootstrapSelection = applyCanonicalPreference(bootstrapPreference);
if (bootstrapSessionTheme) applyOperatorTheme(bootstrapSessionTheme);
const bootstrapTheme = bootstrapSessionTheme ?? bootstrapSelection.theme;
const bootstrapScheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";

export const useUiStore = create<UiState>((set, get) => {
  const applyObserved = (selection: { readonly theme: KilnTheme; readonly scheme: ColorScheme }) => set(selection);
  if (!bootstrapSessionTheme) setupSystemObservation(bootstrapPreference, applyObserved);
  return {
    preference: bootstrapPreference,
    theme: bootstrapTheme,
    scheme: bootstrapScheme,
    sessionTheme: bootstrapSessionTheme,
    syncAppearancePreference: (preference) => {
      if (!isOperatorAppearancePreference(preference)) return;
      cacheCanonicalPreference(preference);
      const sessionTheme = get().sessionTheme;
      if (sessionTheme) {
        systemSchemeCleanup?.();
        systemSchemeCleanup = null;
        applyOperatorTheme(sessionTheme);
        set({
          preference,
          theme: sessionTheme,
          scheme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        });
        return;
      }
      const selection = applyCanonicalPreference(preference);
      set({ preference, ...selection });
      setupSystemObservation(preference, applyObserved);
    },
    setAppearancePreference: (preference) => {
      if (!isOperatorAppearancePreference(preference)) return;
      cacheCanonicalPreference(preference);
      const selection = applyCanonicalPreference(preference);
      set({ preference, ...selection, sessionTheme: null });
      setupSystemObservation(preference, applyObserved);
    },
    previewAppearance: (preference) => {
      if (!isOperatorAppearancePreference(preference)) return;
      systemSchemeCleanup?.();
      systemSchemeCleanup = null;
      set(applyCanonicalPreference(preference));
    },
    setTheme: (theme) => {
      systemSchemeCleanup?.();
      systemSchemeCleanup = null;
      applyOperatorTheme(theme);
      set({
        theme,
        scheme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        sessionTheme: theme,
      });
    },
    clearSessionTheme: () => {
      const preference = get().preference;
      const selection = applyCanonicalPreference(preference);
      set({ ...selection, sessionTheme: null });
      setupSystemObservation(preference, applyObserved);
    },
  };
});

import { useSyncExternalStore } from "react";
import { OPERATOR_THEME_APPLIED_EVENT } from "./operator-theme-projection.js";

function subscribe(listener: () => void): () => void {
  const root = document.documentElement;
  root.addEventListener(OPERATOR_THEME_APPLIED_EVENT, listener);
  return () => root.removeEventListener(OPERATOR_THEME_APPLIED_EVENT, listener);
}

function snapshot(): string {
  const root = document.documentElement;
  return [
    root.dataset.kilnTheme,
    root.dataset.theme,
    root.style.getPropertyValue("--kiln-canvas"),
  ].join(":");
}

export function useAppliedOperatorThemeSignature(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

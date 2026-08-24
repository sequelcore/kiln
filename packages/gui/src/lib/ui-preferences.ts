import { isOperatorThemeName, type OperatorThemeName } from "@kilnai/operator-appearance";

export const KILN_GUI_UI_STORAGE_KEY = "kiln.gui.appearance-cache:v2";
export const KILN_GUI_UI_STORAGE_VERSION = 2;

/** Reads the explicit, session-only GUI launch override. */
export function readGuiLaunchTheme(search: string): OperatorThemeName | null {
  const theme = new URLSearchParams(search).get("theme");
  return isOperatorThemeName(theme) ? theme : null;
}

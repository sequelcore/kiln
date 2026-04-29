import type { OperatorThemePreference } from "../application/operator-theme-preferences.js";

export function buildGuiUrl(baseUrl: string, themePreference: OperatorThemePreference): string {
  const url = new URL(baseUrl);
  url.searchParams.set("theme", themePreference);
  return url.toString();
}

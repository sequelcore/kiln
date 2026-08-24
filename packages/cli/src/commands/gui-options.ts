import type { OperatorThemePreference } from "../application/operator-theme-preferences.js";

export { parseOperatorThemePreference } from "../application/operator-theme-preferences.js";

export function buildGuiUrl(
  baseUrl: string,
  themePreference?: OperatorThemePreference,
  operatorCapability?: string,
): string {
  const url = new URL(baseUrl);
  if (themePreference) url.searchParams.set("theme", themePreference);
  if (operatorCapability) {
    url.hash = new URLSearchParams({ operatorToken: operatorCapability }).toString();
  }
  return url.toString();
}

export function buildGuiAttachUrl(connectUrl: string, themePreference?: OperatorThemePreference): string {
  const parsed = new URL(connectUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("GUI attach URL must use http:// or https://");
  }
  parsed.pathname = "/gui/";
  parsed.search = "";
  parsed.hash = "";
  if (themePreference) parsed.searchParams.set("theme", themePreference);
  return parsed.toString();
}

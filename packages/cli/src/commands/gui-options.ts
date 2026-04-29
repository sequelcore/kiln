import { readGlobalConfig, writeGlobalConfig, type KilnGlobalConfig } from "../config/global-config.js";
import { isOperatorThemeName, type OperatorThemeName } from "@kilnai/gateway-contracts";

export type GuiThemePreference = OperatorThemeName;

function parseGuiThemePreference(theme: string | undefined): GuiThemePreference | undefined {
  return isOperatorThemeName(theme) ? theme : undefined;
}

export function resolveGuiThemePreference(
  requestedTheme: string | undefined,
  globalConfig: KilnGlobalConfig | null,
): GuiThemePreference {
  return (
    parseGuiThemePreference(requestedTheme)
    ?? parseGuiThemePreference(globalConfig?.gui?.theme)
    ?? parseGuiThemePreference(globalConfig?.tui?.theme)
    ?? "kiln-dark"
  );
}

export function persistGuiThemePreference(
  theme: string,
  configOverride?: KilnGlobalConfig | null,
): void {
  const resolvedTheme = parseGuiThemePreference(theme);
  if (!resolvedTheme) {
    return;
  }
  const current = configOverride ?? readGlobalConfig() ?? {};
  writeGlobalConfig({
    ...current,
    gui: {
      ...current.gui,
      theme: resolvedTheme,
    },
  });
}

export function persistTuiThemePreference(
  theme: string,
  configOverride?: KilnGlobalConfig | null,
): void {
  const resolvedTheme = parseGuiThemePreference(theme);
  if (!resolvedTheme) {
    return;
  }
  const current = configOverride ?? readGlobalConfig() ?? {};
  writeGlobalConfig({
    ...current,
    tui: {
      ...current.tui,
      theme: resolvedTheme,
    },
  });
}

export function buildGuiUrl(baseUrl: string, themePreference: GuiThemePreference): string {
  const url = new URL(baseUrl);
  url.searchParams.set("theme", themePreference);
  return url.toString();
}

import { readGlobalConfig, writeGlobalConfig, type KilnGlobalConfig } from "../config/global-config.js";

const GUI_THEME_VALUES = ["kiln-dark", "kiln-light", "system-follow"] as const;

export type GuiThemePreference = (typeof GUI_THEME_VALUES)[number];

function parseGuiThemePreference(theme: string | undefined): GuiThemePreference | undefined {
  if (theme === "kiln-dark" || theme === "kiln-light" || theme === "system-follow") {
    return theme;
  }
  return undefined;
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

export function buildGuiUrl(baseUrl: string, themePreference: GuiThemePreference): string {
  const url = new URL(baseUrl);
  url.searchParams.set("theme", themePreference);
  return url.toString();
}

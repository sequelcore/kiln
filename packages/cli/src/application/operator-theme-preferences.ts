import { isOperatorThemeName, type OperatorThemeName, type OperatorThemeScope } from "@kilnai/gateway-contracts";
import {
  defaultGlobalConfig,
  readGlobalConfig,
  resolveGlobalUiTheme,
  writeGlobalConfig,
  type KilnGlobalConfig,
} from "../config/global-config.js";
import type { OperatorSurfaceThemeController } from "@kilnai/runtime";

export type OperatorThemePreference = OperatorThemeName;

export function parseOperatorThemePreference(theme: string | undefined): OperatorThemePreference | undefined {
  return isOperatorThemeName(theme) ? theme : undefined;
}

export function resolveGuiThemePreference(
  requestedTheme: string | undefined,
  globalConfig: KilnGlobalConfig | null,
): OperatorThemePreference {
  return (
    parseOperatorThemePreference(requestedTheme)
    ?? parseOperatorThemePreference(resolveGlobalUiTheme(globalConfig))
    ?? "kiln-dark"
  );
}

export function persistGuiThemePreference(
  theme: string,
  configOverride?: KilnGlobalConfig | null,
): void {
  persistOperatorThemePreference(theme, configOverride);
}

export function persistTuiThemePreference(
  theme: string,
  configOverride?: KilnGlobalConfig | null,
): void {
  persistOperatorThemePreference(theme, configOverride);
}

export function persistOperatorThemePreference(
  theme: string,
  configOverride?: KilnGlobalConfig | null,
): void {
  const resolvedTheme = parseOperatorThemePreference(theme);
  if (!resolvedTheme) {
    return;
  }
  const current = configOverride ?? readGlobalConfig() ?? defaultGlobalConfig();
  writeGlobalConfig({
    ...current,
    ui: {
      ...current.ui,
      theme: resolvedTheme,
    },
  });
}

export function createCliOperatorThemeController(): OperatorSurfaceThemeController {
  return {
    async setTheme(input: {
      readonly theme: string;
      readonly scope: OperatorThemeScope;
      readonly reason?: string;
    }): Promise<{ readonly ok: boolean; readonly appliedTheme?: string; readonly error?: string }> {
      const resolvedTheme = parseOperatorThemePreference(input.theme);
      if (!resolvedTheme) {
        return { ok: false, error: `Unknown operator theme '${input.theme}'.` };
      }
      if (input.scope !== "persisted") {
        return {
          ok: false,
          error: "The CLI has no live visual theme surface. Use scope='persisted' to update GUI and TUI defaults.",
        };
      }
      persistOperatorThemePreference(resolvedTheme);
      return { ok: true, appliedTheme: resolvedTheme };
    },
  };
}

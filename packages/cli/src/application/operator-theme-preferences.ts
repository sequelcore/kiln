import type { ColorScheme } from "@kilnai/operator-appearance";
import {
  isOperatorThemeName,
  OPERATOR_THEME_DEFINITIONS,
  type OperatorThemeName,
  resolveOperatorAppearance,
} from "@kilnai/operator-appearance";
import type { OperatorSurfaceThemeController } from "@kilnai/runtime";
import type { KilnGlobalUiAppearance } from "../config/global-config.js";

export type OperatorThemePreference = OperatorThemeName;

export function parseOperatorThemePreference(theme: string | undefined): OperatorThemePreference | undefined {
  return isOperatorThemeName(theme) ? theme : undefined;
}

export function resolveTuiThemePreference(
  requestedTheme: string | undefined,
  appearance: KilnGlobalUiAppearance | null,
): OperatorThemePreference {
  const override = parseOperatorThemePreference(requestedTheme);
  if (override) return override;
  if (!appearance) return "tesota";
  const resolved = resolveOperatorAppearance(appearance, OPERATOR_THEME_DEFINITIONS, null).themeId;
  return isOperatorThemeName(resolved) ? resolved : "tesota";
}

export function resolveTuiThemeScheme(
  requestedTheme: string | undefined,
  appearance: KilnGlobalUiAppearance | null,
): ColorScheme | undefined {
  if (parseOperatorThemePreference(requestedTheme)) return undefined;
  if (!appearance) return "dark";
  return resolveOperatorAppearance(appearance, OPERATOR_THEME_DEFINITIONS, null).scheme;
}

export function createCliOperatorThemeController(_projectPath: string = process.cwd()): OperatorSurfaceThemeController {
  return {
    async setTheme(input: {
      readonly theme: string;
      readonly reason?: string;
    }): Promise<{ readonly ok: boolean; readonly appliedTheme?: string; readonly error?: string }> {
      const resolvedTheme = parseOperatorThemePreference(input.theme);
      if (!resolvedTheme) {
        return { ok: false, error: `Unknown operator theme '${input.theme}'.` };
      }
      return {
        ok: false,
        error:
          "The CLI has no live visual theme surface. Change the durable preference through Settings or kiln config.",
      };
    },
  };
}

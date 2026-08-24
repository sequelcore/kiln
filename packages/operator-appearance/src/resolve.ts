import { FIXED_FALLBACK_OPERATOR_THEME_IDS, OPERATOR_THEME_DEFINITIONS_BY_ID } from "./catalog.js";
import type {
  ColorScheme,
  OperatorAppearancePreference,
  OperatorAppearanceResolution,
  OperatorThemeDefinition,
  OperatorThemePalette,
} from "./types.js";
import { validateOperatorAppearancePreference, validateOperatorThemeDefinition } from "./validation.js";

function assertObservedScheme(value: ColorScheme | null): void {
  if (value !== null && value !== "light" && value !== "dark") {
    throw new TypeError("Observed color scheme must be light, dark, or null.");
  }
}

function validateThemeCatalog(themes: readonly OperatorThemeDefinition[]): readonly OperatorThemeDefinition[] {
  if (!Array.isArray(themes)) {
    throw new TypeError("Operator theme catalog must be an array.");
  }
  const validated: OperatorThemeDefinition[] = [];
  const ids = new Set<string>();
  for (const theme of themes) {
    const definition = validateOperatorThemeDefinition(theme);
    if (ids.has(definition.id)) {
      throw new TypeError(`Operator theme catalog contains duplicate id ${definition.id}.`);
    }
    ids.add(definition.id);
    validated.push(definition);
  }
  return validated;
}

function paletteForScheme(
  theme: OperatorThemeDefinition | undefined,
  scheme: ColorScheme,
): OperatorThemePalette | undefined {
  return theme?.variants[scheme];
}

function fallbackResolution(
  status: "system-observation-unavailable" | "selected-theme-unavailable",
  scheme: ColorScheme,
  requestedThemeId: string | null,
): OperatorAppearanceResolution {
  const fallbackThemeId = FIXED_FALLBACK_OPERATOR_THEME_IDS[scheme];
  const fallbackTheme = OPERATOR_THEME_DEFINITIONS_BY_ID[fallbackThemeId];
  const fallbackPalette = paletteForScheme(fallbackTheme, scheme);
  if (fallbackPalette === undefined) {
    throw new Error(`Built-in fallback ${fallbackThemeId} does not provide a ${scheme} variant.`);
  }

  if (status === "system-observation-unavailable") {
    return {
      status,
      scheme: "dark",
      themeId: fallbackTheme.id,
      requestedThemeId: null,
      fallbackThemeId: "phosphor",
      fallback: true,
      theme: fallbackTheme,
      palette: fallbackPalette,
    };
  }
  if (requestedThemeId === null) {
    throw new Error("A selected-theme-unavailable resolution requires a requested theme id.");
  }
  return {
    status,
    scheme,
    themeId: fallbackTheme.id,
    requestedThemeId,
    fallbackThemeId,
    fallback: true,
    theme: fallbackTheme,
    palette: fallbackPalette,
  };
}

/**
 * Resolves an appearance preference without reading environment, DOM, config,
 * or lifecycle state. The built-in Automata/Phosphor pair is the fixed
 * deterministic fallback for unavailable selections.
 */
export function resolveOperatorAppearance(
  preference: OperatorAppearancePreference,
  themes: readonly OperatorThemeDefinition[],
  observedScheme: ColorScheme | null = null,
): OperatorAppearanceResolution {
  const validatedPreference = validateOperatorAppearancePreference(preference);
  const validatedThemes = validateThemeCatalog(themes);
  assertObservedScheme(observedScheme);

  const themesById = new Map(validatedThemes.map((theme) => [theme.id, theme]));
  if (validatedPreference.mode === "system" && observedScheme === null) {
    return fallbackResolution("system-observation-unavailable", "dark", null);
  }

  const scheme: ColorScheme =
    validatedPreference.mode === "system"
      ? observedScheme === null
        ? "dark"
        : observedScheme
      : validatedPreference.mode;
  const requestedThemeId = validatedPreference.themeByScheme[scheme];
  const selectedTheme = themesById.get(requestedThemeId);
  const selectedPalette = paletteForScheme(selectedTheme, scheme);
  if (selectedTheme !== undefined && selectedPalette !== undefined) {
    return {
      status: "resolved",
      scheme,
      themeId: selectedTheme.id,
      requestedThemeId,
      fallbackThemeId: null,
      fallback: false,
      theme: selectedTheme,
      palette: selectedPalette,
    };
  }
  return fallbackResolution("selected-theme-unavailable", scheme, requestedThemeId);
}

/** Alias that names the preference-resolution operation explicitly. */
export function resolveOperatorAppearancePreference(
  preference: OperatorAppearancePreference,
  themes: readonly OperatorThemeDefinition[],
  observedScheme: ColorScheme | null = null,
): OperatorAppearanceResolution {
  return resolveOperatorAppearance(preference, themes, observedScheme);
}

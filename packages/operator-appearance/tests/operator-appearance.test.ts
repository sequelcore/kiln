import { describe, expect, it } from "vitest";
import {
  AUTOMATA_OPERATOR_THEME,
  assertOperatorThemeDefinition,
  DEFAULT_OPERATOR_APPEARANCE_PREFERENCE,
  FIXED_FALLBACK_OPERATOR_THEME_IDS,
  isOperatorThemeDefinition,
  isSemanticAdjacencyContrastValid,
  OPERATOR_SEMANTIC_CONTRAST_ADJACENCIES,
  OPERATOR_THEME_DEFINITIONS,
  OPERATOR_THEME_NAMES,
  OPERATOR_THEME_PALETTES,
  type OperatorColor,
  type OperatorThemePalette,
  operatorColorToCss,
  operatorColorToHex,
  PHOSPHOR_OPERATOR_THEME,
  parseOperatorAppearancePreference,
  resolveOperatorAppearance,
  SEQUEL_OPERATOR_THEME,
  VESPER_OPERATOR_THEME,
  validateSemanticAdjacencyContrast,
} from "../src/index.js";

function collectColors(value: unknown): OperatorColor[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (
    typeof Reflect.get(record, "lightness") === "number" &&
    typeof Reflect.get(record, "chroma") === "number" &&
    typeof Reflect.get(record, "hue") === "number"
  ) {
    return [record as unknown as OperatorColor];
  }
  return Object.values(record).flatMap(collectColors);
}

describe("operator appearance public policy", () => {
  it("publishes the curated definitions and fixed polarity fallbacks", () => {
    expect(OPERATOR_THEME_NAMES).toEqual(["automata", "phosphor", "sequel", "vesper"]);
    expect(OPERATOR_THEME_DEFINITIONS.map((theme) => theme.id)).toEqual(["automata", "phosphor", "sequel", "vesper"]);
    expect(AUTOMATA_OPERATOR_THEME.variants.light?.appearance).toBe("light");
    expect(PHOSPHOR_OPERATOR_THEME.variants.dark?.appearance).toBe("dark");
    expect(SEQUEL_OPERATOR_THEME.variants.dark?.appearance).toBe("dark");
    expect(VESPER_OPERATOR_THEME.variants.dark?.appearance).toBe("dark");
    expect(FIXED_FALLBACK_OPERATOR_THEME_IDS).toEqual({ light: "automata", dark: "phosphor" });
    expect(DEFAULT_OPERATOR_APPEARANCE_PREFERENCE).toEqual({
      mode: "system",
      themeByScheme: { light: "automata", dark: "phosphor" },
    });
  });

  it("retains the canonical palette roles and color conversions", () => {
    const phosphor = OPERATOR_THEME_PALETTES.phosphor;
    expect(operatorColorToHex(phosphor.surface.canvas)).toBe("#060b06");
    expect(operatorColorToHex(phosphor.surface.overlay)).toBe("#100a0e");
    expect(operatorColorToHex(phosphor.control.accent)).toBe("#3dff7c");
    expect(operatorColorToHex(phosphor.conversation.message.surface)).toBe("#0e1d11");
    expect(operatorColorToHex(phosphor.sidebar.control)).toBe("#261922");
    expect(operatorColorToHex(phosphor.toolbar.control)).toBe("#362d3d");
    expect(operatorColorToHex(phosphor.terminal.cursor)).toBe("#3dff7c");
    expect(operatorColorToHex(phosphor.status.update.surface)).toBe("#37152b");
    expect(operatorColorToCss(phosphor.control.accent)).toMatch(/^oklch\(/);

    const sequel = OPERATOR_THEME_PALETTES.sequel;
    expect(operatorColorToHex(sequel.surface.canvas)).toBe("#080808");
    expect(operatorColorToHex(sequel.text.default)).toBe("#f4f1e9");
    expect(operatorColorToHex(sequel.control.accent)).toBe("#b3a58e");
    expect(operatorColorToHex(sequel.surface.overlay)).toBe("#2a2723");

    for (const palette of Object.values(OPERATOR_THEME_PALETTES)) {
      for (const color of collectColors(palette)) {
        expect(() => operatorColorToHex(color)).not.toThrow();
      }
    }
  });

  it("validates every semantic adjacency in the curated palettes", () => {
    expect(OPERATOR_SEMANTIC_CONTRAST_ADJACENCIES.length).toBeGreaterThan(0);
    for (const palette of Object.values(OPERATOR_THEME_PALETTES)) {
      const validation = validateSemanticAdjacencyContrast(palette);
      expect(validation.valid).toBe(true);
      expect(validation.violations).toEqual([]);
      expect(isSemanticAdjacencyContrastValid(palette)).toBe(true);
    }

    const lightPalette = AUTOMATA_OPERATOR_THEME.variants.light;
    if (lightPalette === undefined) throw new Error("Automata must provide a light palette.");
    const invalidContrastPalette: OperatorThemePalette = {
      ...lightPalette,
      text: { ...lightPalette.text, default: lightPalette.surface.default },
    };
    const invalidContrast = validateSemanticAdjacencyContrast(invalidContrastPalette);
    expect(invalidContrast.valid).toBe(false);
    expect(invalidContrast.violations.map((violation) => violation.id)).toContain("text.default-on-surface.default");

    const invalidCodeContrastPalette: OperatorThemePalette = {
      ...lightPalette,
      conversation: {
        ...lightPalette.conversation,
        code: {
          ...lightPalette.conversation.code,
          foreground: lightPalette.conversation.code.background,
        },
      },
    };
    const invalidCodeContrast = validateSemanticAdjacencyContrast(invalidCodeContrastPalette);
    expect(invalidCodeContrast.violations.map((violation) => violation.id)).toContain(
      "conversation.code.foreground-on-conversation.code.background",
    );
  });

  it("resolves explicit and observed system schemes", () => {
    const light = resolveOperatorAppearance(
      { mode: "light", themeByScheme: { light: "automata", dark: "phosphor" } },
      OPERATOR_THEME_DEFINITIONS,
      "dark",
    );
    expect(light).toMatchObject({ status: "resolved", scheme: "light", themeId: "automata", fallback: false });

    const dark = resolveOperatorAppearance(
      { mode: "dark", themeByScheme: { light: "automata", dark: "vesper" } },
      OPERATOR_THEME_DEFINITIONS,
      "light",
    );
    expect(dark).toMatchObject({ status: "resolved", scheme: "dark", themeId: "vesper", fallback: false });

    const observed = resolveOperatorAppearance(
      { mode: "system", themeByScheme: { light: "automata", dark: "phosphor" } },
      OPERATOR_THEME_DEFINITIONS,
      "light",
    );
    expect(observed).toMatchObject({ status: "resolved", scheme: "light", themeId: "automata", fallback: false });
  });

  it("returns a deterministic dark fallback when system observation is unavailable", () => {
    const result = resolveOperatorAppearance(DEFAULT_OPERATOR_APPEARANCE_PREFERENCE, OPERATOR_THEME_DEFINITIONS, null);
    expect(result).toMatchObject({
      status: "system-observation-unavailable",
      scheme: "dark",
      themeId: "phosphor",
      fallbackThemeId: "phosphor",
      fallback: true,
    });
  });

  it("uses the fixed polarity fallback when a selected theme or variant is unavailable", () => {
    const missingId = resolveOperatorAppearance(
      { mode: "light", themeByScheme: { light: "missing", dark: "phosphor" } },
      OPERATOR_THEME_DEFINITIONS,
      null,
    );
    expect(missingId).toMatchObject({
      status: "selected-theme-unavailable",
      scheme: "light",
      requestedThemeId: "missing",
      themeId: "automata",
      fallbackThemeId: "automata",
    });

    const missingVariant = resolveOperatorAppearance(
      { mode: "light", themeByScheme: { light: "vesper", dark: "phosphor" } },
      OPERATOR_THEME_DEFINITIONS,
      null,
    );
    expect(missingVariant).toMatchObject({
      status: "selected-theme-unavailable",
      scheme: "light",
      requestedThemeId: "vesper",
      themeId: "automata",
      fallbackThemeId: "automata",
    });
  });

  it("rejects unsupported definition shapes and invalid OKLCH values at the boundary", () => {
    expect(isOperatorThemeDefinition(AUTOMATA_OPERATOR_THEME)).toBe(true);
    expect(
      isOperatorThemeDefinition({
        schemaVersion: 1,
        id: "empty",
        label: "Empty",
        variants: {},
      }),
    ).toBe(false);
    expect(() =>
      assertOperatorThemeDefinition({
        schemaVersion: 1,
        id: "empty",
        label: "Empty",
        variants: {},
      }),
    ).toThrow(/at least one/i);
    expect(() =>
      assertOperatorThemeDefinition({
        ...AUTOMATA_OPERATOR_THEME,
        unsupported: true,
      }),
    ).toThrow(/unsupported shape/i);

    const lightPalette = AUTOMATA_OPERATOR_THEME.variants.light;
    if (lightPalette === undefined) throw new Error("Automata must provide a light palette.");
    const invalidPalette: OperatorThemePalette = {
      ...lightPalette,
      surface: {
        ...lightPalette.surface,
        canvas: { lightness: Number.NaN, chroma: 0, hue: 0 },
      },
    };
    expect(() =>
      assertOperatorThemeDefinition({
        ...AUTOMATA_OPERATOR_THEME,
        variants: { light: invalidPalette },
      }),
    ).toThrow(/finite OKLCH/i);
  });

  it("parses a preference as a supported public value", () => {
    expect(
      parseOperatorAppearancePreference({
        mode: "system",
        themeByScheme: { light: "automata", dark: "phosphor" },
      }),
    ).toEqual({
      mode: "system",
      themeByScheme: { light: "automata", dark: "phosphor" },
    });
  });
});

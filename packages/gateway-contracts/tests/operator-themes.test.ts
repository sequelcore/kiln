import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPERATOR_THEME_NAME,
  OPERATOR_THEME_NAMES,
  OPERATOR_THEME_PALETTES,
  isDarkOperatorTheme,
  isOperatorThemeName,
  operatorColorToCss,
  operatorColorToHex,
  resolveOperatorThemePalette,
  type OperatorColor,
} from "../src/operator-themes.js";

function relativeLuminance(color: OperatorColor): number {
  const channels = operatorColorToHex(color)
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * channels[0]!) + (0.7152 * channels[1]!) + (0.0722 * channels[2]!);
}

function contrastRatio(foreground: OperatorColor, background: OperatorColor): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function collectColors(value: unknown): OperatorColor[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (typeof record.lightness === "number" && typeof record.chroma === "number" && typeof record.hue === "number") {
    return [record as unknown as OperatorColor];
  }
  return Object.values(record).flatMap(collectColors);
}

describe("operator themes", () => {
  it("validates the curated Kiln operator theme names", () => {
    expect(isOperatorThemeName("phosphor")).toBe(true);
    expect(isOperatorThemeName("vesper")).toBe(true);
    expect(isOperatorThemeName("automata")).toBe(true);
    expect(isOperatorThemeName("obsolete-theme")).toBe(false);
    expect(isOperatorThemeName("dracula")).toBe(false);
    expect(isOperatorThemeName("unknown")).toBe(false);
    expect(OPERATOR_THEME_NAMES).toEqual([
      "phosphor",
      "vesper",
      "automata",
      "system-follow",
    ]);
    expect(DEFAULT_OPERATOR_THEME_NAME).toBe("phosphor");
  });

  it("resolves system-follow to the current system polarity", () => {
    expect(isDarkOperatorTheme("system-follow", true)).toBe(true);
    expect(isDarkOperatorTheme("system-follow", false)).toBe(false);
    expect(resolveOperatorThemePalette("system-follow", true)).toEqual(resolveOperatorThemePalette("phosphor"));
    expect(resolveOperatorThemePalette("system-follow", false)).toEqual(resolveOperatorThemePalette("automata"));
  });

  it("owns the complete cross-surface Phosphor palette", () => {
    const phosphor = resolveOperatorThemePalette("phosphor");

    expect(operatorColorToHex(phosphor.surface.canvas)).toBe("#060b06");
    expect(operatorColorToHex(phosphor.surface.overlay)).toBe("#100a0e");
    expect(operatorColorToHex(phosphor.control.accent)).toBe("#3dff7c");
    expect(operatorColorToHex(phosphor.conversation.message.surface)).toBe("#0e1d11");
    expect(operatorColorToHex(phosphor.sidebar.control)).toBe("#261922");
    expect(operatorColorToHex(phosphor.toolbar.control)).toBe("#362d3d");
    expect(operatorColorToHex(phosphor.terminal.cursor)).toBe("#3dff7c");
    expect(operatorColorToHex(phosphor.status.update.surface)).toBe("#37152b");
    expect(operatorColorToCss(phosphor.control.accent)).toMatch(/^oklch\(/);
  });

  it("keeps every cross-surface color inside the sRGB gamut", () => {
    for (const palette of Object.values(OPERATOR_THEME_PALETTES)) {
      for (const paletteColor of collectColors(palette)) {
        expect(() => operatorColorToHex(paletteColor)).not.toThrow();
      }
    }
  });

  it("defines distinct semantic roles instead of overloading base colors", () => {
    for (const palette of Object.values(OPERATOR_THEME_PALETTES)) {
      expect(Object.keys(palette.sidebar)).toEqual([
        "background",
        "foreground",
        "mutedForeground",
        "control",
        "hover",
        "active",
        "selected",
        "border",
      ]);
      expect(palette.toolbar.control).not.toEqual(palette.toolbar.hover);
      expect(palette.surface.input).not.toEqual(palette.control.focus);
      expect(palette.conversation.message.action).not.toEqual(palette.conversation.message.surface);
      expect(palette.status.success.surface).not.toEqual(palette.status.success.foreground);
    }
  });

  it("keeps each curated expression perceptually distinct", () => {
    const phosphor = OPERATOR_THEME_PALETTES.phosphor;
    const vesper = OPERATOR_THEME_PALETTES.vesper;
    const automata = OPERATOR_THEME_PALETTES.automata;

    expect(phosphor.appearance).toBe("dark");
    expect(vesper.appearance).toBe("dark");
    expect(automata.appearance).toBe("light");
    expect(operatorColorToHex(phosphor.surface.canvas)).not.toBe(operatorColorToHex(vesper.surface.canvas));
    expect(operatorColorToHex(automata.surface.canvas)).toBe("#ccc8b1");
  });

  it("meets text, control, action, and status contrast invariants", () => {
    for (const [name, palette] of Object.entries(OPERATOR_THEME_PALETTES)) {
      expect(contrastRatio(palette.text.default, palette.surface.default), `${name} default text`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.text.muted, palette.surface.default), `${name} muted text`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.text.placeholder, palette.surface.input), `${name} placeholder`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.control.accentForeground, palette.control.accent), `${name} accent action`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.sidebar.foreground, palette.sidebar.background), `${name} sidebar text`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.toolbar.foreground, palette.toolbar.background), `${name} toolbar text`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.terminal.foreground, palette.terminal.background), `${name} terminal text`).toBeGreaterThanOrEqual(7);

      for (const [status, colors] of Object.entries(palette.status)) {
        expect(contrastRatio(colors.foreground, colors.surface), `${name} ${status} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.color, colors.surface), `${name} ${status} indicator`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

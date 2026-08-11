import { describe, expect, it } from "vitest";
import {
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
    expect(isOperatorThemeName("kiln-dark")).toBe(true);
    expect(isOperatorThemeName("kiln-graphite")).toBe(true);
    expect(isOperatorThemeName("dracula")).toBe(false);
    expect(isOperatorThemeName("unknown")).toBe(false);
    expect(OPERATOR_THEME_NAMES).toEqual([
      "kiln-dark",
      "kiln-graphite",
      "kiln-light",
      "system-follow",
    ]);
  });

  it("resolves system-follow to the current system polarity", () => {
    expect(isDarkOperatorTheme("system-follow", true)).toBe(true);
    expect(isDarkOperatorTheme("system-follow", false)).toBe(false);
    expect(resolveOperatorThemePalette("system-follow", false)).toEqual(resolveOperatorThemePalette("kiln-light"));
  });

  it("owns perceptual colors and derives renderer-specific formats", () => {
    const action = resolveOperatorThemePalette("kiln-dark").action.primary;

    expect(action).toEqual({ lightness: 0.75, chroma: 0.1, hue: 220 });
    expect(operatorColorToCss(action)).toBe("oklch(0.75 0.1 220)");
    expect(operatorColorToHex(action)).toBe("#5bbdda");
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
      expect(palette.surface.hover).not.toEqual(palette.surface.selected);
      expect(palette.border.default).not.toEqual(palette.border.control);
      expect(palette.border.control).not.toEqual(palette.border.focus);
      expect(palette.brand.accent).not.toEqual(palette.action.primary);
      expect(palette.status.success.background).not.toEqual(palette.status.success.foreground);
    }
  });

  it("keeps the two dark expressions perceptually distinct while preserving Kiln signal hues", () => {
    const obsidian = OPERATOR_THEME_PALETTES["kiln-dark"];
    const graphite = OPERATOR_THEME_PALETTES["kiln-graphite"];

    expect(obsidian.appearance).toBe("dark");
    expect(graphite.appearance).toBe("dark");
    expect(obsidian.surface.canvas.lightness).toBeLessThan(graphite.surface.canvas.lightness);
    expect(obsidian.surface.canvas.hue).toBe(250);
    expect(graphite.surface.canvas.hue).toBe(55);
    expect(obsidian.brand.accent.hue).toBe(65);
    expect(obsidian.action.primary.hue).toBe(220);
  });

  it("meets text, control, action, and status contrast invariants", () => {
    for (const [name, palette] of Object.entries(OPERATOR_THEME_PALETTES)) {
      expect(contrastRatio(palette.text.default, palette.surface.panel), `${name} default text`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.text.muted, palette.surface.panel), `${name} muted text`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.border.control, palette.surface.panel), `${name} control border`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.action.foreground, palette.action.primary), `${name} primary action`).toBeGreaterThanOrEqual(4.5);

      for (const [status, colors] of Object.entries(palette.status)) {
        expect(contrastRatio(colors.foreground, colors.background), `${name} ${status} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.border, colors.background), `${name} ${status} border`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

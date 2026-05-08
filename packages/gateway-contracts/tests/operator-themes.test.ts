import { describe, expect, it } from "vitest";
import {
  OPERATOR_THEME_NAMES,
  isDarkOperatorTheme,
  isOperatorThemeName,
  resolveOperatorThemePalette,
} from "../src/operator-themes.js";

describe("operator themes", () => {
  it("validates the curated Kiln operator theme names", () => {
    expect(isOperatorThemeName("kiln-dark")).toBe(true);
    expect(isOperatorThemeName("kiln-graphite")).toBe(true);
    expect(isOperatorThemeName("dracula")).toBe(false);
    expect(isOperatorThemeName("unknown")).toBe(false);
    expect(OPERATOR_THEME_NAMES).toContain("system-follow");
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

  it("uses Kiln Obsidian as the default dark brand palette", () => {
    expect(resolveOperatorThemePalette("kiln-dark")).toMatchObject({
      background: "#07080a",
      backgroundPanel: "#0d0f13",
      backgroundElement: "#151922",
      accent: "#f2a65a",
      primary: "#76c7e8",
    });
  });
});

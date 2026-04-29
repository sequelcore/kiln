import { describe, expect, it } from "vitest";
import {
  OPERATOR_THEME_NAMES,
  isDarkOperatorTheme,
  isOperatorThemeName,
  resolveOperatorThemePalette,
} from "../src/operator-themes.js";

describe("operator themes", () => {
  it("validates the shared GUI/TUI theme names", () => {
    expect(isOperatorThemeName("kiln-dark")).toBe(true);
    expect(isOperatorThemeName("night-owl")).toBe(true);
    expect(isOperatorThemeName("unknown")).toBe(false);
    expect(OPERATOR_THEME_NAMES).toContain("system-follow");
  });

  it("resolves system-follow to the current system polarity", () => {
    expect(isDarkOperatorTheme("system-follow", true)).toBe(true);
    expect(isDarkOperatorTheme("system-follow", false)).toBe(false);
    expect(resolveOperatorThemePalette("system-follow", false)).toEqual(resolveOperatorThemePalette("kiln-light"));
  });
});

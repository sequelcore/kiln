import { describe, expect, it } from "vitest";
import { OPERATOR_THEME_NAMES, resolveOperatorThemePalette } from "@kilnai/gateway-contracts";
import { getTheme, themeNames, themes } from "../src/theme.js";

describe("TUI themes", () => {
  it("uses the shared operator theme catalog", () => {
    expect(themeNames()).toEqual([...OPERATOR_THEME_NAMES]);
    for (const name of OPERATOR_THEME_NAMES) {
      expect(themes[name]).toBeDefined();
    }
  });

  it("adapts the shared operator theme palette without duplicating color values", () => {
    const shared = resolveOperatorThemePalette("kiln-dark");
    const tui = getTheme("kiln-dark");

    expect(tui).toMatchObject({
      background: shared.background,
      backgroundPanel: shared.backgroundPanel,
      backgroundElement: shared.backgroundElement,
      border: shared.border,
      borderActive: shared.borderActive,
      text: shared.text,
      textMuted: shared.textMuted,
      accent: shared.accent,
      primary: shared.primary,
      success: shared.success,
      error: shared.error,
      warning: shared.warning,
      info: shared.info,
      userFg: shared.text,
      userBg: shared.backgroundElement,
      userBorder: shared.border,
      assistantBg: shared.backgroundPanel,
      toolFg: shared.success,
      thinkingFg: shared.textMuted,
      cursorFg: shared.success,
    });
  });
});

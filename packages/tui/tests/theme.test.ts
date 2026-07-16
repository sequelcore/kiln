import { describe, expect, it } from "vitest";
import { OPERATOR_THEME_NAMES, operatorColorToHex, resolveOperatorThemePalette } from "@kilnai/gateway-contracts";
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
      background: operatorColorToHex(shared.surface.canvas),
      backgroundPanel: operatorColorToHex(shared.surface.panel),
      backgroundElement: operatorColorToHex(shared.surface.interactive),
      border: operatorColorToHex(shared.border.default),
      borderActive: operatorColorToHex(shared.border.focus),
      text: operatorColorToHex(shared.text.default),
      textMuted: operatorColorToHex(shared.text.muted),
      accent: operatorColorToHex(shared.brand.accent),
      primary: operatorColorToHex(shared.action.primary),
      success: operatorColorToHex(shared.status.success.foreground),
      error: operatorColorToHex(shared.status.danger.foreground),
      warning: operatorColorToHex(shared.status.warning.foreground),
      info: operatorColorToHex(shared.status.info.foreground),
      userFg: operatorColorToHex(shared.text.default),
      userBg: operatorColorToHex(shared.surface.selected),
      userBorder: operatorColorToHex(shared.border.default),
      assistantBg: operatorColorToHex(shared.surface.panel),
      toolFg: operatorColorToHex(shared.status.success.foreground),
      thinkingFg: operatorColorToHex(shared.text.muted),
      cursorFg: operatorColorToHex(shared.action.primary),
    });
  });
});

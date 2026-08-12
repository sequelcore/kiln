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
    const shared = resolveOperatorThemePalette("phosphor");
    const tui = getTheme("phosphor");

    expect(tui).toMatchObject({
      background: operatorColorToHex(shared.surface.canvas),
      backgroundPanel: operatorColorToHex(shared.surface.default),
      backgroundElement: operatorColorToHex(shared.control.secondary),
      border: operatorColorToHex(shared.surface.border),
      borderActive: operatorColorToHex(shared.control.focus),
      text: operatorColorToHex(shared.text.default),
      textMuted: operatorColorToHex(shared.text.muted),
      accent: operatorColorToHex(shared.control.accent),
      primary: operatorColorToHex(shared.conversation.message.action),
      success: operatorColorToHex(shared.status.success.foreground),
      error: operatorColorToHex(shared.status.error.foreground),
      warning: operatorColorToHex(shared.status.warning.foreground),
      info: operatorColorToHex(shared.status.info.foreground),
      userFg: operatorColorToHex(shared.conversation.message.foreground),
      userBg: operatorColorToHex(shared.conversation.message.surface),
      userBorder: operatorColorToHex(shared.surface.border),
      assistantBg: operatorColorToHex(shared.surface.default),
      toolFg: operatorColorToHex(shared.status.success.foreground),
      thinkingFg: operatorColorToHex(shared.text.muted),
      cursorFg: operatorColorToHex(shared.terminal.cursor),
    });
  });
});

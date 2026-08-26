import {
  OPERATOR_THEME_DEFINITIONS_BY_ID,
  OPERATOR_THEME_NAMES,
  operatorColorToHex,
} from "@kilnai/operator-appearance";
import { describe, expect, it } from "vitest";
import { defaultTheme, getTheme, getThemeName, getThemeScheme, themeNames, themes } from "../src/theme.js";

describe("TUI themes", () => {
  it("uses the shared operator theme catalog", () => {
    expect(themeNames()).toEqual([...OPERATOR_THEME_NAMES]);
    for (const name of OPERATOR_THEME_NAMES) {
      expect(themes[name]).toBeDefined();
    }
  });

  it("uses dark Tesota as the deterministic terminal default and exposes its light variant", () => {
    const tesota = OPERATOR_THEME_DEFINITIONS_BY_ID.tesota;
    expect(defaultTheme.background).toBe(operatorColorToHex(tesota.variants.dark!.surface.canvas));
    const light = getTheme("tesota", "light");
    expect(light.background).toBe(operatorColorToHex(tesota.variants.light!.surface.canvas));
    expect(getThemeName(light)).toBe("tesota");
    expect(getThemeScheme(light)).toBe("light");
    expect(getThemeScheme(defaultTheme)).toBe("dark");
  });

  it("adapts the shared operator theme palette without duplicating color values", () => {
    const shared = OPERATOR_THEME_DEFINITIONS_BY_ID.phosphor.variants.dark;
    if (!shared) throw new Error("Phosphor test palette unavailable.");
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
      codeBg: operatorColorToHex(shared.conversation.code.background),
      codeFg: operatorColorToHex(shared.conversation.code.foreground),
    });
  });
});

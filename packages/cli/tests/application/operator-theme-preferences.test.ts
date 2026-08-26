import { describe, expect, it } from "vitest";
import {
  createCliOperatorThemeController,
  parseOperatorThemePreference,
  resolveTuiThemePreference,
  resolveTuiThemeScheme,
} from "../../src/application/operator-theme-preferences.js";

describe("operator theme preferences", () => {
  it("uses Tesota when no durable appearance is available", () => {
    expect(resolveTuiThemePreference(undefined, null)).toBe("tesota");
    expect(resolveTuiThemeScheme(undefined, null)).toBe("dark");
  });
  it("admits only explicit built-in launch overrides", () => {
    expect(parseOperatorThemePreference("vesper")).toBe("vesper");
    expect(parseOperatorThemePreference("sequel")).toBe("sequel");
    expect(parseOperatorThemePreference(undefined)).toBeUndefined();
    expect(parseOperatorThemePreference("invalid-theme")).toBeUndefined();
  });

  it("ignores an invalid TUI override and preserves canonical appearance", () => {
    const appearance = {
      mode: "dark" as const,
      themeByScheme: { light: "automata", dark: "vesper" },
    };

    expect(resolveTuiThemePreference("invalid-theme", appearance)).toBe("vesper");
    expect(resolveTuiThemePreference("phosphor", appearance)).toBe("phosphor");
    expect(resolveTuiThemeScheme("invalid-theme", { ...appearance, mode: "light" })).toBe("light");
    expect(resolveTuiThemeScheme("phosphor", appearance)).toBeUndefined();
  });

  it("keeps the model-callable CLI theme controller session-only", async () => {
    const controller = createCliOperatorThemeController();

    await expect(controller.setTheme({ theme: "vesper" })).resolves.toEqual({
      ok: false,
      error: "The CLI has no live visual theme surface. Change the durable preference through Settings or kiln config.",
    });
  });
});

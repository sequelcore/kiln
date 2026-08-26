import { OPERATOR_THEME_DEFINITIONS_BY_ID } from "@kilnai/operator-appearance";
import { describe, expect, it, vi } from "vitest";
import {
  applyOperatorAppearance,
  applyOperatorTheme,
  OPERATOR_THEME_APPLIED_EVENT,
  projectOperatorThemeCssVariables,
  projectOperatorThemeHexVariables,
  resolveAppliedOperatorThemePalette,
} from "../src/lib/operator-theme-projection.js";

const phosphor = OPERATOR_THEME_DEFINITIONS_BY_ID.phosphor.variants.dark;
if (!phosphor) throw new Error("Phosphor test palette unavailable.");

describe("operator theme projection", () => {
  it("projects the semantic contract to deterministic CSS variables", () => {
    const variables = projectOperatorThemeCssVariables(phosphor);

    expect(variables).toMatchObject({
      "--kiln-canvas": expect.stringMatching(/^oklch\(/),
      "--kiln-surface-overlay": expect.stringMatching(/^oklch\(/),
      "--kiln-message-surface": expect.stringMatching(/^oklch\(/),
      "--kiln-code-background": expect.stringMatching(/^oklch\(/),
      "--kiln-code-foreground": expect.stringMatching(/^oklch\(/),
      "--kiln-sidebar-control": expect.stringMatching(/^oklch\(/),
      "--kiln-toolbar-control": expect.stringMatching(/^oklch\(/),
      "--kiln-terminal-cursor": expect.stringMatching(/^oklch\(/),
      "--kiln-terminal-background": expect.stringMatching(/^oklch\(/),
      "--kiln-terminal-foreground": expect.stringMatching(/^oklch\(/),
      "--kiln-status-update-surface": expect.stringMatching(/^oklch\(/),
    });
    expect(Object.keys(variables)).toHaveLength(63);
    expect(Object.values(variables).some((value) => value.startsWith("#"))).toBe(false);
  });

  it("applies Vesper before render without collapsing it to generic dark", () => {
    applyOperatorTheme("vesper", document.documentElement);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-kiln-theme", "vesper");
    expect(document.documentElement.style.getPropertyValue("--kiln-canvas")).not.toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("preserves the visible polarity when a session selects dual-variant Tesota", () => {
    document.documentElement.dataset.theme = "light";
    applyOperatorTheme("tesota", document.documentElement);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    document.documentElement.dataset.theme = "dark";
    applyOperatorTheme("tesota", document.documentElement);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("projects renderer-safe colors from the same semantic source", () => {
    applyOperatorTheme("vesper", document.documentElement);
    const palette = resolveAppliedOperatorThemePalette(document.documentElement);
    const variables = projectOperatorThemeHexVariables(palette);

    expect(variables["--kiln-canvas"]).toMatch(/^#[\da-f]{6}$/);
    expect(variables["--kiln-accent"]).toMatch(/^#[\da-f]{6}$/);
    expect(variables["--kiln-canvas"]).not.toBe(projectOperatorThemeHexVariables(phosphor)["--kiln-canvas"]);
  });

  it("resolves system mode against the observed system polarity", () => {
    const listener = vi.fn();
    document.documentElement.addEventListener(OPERATOR_THEME_APPLIED_EVENT, listener);
    applyOperatorAppearance(
      { mode: "system", themeByScheme: { light: "automata", dark: "phosphor" } },
      "light",
      document.documentElement,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement).toHaveAttribute("data-kiln-theme", "automata");
    expect(document.documentElement.style.getPropertyValue("--kiln-canvas")).not.toBe("");
    expect(listener).toHaveBeenCalledOnce();
    document.documentElement.removeEventListener(OPERATOR_THEME_APPLIED_EVENT, listener);
  });
});

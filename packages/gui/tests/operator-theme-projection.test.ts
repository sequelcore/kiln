import { describe, expect, it, vi } from "vitest";
import {
  applyOperatorTheme,
  OPERATOR_THEME_APPLIED_EVENT,
  projectOperatorThemeCssVariables,
  projectOperatorThemeHexVariables,
  resolveAppliedOperatorThemePalette,
} from "../src/lib/operator-theme-projection.js";
import { resolveOperatorThemePalette } from "@kilnai/gateway-contracts";

describe("operator theme projection", () => {
  it("projects the semantic contract to deterministic CSS variables", () => {
    const variables = projectOperatorThemeCssVariables(resolveOperatorThemePalette("kiln-dark"));

    expect(variables).toMatchObject({
      "--color-background": "oklch(0.135 0.008 250)",
      "--color-background-panel": "oklch(0.17 0.01 250)",
      "--color-surface-selected": "oklch(0.245 0.035 220)",
      "--color-border-control": "oklch(0.49 0.018 250)",
      "--color-primary": "oklch(0.75 0.1 220)",
      "--status-danger-background": "oklch(0.22 0.04 25)",
    });
    expect(Object.values(variables).some((value) => value.startsWith("#"))).toBe(false);
  });

  it("applies Graphite before render without collapsing it to generic dark", () => {
    applyOperatorTheme("kiln-graphite", true, document.documentElement);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-kiln-theme", "kiln-graphite");
    expect(document.documentElement.style.getPropertyValue("--color-background")).toBe("oklch(0.18 0.008 55)");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("projects renderer-safe colors from the same semantic source", () => {
    applyOperatorTheme("kiln-graphite", true, document.documentElement);
    const palette = resolveAppliedOperatorThemePalette(document.documentElement, true);
    const variables = projectOperatorThemeHexVariables(palette);

    expect(variables["--color-background"]).toMatch(/^#[\da-f]{6}$/);
    expect(variables["--color-primary"]).toMatch(/^#[\da-f]{6}$/);
    expect(variables["--color-background"]).not.toBe(
      projectOperatorThemeHexVariables(resolveOperatorThemePalette("kiln-dark"))["--color-background"],
    );
  });

  it("resolves system-follow against the observed system polarity", () => {
    const listener = vi.fn();
    document.documentElement.addEventListener(OPERATOR_THEME_APPLIED_EVENT, listener);
    applyOperatorTheme("system-follow", false, document.documentElement);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement).toHaveAttribute("data-kiln-theme", "system-follow");
    expect(document.documentElement.style.getPropertyValue("--color-background")).toBe("oklch(0.965 0.006 240)");
    expect(listener).toHaveBeenCalledOnce();
    document.documentElement.removeEventListener(OPERATOR_THEME_APPLIED_EVENT, listener);
  });
});

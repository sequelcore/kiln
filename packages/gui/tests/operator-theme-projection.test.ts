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
    const variables = projectOperatorThemeCssVariables(resolveOperatorThemePalette("phosphor"));

    expect(variables).toMatchObject({
      "--kiln-canvas": expect.stringMatching(/^oklch\(/),
      "--kiln-surface-overlay": expect.stringMatching(/^oklch\(/),
      "--kiln-message-surface": expect.stringMatching(/^oklch\(/),
      "--kiln-sidebar-control": expect.stringMatching(/^oklch\(/),
      "--kiln-toolbar-control": expect.stringMatching(/^oklch\(/),
      "--kiln-terminal-cursor": expect.stringMatching(/^oklch\(/),
      "--kiln-status-update-surface": expect.stringMatching(/^oklch\(/),
    });
    expect(Object.keys(variables)).toHaveLength(63);
    expect(Object.values(variables).some((value) => value.startsWith("#"))).toBe(false);
  });

  it("applies Vesper before render without collapsing it to generic dark", () => {
    applyOperatorTheme("vesper", true, document.documentElement);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-kiln-theme", "vesper");
    expect(document.documentElement.style.getPropertyValue("--kiln-canvas")).not.toBe("");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("projects renderer-safe colors from the same semantic source", () => {
    applyOperatorTheme("vesper", true, document.documentElement);
    const palette = resolveAppliedOperatorThemePalette(document.documentElement, true);
    const variables = projectOperatorThemeHexVariables(palette);

    expect(variables["--kiln-canvas"]).toMatch(/^#[\da-f]{6}$/);
    expect(variables["--kiln-accent"]).toMatch(/^#[\da-f]{6}$/);
    expect(variables["--kiln-canvas"]).not.toBe(
      projectOperatorThemeHexVariables(resolveOperatorThemePalette("phosphor"))["--kiln-canvas"],
    );
  });

  it("resolves system-follow against the observed system polarity", () => {
    const listener = vi.fn();
    document.documentElement.addEventListener(OPERATOR_THEME_APPLIED_EVENT, listener);
    applyOperatorTheme("system-follow", false, document.documentElement);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement).toHaveAttribute("data-kiln-theme", "system-follow");
    expect(document.documentElement.style.getPropertyValue("--kiln-canvas")).not.toBe("");
    expect(listener).toHaveBeenCalledOnce();
    document.documentElement.removeEventListener(OPERATOR_THEME_APPLIED_EVENT, listener);
  });
});

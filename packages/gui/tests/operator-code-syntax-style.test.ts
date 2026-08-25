import { OPERATOR_THEME_PALETTES, operatorContrastRatio } from "@kilnai/operator-appearance";
import { describe, expect, it } from "vitest";
import {
  OPERATOR_CODE_SYNTAX_STYLE,
  OPERATOR_WORKSPACE_CODE_SYNTAX_STYLE,
} from "../src/lib/operator-code-syntax-style.js";

describe("operator code syntax style", () => {
  it("maps Highlight.js scopes only to semantic theme variables", () => {
    expect(OPERATOR_CODE_SYNTAX_STYLE.hljs).toMatchObject({
      color: "var(--color-code-foreground)",
      background: "var(--color-code-background)",
    });

    const styles = [OPERATOR_CODE_SYNTAX_STYLE, OPERATOR_WORKSPACE_CODE_SYNTAX_STYLE];
    for (const style of styles.flatMap((syntaxStyle) => Object.values(syntaxStyle))) {
      if (typeof style.color === "string") {
        expect(style.color).toMatch(/^var\(--color-[a-z-]+\)$/);
      }
      if (typeof style.background === "string") {
        expect(style.background === "transparent" || /^var\(--color-[a-z-]+\)$/u.test(style.background)).toBe(true);
      }
    }
  });

  it("keeps every syntax and structured-data foreground readable on each code material", () => {
    for (const palette of Object.values(OPERATOR_THEME_PALETTES)) {
      const foregrounds = [
        palette.conversation.code.foreground,
        palette.text.muted,
        palette.conversation.message.action,
        palette.control.accent,
        palette.status.error.foreground,
        palette.status.success.foreground,
        palette.status.info.foreground,
        palette.status.update.foreground,
      ];

      for (const foreground of foregrounds) {
        expect(operatorContrastRatio(foreground, palette.conversation.code.background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

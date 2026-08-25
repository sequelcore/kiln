import type { ThemeTokenStyle } from "@opentui/core";
import type { KilnTheme } from "./theme.js";

/** Maps OpenTUI's Markdown code scopes to the canonical operator code material. */
export function createTuiMarkdownSyntaxTheme(theme: KilnTheme): ThemeTokenStyle[] {
  return [
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: {
        foreground: theme.codeFg,
        background: theme.codeBg,
      },
    },
  ];
}

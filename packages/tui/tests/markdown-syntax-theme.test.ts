import { describe, expect, it } from "vitest";
import { createTuiMarkdownSyntaxTheme } from "../src/markdown-syntax-theme.js";
import { getTheme } from "../src/theme.js";

describe("TUI Markdown syntax theme", () => {
  it("maps inline and fenced code scopes to the shared code material", () => {
    const theme = getTheme("automata");

    expect(createTuiMarkdownSyntaxTheme(theme)).toEqual([
      {
        scope: ["markup.raw", "markup.raw.block"],
        style: {
          foreground: theme.codeFg,
          background: theme.codeBg,
        },
      },
    ]);
  });
});

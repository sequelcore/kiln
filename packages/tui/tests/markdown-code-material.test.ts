import { describe, expect, it, vi } from "vitest";

vi.mock("@opentui/core", () => ({
  CodeRenderable: class {
    fg = "";
    bg = "";
  },
}));

import { CodeRenderable } from "@opentui/core";
import {
  applyTuiMarkdownCodeMaterial,
  createTuiMarkdownNodeRenderer,
} from "../src/markdown-code-material.js";

describe("TUI Markdown code material", () => {
  const theme = { codeBg: "#111111", codeFg: "#eeeeee" };

  it("applies the canonical material when a fenced block is created", () => {
    const codeBlock = new CodeRenderable({} as never, {} as never);
    const renderNode = createTuiMarkdownNodeRenderer(() => theme);

    const rendered = renderNode(
      { type: "code" } as never,
      { defaultRender: () => codeBlock } as never,
    );

    expect(rendered).toBe(codeBlock);
    expect(codeBlock.fg).toBe(theme.codeFg);
    expect(codeBlock.bg).toBe(theme.codeBg);
  });

  it("restores the material after OpenTUI resets a reused streaming block", () => {
    const proseBlock = new CodeRenderable({} as never, {} as never);
    proseBlock.fg = "parent-foreground" as never;
    proseBlock.bg = "transparent" as never;
    const codeBlock = new CodeRenderable({} as never, {} as never);
    codeBlock.fg = "parent-foreground" as never;
    codeBlock.bg = "transparent" as never;
    const markdown = {
      _blockStates: [
        { token: { type: "paragraph" }, renderable: proseBlock },
        { token: { type: "code" }, renderable: codeBlock },
      ],
    };

    applyTuiMarkdownCodeMaterial(markdown as never, theme);

    expect(codeBlock.fg).toBe(theme.codeFg);
    expect(codeBlock.bg).toBe(theme.codeBg);
    expect(proseBlock.fg).toBe("parent-foreground");
    expect(proseBlock.bg).toBe("transparent");
  });
});

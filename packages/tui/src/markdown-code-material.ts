import {
  CodeRenderable,
  type MarkdownOptions,
  type MarkdownRenderable,
} from "@opentui/core";
import type { KilnTheme } from "./theme.js";

type CodeMaterial = Pick<KilnTheme, "codeBg" | "codeFg">;
type MarkdownNodeRenderer = NonNullable<MarkdownOptions["renderNode"]>;

function applyCodeMaterial(node: CodeRenderable, theme: CodeMaterial): void {
  node.fg = theme.codeFg;
  node.bg = theme.codeBg;
}

/** Applies the canonical code material when OpenTUI creates a fenced code block. */
export function createTuiMarkdownNodeRenderer(getTheme: () => CodeMaterial): MarkdownNodeRenderer {
  return (token, context) => {
    if (token.type !== "code") return undefined;

    const node = context.defaultRender();
    if (node instanceof CodeRenderable) {
      applyCodeMaterial(node, getTheme());
    }
    return node;
  };
}

/**
 * Reapplies fenced-code material after an incremental Markdown update.
 *
 * OpenTUI 0.1.x reuses CodeRenderable instances while streaming and resets their
 * foreground/background to the parent Markdown material. `_blockStates` is its
 * typed block traversal surface; keeping this dependency quirk here prevents it
 * from leaking into event handlers or theme projection.
 */
export function applyTuiMarkdownCodeMaterial(markdown: MarkdownRenderable, theme: CodeMaterial): void {
  for (const { token, renderable } of markdown._blockStates) {
    if (token.type === "code" && renderable instanceof CodeRenderable) {
      applyCodeMaterial(renderable, theme);
    }
  }
}

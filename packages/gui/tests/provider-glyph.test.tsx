import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderGlyph } from "../src/components/provider-glyph.js";

describe("ProviderGlyph", () => {
  it.each([
    ["anthropic", "anthropic"],
    ["claude", "claude"],
    ["codex", "codex"],
    ["codex-oauth", "codex"],
    ["deepseek", "deepseek"],
    ["lmstudio", "lmstudio"],
    ["ollama", "ollama"],
    ["openai", "openai"],
    ["opencode", "opencode"],
    ["opencode-go", "opencode"],
    ["opencode-zen", "opencode"],
    ["openrouter", "openrouter"],
  ])("renders the official %s provider mark", (providerId, brand) => {
    const { container } = render(<ProviderGlyph providerId={providerId} />);

    const mark = container.querySelector(`[data-provider-brand="${brand}"]`);
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[data-provider-fallback="true"]')).toBeNull();
  });

  it("uses an inaccessible neutral fallback only for unknown providers", () => {
    const { container } = render(<ProviderGlyph providerId="future-provider" />);

    expect(container.querySelector('[data-provider-fallback="true"]')).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-provider-brand]")).toBeNull();
  });

  it.each(["anthropic", "codex", "codex-oauth", "lmstudio", "ollama", "openai", "opencode"])(
    "emits a valid quoted mask URL for the monochrome %s mark",
    (providerId) => {
      const { container } = render(<ProviderGlyph providerId={providerId} />);
      const brand = providerId === "codex-oauth" ? "codex" : providerId;
      const mark = container.querySelector<HTMLElement>(`[data-provider-brand="${brand}"]`);

      expect(mark?.style.maskImage).toMatch(/^url\(["']data:image\/svg\+xml/);
      expect(mark).not.toBeInstanceOf(HTMLImageElement);
    },
  );
});

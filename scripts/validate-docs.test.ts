import { describe, expect, it } from "vitest";
import { validateMarkdownDocument } from "./validate-docs.js";

describe("documentation validation", () => {
  it("accepts one semantic title, ordered headings, and valid local links", () => {
    const diagnostics = validateMarkdownDocument({
      path: "docs/guide.md",
      content: [
        "# Guide",
        "",
        "## Start here",
        "",
        "Read [Core concepts](concepts.md).",
      ].join("\n"),
      localTargetExists: (target) => target === "docs/concepts.md",
    });

    expect(diagnostics).toEqual([]);
  });

  it("ignores examples inside fenced code blocks", () => {
    const diagnostics = validateMarkdownDocument({
      path: "docs/guide.md",
      content: [
        "# Guide",
        "",
        "```markdown",
        "# Example title",
        "[missing](does-not-exist.md)",
        "bun add @kilnai/core",
        "```",
      ].join("\n"),
      localTargetExists: () => false,
    });

    expect(diagnostics).toEqual([]);
  });

  it("reports missing or repeated titles and skipped heading levels", () => {
    const missing = validateMarkdownDocument({
      path: "docs/missing.md",
      content: "## Starts too deep\n",
      localTargetExists: () => true,
    });
    expect(missing.map((diagnostic) => diagnostic.code)).toEqual([
      "heading-level-skip",
      "title-count",
    ]);

    const repeated = validateMarkdownDocument({
      path: "docs/repeated.md",
      content: "# First\n\n# Second\n",
      localTargetExists: () => true,
    });
    expect(repeated.map((diagnostic) => diagnostic.code)).toEqual(["title-count"]);
  });

  it("reports missing local targets and ambiguous link labels", () => {
    const diagnostics = validateMarkdownDocument({
      path: "docs/guide.md",
      content: "# Guide\n\n[Click here](missing.md)\n",
      localTargetExists: () => false,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "ambiguous-link-text",
      "missing-local-target",
    ]);
  });

  it("reports a missing heading anchor in an existing local document", () => {
    const diagnostics = validateMarkdownDocument({
      path: "docs/guide.md",
      content: "# Guide\n\n[Routing](concepts.md#missing-routing)\n",
      localTargetExists: () => true,
      localAnchorExists: (target, anchor) =>
        target === "docs/concepts.md" && anchor === "execution-routes",
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "missing-local-anchor",
    ]);
  });

  it("reports current installation instructions for provisional packages", () => {
    const diagnostics = validateMarkdownDocument({
      path: "docs/getting-started.md",
      content: "# Install\n\n    bun add -g @kilnai/cli\n",
      localTargetExists: () => true,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "provisional-package-install",
    );
  });

  it("allows historical package commands in release records", () => {
    const diagnostics = validateMarkdownDocument({
      path: "docs/releases/2.1.0.md",
      content: "# Historical release\n\n    bun add -g @kilnai/cli@2.1.0\n",
      localTargetExists: () => true,
    });

    expect(diagnostics).toEqual([]);
  });
});

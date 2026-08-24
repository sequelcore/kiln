import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectProjectContextEvidence,
  parseProjectContextMarkdown,
  projectContextPath,
  renderProjectContextEvidenceMarkdown,
  renderProjectContextMarkdown,
  writeProjectContextAdoption,
} from "../../src/application/project-context.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../../src/application/project-state-root.js";

let fixtureRoot: string;
let kilnHome: string;
let binding: ProjectStateBinding;

function resetFixture(): string {
  fixtureRoot = mkdtempSync(join(tmpdir(), "kiln-project-context-"));
  kilnHome = mkdtempSync(join(tmpdir(), "kiln-project-context-home-"));
  binding = resolveProjectStateBinding(fixtureRoot, { kilnHome });
  mkdirSync(join(fixtureRoot, ".git"), { recursive: true });
  writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({
    name: "context-project",
    workspaces: ["packages/*"],
    scripts: {
      test: "bun run test",
      typecheck: "bun run typecheck",
    },
  }, null, 2), "utf-8");
  writeFileSync(join(fixtureRoot, "bun.lock"), "", "utf-8");
  mkdirSync(join(fixtureRoot, "docs", "research"), { recursive: true });
  mkdirSync(join(fixtureRoot, "docs", "architecture", "core"), { recursive: true });
  writeFileSync(join(fixtureRoot, "README.md"), "# Context Project", "utf-8");
  writeFileSync(join(fixtureRoot, "docs", "research", "README.md"), "# Research", "utf-8");
  writeFileSync(
    join(fixtureRoot, "docs", "architecture", "core", "engineering-standards.md"),
    "# Engineering Standards",
    "utf-8",
  );
  return fixtureRoot;
}

function contextPath(root: string): string {
  return projectContextPath(root, { projectStateBinding: binding });
}

function writeContext(root: string, options: { readonly force?: boolean } = {}) {
  return writeProjectContextAdoption(root, { ...options, projectStateBinding: binding });
}

afterEach(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  if (kilnHome) rmSync(kilnHome, { recursive: true, force: true });
});

describe("project-context", () => {
  it("collects deterministic repo evidence", () => {
    const root = resetFixture();

    const evidence = collectProjectContextEvidence(root);

    expect(evidence.projectName).toBe("context-project");
    expect(evidence.packageManager).toBe("bun");
    expect(evidence.scripts).toEqual([
      ["test", "bun run test"],
      ["typecheck", "bun run typecheck"],
    ]);
    expect(evidence.workspacePackages).toEqual(["packages/*"]);
    expect(evidence.docs).toEqual([
      "README.md",
      "docs/architecture/core/engineering-standards.md",
      "docs/research/README.md",
    ]);
  });

  it("renders reviewed context without persisting derived repository facts", () => {
    resetFixture();
    const markdown = renderProjectContextMarkdown();

    expect(markdown).toContain("version: \"2\"");
    expect(markdown).toContain("source: reviewed-project-context");
    expect(markdown).toContain("# Project Context");
    expect(markdown).toContain("## Agent Review Notes");
    expect(markdown).not.toContain("bun run test");
    expect(markdown).not.toContain("workspacePackages:");
    expect(markdown).not.toContain("canonicalDocs:");
  });

  it("renders derived repository evidence for scouting without making it persisted context", () => {
    const root = resetFixture();
    const markdown = renderProjectContextEvidenceMarkdown(collectProjectContextEvidence(root));

    expect(markdown).toContain("# Repository Evidence");
    expect(markdown).toContain("- `test`: `bun run test`");
    expect(markdown).toContain("- Workspace: packages/*");
  });

  it("parses only reviewed notes from canonical version 2 context", () => {
    const parsed = parseProjectContextMarkdown([
      "---",
      'version: "2"',
      "source: reviewed-project-context",
      "---",
      "",
      "# Project Context",
      "",
      "Repository facts are derived.",
      "",
      "## Agent Review Notes",
      "",
      "Preserve this durable boundary note.",
      "",
    ].join("\n"));

    expect(parsed.reviewNotes).toBe("Preserve this durable boundary note.");
  });

  it("rejects legacy context that duplicated deterministic repository facts", () => {
    expect(() => parseProjectContextMarkdown([
      "---",
      'version: "1"',
      "source: deterministic-repo-scout",
      "scripts:",
      "  test: bun run stale-test",
      "---",
      "",
      "# Project Context",
    ].join("\n"))).toThrow(/version 2 reviewed-project-context/u);
  });

  it("writes project context and blocks drift without force", () => {
    const root = resetFixture();
    const first = writeContext(root);
    writeFileSync(contextPath(root), "# Manual edit", "utf-8");
    const second = writeContext(root);

    expect(first.status).toBe("written");
    expect(second.status).toBe("blocked");
    expect(second.errors[0]).toContain("existing project context differs");
    expect(readFileSync(contextPath(root), "utf-8")).toBe("# Manual edit");
  });

  it("backs up existing project context when force is explicit", () => {
    const root = resetFixture();
    mkdirSync(binding.projectStateRoot, { recursive: true });
    writeFileSync(contextPath(root), "# Manual edit", "utf-8");

    const result = writeContext(root, { force: true });

    expect(result.status).toBe("written");
    expect(readFileSync(contextPath(root), "utf-8")).toContain("# Project Context");
    expect(existsSync(join(binding.backupsPath, "project-context"))).toBe(true);
  });

  it("preserves reviewed notes when canonical context is regenerated", () => {
    const root = resetFixture();
    mkdirSync(binding.projectStateRoot, { recursive: true });
    writeFileSync(contextPath(root), renderProjectContextMarkdown({
      reviewNotes: "### Durable boundary\n\nKeep this reviewed knowledge.",
    }), "utf-8");

    const result = writeContext(root, { force: true });

    expect(result.status).toBe("unchanged");
    expect(readFileSync(contextPath(root), "utf-8")).toContain("Keep this reviewed knowledge.");
  });
});

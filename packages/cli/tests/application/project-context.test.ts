import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectProjectContextEvidence,
  projectContextPath,
  renderProjectContextMarkdown,
  writeProjectContextAdoption,
} from "../../src/application/project-context.js";

const FIXTURE_ROOT = join(process.cwd(), ".kiln", "tmp", "project-context-test");

function resetFixture(): string {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, "package.json"), JSON.stringify({
    name: "context-project",
    workspaces: ["packages/*"],
    scripts: {
      test: "bun run test",
      typecheck: "bun run typecheck",
    },
  }, null, 2), "utf-8");
  writeFileSync(join(FIXTURE_ROOT, "bun.lock"), "", "utf-8");
  mkdirSync(join(FIXTURE_ROOT, "docs", "research"), { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, "README.md"), "# Context Project", "utf-8");
  writeFileSync(join(FIXTURE_ROOT, "docs", "research", "README.md"), "# Research", "utf-8");
  return FIXTURE_ROOT;
}

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
    expect(evidence.docs).toEqual(["README.md", "docs/research/README.md"]);
  });

  it("renders canonical markdown with schema frontmatter", () => {
    const root = resetFixture();
    const markdown = renderProjectContextMarkdown(collectProjectContextEvidence(root));

    expect(markdown).toContain("version: \"1\"");
    expect(markdown).toContain("source: deterministic-repo-scout");
    expect(markdown).toContain("# Project Context");
    expect(markdown).toContain("- `test`: `bun run test`");
    expect(markdown).toContain("## Agent Review Notes");
  });

  it("writes project context and blocks drift without force", () => {
    const root = resetFixture();
    const first = writeProjectContextAdoption(root);
    writeFileSync(projectContextPath(root), "# Manual edit", "utf-8");
    const second = writeProjectContextAdoption(root);

    expect(first.status).toBe("written");
    expect(second.status).toBe("blocked");
    expect(second.errors[0]).toContain("existing project context differs");
    expect(readFileSync(projectContextPath(root), "utf-8")).toBe("# Manual edit");
  });

  it("backs up existing project context when force is explicit", () => {
    const root = resetFixture();
    mkdirSync(join(root, ".kiln"), { recursive: true });
    writeFileSync(projectContextPath(root), "# Manual edit", "utf-8");

    const result = writeProjectContextAdoption(root, { force: true });

    expect(result.status).toBe("written");
    expect(readFileSync(projectContextPath(root), "utf-8")).toContain("# Project Context");
    expect(existsSync(join(root, ".kiln", "backups", "project-context"))).toBe(true);
  });
});

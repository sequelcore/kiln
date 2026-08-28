import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readProjectInstructionStatuses } from "../../src/application/project-instruction-status.js";

let fixtureRoot = "";
let projectPath = "";

function resetProjectFixture(): void {
  fixtureRoot = mkdtempSync(join(tmpdir(), "kiln-project-instruction-status-"));
  projectPath = join(fixtureRoot, "project");
  mkdirSync(join(projectPath, ".git"), { recursive: true });
  writeFileSync(join(projectPath, "package.json"), JSON.stringify({ name: "sample-project" }), "utf-8");
}

describe("project-instruction-status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectFixture();
  });

  it("reads missing and project-owned entrypoints without writing repository or private-state files", async () => {
    writeFileSync(join(projectPath, "CLAUDE.md"), "# Project-owned guidance\n", "utf-8");
    const before = readFileSync(join(projectPath, "CLAUDE.md"), "utf-8");

    const statuses = await readProjectInstructionStatuses(projectPath);

    expect(statuses).toEqual([
      { target: "agents", path: join(projectPath, "AGENTS.md"), status: "missing" },
      { target: "claude", path: join(projectPath, "CLAUDE.md"), status: "project-owned" },
    ]);
    expect(readFileSync(join(projectPath, "CLAUDE.md"), "utf-8")).toBe(before);
    expect(existsSync(join(projectPath, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(projectPath, ".kiln"))).toBe(false);
  });

  it("preserves the other target when one project instruction target is non-regular", async () => {
    mkdirSync(join(projectPath, "AGENTS.md"));
    expect(await readProjectInstructionStatuses(projectPath)).toEqual([
      {
        target: "agents",
        path: join(projectPath, "AGENTS.md"),
        status: "unreadable",
        details: expect.stringMatching(/regular file/iu),
      },
      { target: "claude", path: join(projectPath, "CLAUDE.md"), status: "missing" },
    ]);
  });

  it("does not read through a project instruction symlink", async () => {
    const outside = join(fixtureRoot, "outside-agents.md");
    writeFileSync(outside, "# External\n", "utf-8");
    try {
      symlinkSync(outside, join(projectPath, "AGENTS.md"), "file");
    } catch {
      return;
    }

    expect(await readProjectInstructionStatuses(projectPath)).toEqual([
      {
        target: "agents",
        path: join(projectPath, "AGENTS.md"),
        status: "unreadable",
        details: expect.stringMatching(/regular file/iu),
      },
      { target: "claude", path: join(projectPath, "CLAUDE.md"), status: "missing" },
    ]);
    expect(readFileSync(outside, "utf-8")).toContain("# External");
  });
});

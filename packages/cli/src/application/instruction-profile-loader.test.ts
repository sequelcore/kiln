import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findInstructionProfile,
  loadInstructionProfiles,
} from "./instruction-profile-loader.js";
import { resolveInstructionProfileContextCandidates } from "./instruction-profile-context.js";

let root: string;

function profile(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

function writeProfile(base: string, name: string, content: string): void {
  const dir = join(base, ".kiln", "instructions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), content, "utf-8");
}

describe("instruction profile loader", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kiln-instructions-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads global and project profiles with project overrides", () => {
    const userHome = join(root, "home");
    const projectPath = join(root, "project");
    writeProfile(userHome, "sequel", profile(
      [
        "name: sequel-engineering",
        "displayName: Sequel Engineering",
        "description: Global engineering doctrine",
        "tags:",
        "  - engineering",
        "doctrine:",
        "  principles:",
        "    - No dead code.",
        "    - No redundancy.",
        "  workflow:",
        "    - Scout before broad changes.",
        "  qualityGates:",
        "    - Verify before claiming complete.",
        "  reviewPosture:",
        "    - Findings before summaries.",
        "  delegation:",
        "    - Delegate architecture-sensitive work to specialist profiles.",
      ].join("\n"),
      "\nNo dead code.\n",
    ));
    writeProfile(projectPath, "sequel", profile(
      [
        "name: sequel-engineering",
        "description: Project override",
      ].join("\n"),
      "\nDDD first.\n",
    ));

    const loaded = loadInstructionProfiles(projectPath, userHome);

    expect(loaded).toHaveLength(1);
    expect(findInstructionProfile(loaded, "SEQUEL-ENGINEERING")).toMatchObject({
      name: "sequel-engineering",
      description: "Project override",
      instructions: "DDD first.",
      scope: "project",
    });
  });

  it("resolves selected profiles as required governed instruction context with structured doctrine", () => {
    const userHome = join(root, "home");
    const projectPath = join(root, "project");
    writeProfile(userHome, "sequel", profile(
      [
        "name: sequel-engineering",
        "doctrine:",
        "  principles:",
        "    - No dead code.",
        "  workflow:",
        "    - Use TDD for behavior changes.",
        "  qualityGates:",
        "    - Run focused tests before broad gates.",
      ].join("\n"),
      "\nTDD before implementation.\n",
    ));

    const candidates = resolveInstructionProfileContextCandidates({
      projectPath,
      userHome,
      globalConfig: {
        version: "1",
        activeInstructionProfiles: ["sequel-engineering"],
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.kind).toBe("instruction");
    expect(candidates[0]?.required).toBe(true);
    expect(candidates[0]?.source).toContain("sequel.md");
    expect(candidates[0]?.content).toContain("Instruction Profile\nname: sequel-engineering");
    expect(candidates[0]?.content).toContain("doctrine:\nprinciples:\n- No dead code.");
    expect(candidates[0]?.content).toContain("workflow:\n- Use TDD for behavior changes.");
    expect(candidates[0]?.content).toContain("qualityGates:\n- Run focused tests before broad gates.");
    expect(String(candidates[0]?.content)).toContain("TDD before implementation.");
  });

  it("fails closed when selected profiles are unavailable", () => {
    expect(() => resolveInstructionProfileContextCandidates({
      projectPath: join(root, "project"),
      userHome: join(root, "home"),
      globalConfig: {
        version: "1",
        activeInstructionProfiles: ["missing"],
      },
    })).toThrow("Configured session references unavailable instruction profile(s): missing");
  });
});

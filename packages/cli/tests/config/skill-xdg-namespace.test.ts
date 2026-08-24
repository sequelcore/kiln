import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveKilnHomePath } from "../../src/config/global-config/path.js";
import { resolveGlobalNativeProjectionStateDir } from "../../src/config/native-projection-state.js";
import { discoverSkillDirs } from "../../src/config/native-skill-projection.js";
import { readSkillCatalogStatus } from "../../src/config/skill-catalog-status.js";
import { createConfiguredSkillRegistry } from "../../src/config/skill-registry.js";
import { loadAgentDefinitions } from "../../src/application/agent-loader.js";
import { loadInstructionProfiles } from "../../src/application/instruction-profile-loader.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

let fixtureRoot: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = undefined;
});

function writeSkill(root: string, name: string): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: XDG skill\n---\n\nInstructions.\n`, "utf8");
  return path;
}

function writeProfile(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "sequel.md"), [
    "---",
    "name: sequel-engineering",
    "description: XDG profile",
    "---",
    "",
    "Instructions.",
    "",
  ].join("\n"), "utf8");
}

function writeAgent(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "scout.md"), [
    "---",
    "name: scout",
    "role: scout",
    "goal: inspect the repository",
    "tier: fast",
    "---",
    "",
    "Instructions.",
    "",
  ].join("\n"), "utf8");
}

describe("canonical XDG Kiln namespace for skills and projections", () => {
  it("uses one XDG namespace for global catalogs, project state, and projection state", async () => {
    fixtureRoot = mkdtempSync(join(process.env.TEMP ?? process.env.TMP ?? ".", "kiln-skill-xdg-"));
    const xdgConfigHome = join(fixtureRoot, "xdg-config");
    const projectPath = join(fixtureRoot, "project");
    vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);
    mkdirSync(projectPath, { recursive: true });

    const kilnHome = join(xdgConfigHome, "kiln");
    const globalSkillsPath = join(kilnHome, "skills");
    const globalInstructionsPath = join(kilnHome, "instructions");
    const globalAgentsPath = join(kilnHome, "agents");
    const globalSkillPath = writeSkill(globalSkillsPath, "xdg-skill");
    writeProfile(globalInstructionsPath);
    writeAgent(globalAgentsPath);

    const binding = resolveProjectStateBinding(projectPath);
    expect(resolveKilnHomePath()).toBe(kilnHome);
    expect(binding.projectStateRoot).toContain(join(kilnHome, "projects"));
    expect(resolveGlobalNativeProjectionStateDir()).toBe(join(kilnHome, "runtime", "native-projections"));
    expect(binding.projectStateRoot).not.toContain(join(homedir(), ".kiln"));

    const registry = createConfiguredSkillRegistry({
      projectPath,
      projectStateBinding: binding,
      skillConfig: { builtin: { enabled: false } },
    });
    expect(registry.get("xdg-skill")?.filePath).toBe(globalSkillPath);
    expect(registry.get("xdg-skill")?.filePath).not.toContain(join(homedir(), ".kiln"));

    const discovered = discoverSkillDirs(projectPath, undefined, binding.skillsPath);
    expect(discovered.get("xdg-skill")).toBe(join(globalSkillsPath, "xdg-skill"));

    const profiles = loadInstructionProfiles(projectPath, undefined, { projectStateBinding: binding });
    expect(profiles.map((profile) => profile.name)).toContain("sequel-engineering");
    await expect(loadAgentDefinitions(projectPath)).resolves.toEqual([
      expect.objectContaining({ name: "scout", scope: "global" }),
    ]);

    const catalog = readSkillCatalogStatus({
      projectPath,
      projectStateBinding: binding,
      skillConfig: { builtin: { enabled: false } },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });
    expect(catalog.entries).toContainEqual(expect.objectContaining({
      name: "xdg-skill",
      sourcePath: globalSkillPath,
      origin: "user",
    }));
  });
});

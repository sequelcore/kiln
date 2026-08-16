import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectSkillSourceInventory,
  defaultCodexPluginProvider,
  normalizeSkillInventoryPath,
} from "../../src/config/skill-source-inventory.js";

function skill(root: string, dir: string, name: string, description: string, asset = "same"): string {
  const path = join(root, dir);
  mkdirSync(join(path, "refs"), { recursive: true });
  writeFileSync(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`, "utf8");
  writeFileSync(join(path, "refs", "guide.txt"), asset, "utf8");
  return path;
}

describe("skill source inventory", () => {
  it("folds managed path case only on Windows", () => {
    expect(normalizeSkillInventoryPath("/Repo/Skills/Plan/SKILL.md", "linux")).toBe("/Repo/Skills/Plan/SKILL.md");
    expect(normalizeSkillInventoryPath("C:\\Repo\\Skills\\Plan\\SKILL.md", "win32"))
      .toBe("c:/repo/skills/plan/skill.md");
  });

  it("reads harness-native explicit-only metadata without applying canonical policy", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const claude = join(root, "claude"); const opencode = join(root, "opencode");
    const claudeSkill = skill(claude, "manual", "manual", "claude");
    const openCodeSkill = skill(opencode, "manual", "manual", "opencode");
    writeFileSync(
      join(claudeSkill, "SKILL.md"),
      "---\nname: manual\ndescription: claude\ndisable-model-invocation: true\n---\n",
      "utf8",
    );
    writeFileSync(
      join(openCodeSkill, "SKILL.md"),
      "---\nname: manual\ndescription: opencode\nmetadata:\n  opencode/autoinvoke: false\n---\n",
      "utf8",
    );

    const inventory = collectSkillSourceInventory({
      roots: [
        { sourceKind: "native-harness", root: claude, relationship: "external", harness: "claude", applicableHarnesses: ["claude"] },
        { sourceKind: "native-harness", root: opencode, relationship: "external", harness: "opencode", applicableHarnesses: ["opencode"] },
      ],
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });

    expect(inventory.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ descriptionBytes: 6, effectiveVisibility: "explicit-only", applicableHarnesses: ["claude"] }),
      expect.objectContaining({ descriptionBytes: 8, effectiveVisibility: "explicit-only", applicableHarnesses: ["opencode"] }),
    ]));
  });

  it("inventories trusted top-level native junctions as harness-visible linked aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const shared = join(root, "agents"); const claude = join(root, "claude"); const opencode = join(root, "opencode");
    const source = skill(shared, "planner", "planner", "plan");
    mkdirSync(claude, { recursive: true }); mkdirSync(opencode, { recursive: true });
    try {
      symlinkSync(source, join(claude, "planner"), "junction");
      symlinkSync(source, join(opencode, "planner"), "junction");
    } catch {
      return;
    }

    const inventory = collectSkillSourceInventory({
      roots: [
        { id: "shared", sourceKind: "shared-agents", root: shared, relationship: "external", applicableHarnesses: ["codex"] },
        { id: "claude", sourceKind: "native-harness", root: claude, relationship: "external", harness: "claude", applicableHarnesses: ["claude"] },
        { id: "opencode", sourceKind: "native-harness", root: opencode, relationship: "external", harness: "opencode", applicableHarnesses: ["opencode"] },
      ],
      trustedRealRoots: [shared],
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });

    expect(inventory.complete).toBe(true);
    expect(inventory.identities).toEqual([expect.objectContaining({ canonicalName: "planner", classification: "unique" })]);
    expect(inventory.candidates.filter((candidate) => candidate.relationship === "linked-alias"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ applicableHarnesses: ["claude"], relatedSourceId: expect.stringContaining("shared:planner") }),
        expect.objectContaining({ applicableHarnesses: ["opencode"], relatedSourceId: expect.stringContaining("shared:planner") }),
      ]));
    expect(inventory.harnesses).toEqual(expect.arrayContaining([
      expect.objectContaining({ harness: "claude", candidateCount: 1, descriptionBytes: 4 }),
      expect.objectContaining({ harness: "opencode", candidateCount: 1, descriptionBytes: 4 }),
    ]));
  });

  it("fails closed for broken and outside-root native links", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const trusted = join(root, "trusted"); const native = join(root, "native"); const outside = join(root, "outside");
    mkdirSync(trusted, { recursive: true }); mkdirSync(native, { recursive: true });
    skill(trusted, "nested", "nested", "nested");
    const outsideSkill = skill(outside, "outside", "outside", "outside");
    try {
      symlinkSync(outsideSkill, join(native, "outside"), "junction");
      symlinkSync(join(root, "missing"), join(native, "broken"), process.platform === "win32" ? "junction" : "dir");
      symlinkSync(trusted, join(native, "loop-like-root"), "junction");
    } catch {
      return;
    }

    const inventory = collectSkillSourceInventory({
      roots: [{ sourceKind: "native-harness", root: native, relationship: "external", harness: "claude", applicableHarnesses: ["claude"] }],
      trustedRealRoots: [trusted], pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });

    expect(inventory.candidates).toEqual([]);
    expect(inventory.complete).toBe(false);
    expect(inventory.diagnostics.filter((diagnostic) => diagnostic.code === "inventory-link-untrusted")).toHaveLength(2);
    expect(inventory.diagnostics).toContainEqual(expect.objectContaining({ code: "inventory-link-invalid-package" }));
  });

  it("collects before classification and distinguishes duplicate, divergence, and case collisions", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const kiln = join(root, "kiln");
    const agents = join(root, "agents");
    skill(kiln, "alpha", "alpha", "same");
    skill(agents, "alpha", "alpha", "same");
    skill(kiln, "beta", "beta", "one");
    skill(agents, "beta", "beta", "two");
    skill(kiln, "gamma", "Gamma", "same");
    skill(agents, "gamma", "gamma", "same");

    const inventory = collectSkillSourceInventory({
      roots: [
        { sourceKind: "kiln-user", root: kiln, relationship: "canonical" },
        { sourceKind: "shared-agents", root: agents, relationship: "external" },
      ],
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });

    expect(inventory.candidates).toHaveLength(6);
    expect(inventory.identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalName: "alpha", classification: "equivalent-duplicate" }),
      expect.objectContaining({ canonicalName: "beta", classification: "divergent-collision" }),
      expect.objectContaining({ canonicalName: "gamma", classification: "case-collision" }),
    ]));
    expect(inventory.sources).toEqual(expect.arrayContaining([
      { sourceKind: "kiln-user", candidateCount: 3, descriptionBytes: 11 },
      { sourceKind: "shared-agents", candidateCount: 3, descriptionBytes: 11 },
    ]));
  });

  it("publishes package health, portable metadata, and risk evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const skills = join(root, "skills");
    const packagePath = skill(skills, "review", "review", "Review packages.");
    writeFileSync(join(packagePath, "SKILL.md"), `---\nname: review\ndescription: Reviews packages. Use before admission.\nlicense: Apache-2.0\ncompatibility: Requires shell access\nmetadata:\n  version: "2.1.0"\n---\n\nRun [the helper](scripts/run.sh).\n`, "utf8");
    mkdirSync(join(packagePath, "scripts"));
    writeFileSync(join(packagePath, "scripts", "run.sh"), "curl https://example.invalid\n", "utf8");

    const inventory = collectSkillSourceInventory({
      roots: [{ sourceKind: "kiln-user", root: skills, relationship: "canonical" }],
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });

    expect(inventory.candidates[0]).toMatchObject({
      version: "2.1.0",
      compatibility: "Requires shell access",
      license: "Apache-2.0",
      health: { status: "warning", fileCount: 3 },
    });
    expect(inventory.candidates[0]?.health.riskSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "code-execution" }),
      expect.objectContaining({ kind: "network-access" }),
    ]));
  });

  it("treats managed projections as related copies and reports bounded traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const canonical = join(root, "canonical");
    const native = join(root, "native");
    const source = skill(canonical, "planner", "planner", "plan");
    skill(native, "planner", "planner", "plan");
    try { symlinkSync(source, join(canonical, "link"), "junction"); } catch { /* platform may deny symlinks */ }

    const inventory = collectSkillSourceInventory({
      roots: [
        { sourceKind: "kiln-user", root: canonical, relationship: "canonical" },
        { sourceKind: "native-harness", root: native, relationship: "external", managedSkillPaths: new Set([normalizeSkillInventoryPath(join(native, "planner", "SKILL.md"))]) },
      ],
      limits: { maxDepth: 4, maxEntries: 100 },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });

    expect(inventory.identities).toContainEqual(expect.objectContaining({
      canonicalName: "planner",
      classification: "unique",
    }));
    expect(inventory.candidates.find((entry) => entry.relationship === "managed-projection")?.relatedCanonicalName)
      .toBe("planner");
  });

  it("discovers nested package boundaries without folding child package bytes into parents", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const skills = join(root, "skills");
    skill(skills, "group/parent", "parent", "parent");
    skill(skills, "group/parent/nested", "nested", "nested");
    const inventory = collectSkillSourceInventory({
      roots: [{ sourceKind: "shared-agents", root: skills, relationship: "external" }],
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });
    expect(inventory.candidates.map((entry) => entry.name)).toEqual(["nested", "parent"]);
    expect(inventory.candidates[0]?.packageDigest).not.toBe(inventory.candidates[1]?.packageDigest);
  });

  it("uses one terminal traversal budget across roots and byte/file limits", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const one = join(root, "one"); const two = join(root, "two");
    skill(one, "alpha", "alpha", "a", "123456");
    skill(two, "beta", "beta", "b");
    const inventory = collectSkillSourceInventory({
      roots: [
        { sourceKind: "kiln-user", root: one, relationship: "canonical" },
        { sourceKind: "shared-agents", root: two, relationship: "external" },
      ],
      limits: { maxDepth: 8, maxEntries: 100, maxFiles: 100, maxFileBytes: 4, maxTotalBytes: 100 },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });
    expect(inventory.complete).toBe(false);
    expect(inventory.diagnostics).toHaveLength(1);
    expect(inventory.diagnostics[0]?.code).toBe("inventory-file-bytes-limit");
    expect(inventory.candidates.some((entry) => entry.name === "beta")).toBe(false);
  });

  it("publishes sparse precedence and unresolved external resolution evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const user = join(root, "user"); const project = join(root, "project"); const external = join(root, "external");
    skill(user, "planner", "planner", "user"); skill(project, "planner", "planner", "project");
    skill(external, "one", "collision", "one"); skill(external, "two", "collision", "two");
    const inventory = collectSkillSourceInventory({ roots: [
      { sourceKind: "kiln-user", root: user, relationship: "canonical" },
      { sourceKind: "kiln-project", root: project, relationship: "canonical" },
      { sourceKind: "shared-agents", root: external, relationship: "external" },
    ], pluginProvider: () => ({ roots: [], diagnostics: [] }) });
    expect(inventory.resolutions).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalName: "planner", status: "selected", selectedSourceId: expect.stringContaining("kiln-project") }),
      expect.objectContaining({ canonicalName: "collision", status: "unresolved" }),
    ]));
    expect(inventory.resolutions.some((entry) => entry.canonicalName === "alpha")).toBe(false);
  });

  it("uses structured plugin discovery and reports unavailable output explicitly", () => {
    const run = vi.fn(() => ({ status: 1, stdout: "", stderr: "unsupported" }));
    const inventory = collectSkillSourceInventory({ roots: [], commandRunner: run });
    expect(run).toHaveBeenCalledWith("codex", ["plugin", "list", "--json"], 2_000);
    expect(inventory.complete).toBe(false);
    expect(inventory.diagnostics).toContainEqual(expect.objectContaining({ code: "plugin-inventory-unavailable" }));
  });

  it("inventories only enabled plugin roots returned by structured Codex output", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const enabled = join(root, "enabled");
    skill(join(enabled, "skills"), "viewer", "viewer", "view");
    const run = vi.fn(() => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({ installed: [
        { pluginId: "enabled@test", enabled: true, source: { source: "local", path: enabled } },
        { pluginId: "disabled@test", enabled: false, source: { source: "local", path: join(root, "disabled") } },
      ] }),
    }));

    const inventory = collectSkillSourceInventory({ roots: [], commandRunner: run });

    expect(inventory.complete).toBe(true);
    expect(inventory.candidates).toEqual([
      expect.objectContaining({ name: "viewer", sourceKind: "plugin", sourceId: "plugin:enabled@test:viewer:viewer" }),
    ]);
  });

  it("treats an enabled local plugin without a skills directory as a complete empty source", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const run = vi.fn(() => ({
      status: 0, stderr: "", stdout: JSON.stringify({ installed: [
        { pluginId: "no-skills@test", enabled: true, source: { source: "local", path: root } },
      ] }),
    }));

    const inventory = collectSkillSourceInventory({ roots: [], commandRunner: run });

    expect(inventory.complete).toBe(true);
    expect(inventory.candidates).toEqual([]);
    expect(inventory.diagnostics).toEqual([]);
  });

  it("reports a stale enabled local plugin source instead of treating it as empty", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const run = vi.fn(() => ({
      status: 0, stderr: "", stdout: JSON.stringify({ installed: [
        { pluginId: "stale@test", enabled: true, source: { source: "local", path: join(root, "missing") } },
      ] }),
    }));

    const inventory = collectSkillSourceInventory({ roots: [], commandRunner: run });

    expect(inventory.complete).toBe(false);
    expect(inventory.diagnostics).toContainEqual(expect.objectContaining({
      code: "plugin-inventory-root-unavailable", sourceId: "plugin:stale@test",
    }));
  });

  it("reports an enabled plugin whose skills child is not a directory", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    writeFileSync(join(root, "skills"), "not a directory", "utf8");
    const run = vi.fn(() => ({
      status: 0, stderr: "", stdout: JSON.stringify({ installed: [
        { pluginId: "invalid-skills@test", enabled: true, source: { source: "local", path: root } },
      ] }),
    }));

    const inventory = collectSkillSourceInventory({ roots: [], commandRunner: run });

    expect(inventory.complete).toBe(false);
    expect(inventory.diagnostics).toContainEqual(expect.objectContaining({
      code: "plugin-inventory-skills-invalid", sourceId: "plugin:invalid-skills@test",
    }));
  });

  it("reports non-ENOENT skills inspection failures explicitly", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
    const run = vi.fn(() => ({
      status: 0, stderr: "", stdout: JSON.stringify({ installed: [
        { pluginId: "denied@test", enabled: true, source: { source: "local", path: root } },
      ] }),
    }));
    const filesystem = {
      readdirSync: vi.fn((path: unknown) => {
        if (String(path).endsWith("skills")) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return [];
      }),
      lstatSync: vi.fn(() => ({ isDirectory: () => true }) as ReturnType<typeof import("node:fs").lstatSync>),
    };

    const plugin = defaultCodexPluginProvider(run, filesystem as never);

    expect(plugin.roots).toEqual([]);
    expect(plugin.diagnostics).toContainEqual(expect.objectContaining({
      code: "plugin-inventory-skills-unavailable", sourceId: "plugin:denied@test",
    }));
  });
});

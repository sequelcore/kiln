import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readConfiguredSkillCatalogStatus, readSkillCatalogStatus } from "../../src/config/skill-catalog-status.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import {
  createNativeProjectionFileSnapshot,
  emptyNativeProjectionInstallState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "../../src/config/native-projection-state.js";

function createProjectPath(root: string): string {
  const projectPath = join(root, "project");
  mkdirSync(projectPath, { recursive: true });
  return projectPath;
}

describe("skill catalog status path safety", () => {
  it("keeps a synthetic 400-skill execution catalog deterministic and plugin-free", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-configured-skills-perf-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "operator");
    const binding = resolveProjectStateBinding(projectPath, { kilnHome: join(root, "kiln") });
    for (let index = 0; index < 400; index += 1) {
      const skillRoot = join(binding.skillsPath, `synthetic-${index.toString().padStart(3, "0")}`);
      mkdirSync(skillRoot, { recursive: true });
      writeFileSync(join(skillRoot, "SKILL.md"), [
        "---",
        `name: synthetic-${index.toString().padStart(3, "0")}`,
        "description: Portable operator-sized structural fixture.",
        "---",
        "",
      ].join("\n"), "utf8");
    }
    const pluginProvider = () => {
      throw new Error("configured execution catalog must not call plugin discovery");
    };
    const result = readConfiguredSkillCatalogStatus({
      projectPath,
      userHome,
      projectStateBinding: binding,
      skillConfig: { builtin: { enabled: false } },
      pluginProvider,
    });
    expect(result.entries).toHaveLength(400);
    expect(result.entries.map((entry) => entry.name)).toEqual(
      [...result.entries].map((entry) => entry.name).sort(),
    );
  });

  it("reports a complete current Codex fingerprint before external policy is configured", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root); const userHome = join(root, "user");
    mkdirSync(join(userHome, ".agents", "skills", "one"), { recursive: true });
    writeFileSync(join(userHome, ".agents", "skills", "one", "SKILL.md"), "---\nname: one\ndescription: one\n---\n", "utf8");
    const codex = readSkillCatalogStatus({ projectPath, userHome, skillConfig: { builtin: { enabled: false } },
      pluginProvider: () => ({ roots: [], diagnostics: [] }) }).inventory?.externalExposure?.find((entry) => entry.harness === "codex");
    expect(codex).toMatchObject({ status: "not-configured", freshness: "unknown" });
    expect(codex?.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
  it("reports shared-agent skills for Codex and OpenCode implicit catalogs", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root); const userHome = join(root, "user");
    const canonical = join(userHome, ".kiln", "skills"); const shared = join(userHome, ".agents", "skills");
    mkdirSync(join(canonical, "implicit"), { recursive: true }); mkdirSync(join(canonical, "explicit"), { recursive: true }); mkdirSync(join(shared, "shared"), { recursive: true });
    writeFileSync(join(canonical, "implicit", "SKILL.md"), "---\nname: implicit\ndescription: abc\n---\n", "utf8");
    writeFileSync(join(canonical, "explicit", "SKILL.md"), "---\nname: explicit\ndescription: excluded\n---\n", "utf8");
    writeFileSync(join(shared, "shared", "SKILL.md"), "---\nname: shared\ndescription: codex\n---\n", "utf8");
    const snapshot = readSkillCatalogStatus({ projectPath, userHome,
      skillConfig: {
        builtin: { enabled: false }, visibility: { overrides: { explicit: "explicit-only" } },
        externalCatalog: { version: 1, harnesses: { codex: { expectedFingerprint: `sha256:${"0".repeat(64)}`, keepImplicit: [] } } },
      },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });
    expect(snapshot.inventory?.harnesses).toEqual([
      expect.objectContaining({ harness: "claude", candidateCount: 1, descriptionBytes: 3 }),
      expect.objectContaining({ harness: "codex", candidateCount: 2, descriptionBytes: 8 }),
      expect.objectContaining({ harness: "opencode", candidateCount: 2, descriptionBytes: 8 }),
    ]);
    expect(snapshot.inventory?.candidates.find((candidate) => candidate.canonicalName === "explicit"))
      .toMatchObject({ relationship: "canonical", effectiveVisibility: "explicit-only" });
    expect(snapshot.inventory?.externalExposure).toEqual(expect.arrayContaining([
      expect.objectContaining({ harness: "codex", status: "stale", freshness: "stale", realizedImplicit: 0, suppressed: 0 }),
      expect.objectContaining({ harness: "claude", status: "not-configured", freshness: "unknown" }),
      expect.objectContaining({ harness: "opencode", status: "not-configured", freshness: "unknown" }),
    ]));
  });

  it("counts an implicit plugin copy even when the same canonical skill is explicit-only", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root); const userHome = join(root, "user");
    const canonical = join(userHome, ".kiln", "skills", "pdf");
    const pluginSkills = join(root, "plugin", "skills");
    mkdirSync(canonical, { recursive: true }); mkdirSync(join(pluginSkills, "pdf"), { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), "---\nname: pdf\ndescription: canonical\n---\n", "utf8");
    writeFileSync(join(pluginSkills, "pdf", "SKILL.md"), "---\nname: pdf\ndescription: plugin\n---\n", "utf8");

    const snapshot = readSkillCatalogStatus({
      projectPath, userHome,
      skillConfig: { builtin: { enabled: false }, visibility: { overrides: { pdf: "explicit-only" } } },
      pluginProvider: () => ({ roots: [{
        id: "plugin:test", sourceKind: "plugin", root: pluginSkills, relationship: "external",
        applicableHarnesses: ["codex"],
      }], diagnostics: [] }),
    });

    expect(snapshot.inventory?.candidates).toContainEqual(expect.objectContaining({
      sourceKind: "plugin", canonicalName: "pdf", effectiveVisibility: "implicit",
    }));
    expect(snapshot.inventory?.harnesses).toEqual(expect.arrayContaining([
      expect.objectContaining({ harness: "codex", candidateCount: 1, descriptionBytes: 6 }),
      expect.objectContaining({ harness: "claude", candidateCount: 0, descriptionBytes: 0 }),
    ]));
  });

  it("excludes unmanaged native skills whose harness metadata proves explicit-only visibility", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root); const userHome = join(root, "user");
    const native = join(userHome, ".codex", "skills", "manual", "agents");
    mkdirSync(native, { recursive: true });
    writeFileSync(join(dirname(native), "SKILL.md"), "---\nname: manual\ndescription: hidden\n---\n", "utf8");
    writeFileSync(join(native, "openai.yaml"), "policy:\n  allow_implicit_invocation: false\n", "utf8");

    const snapshot = readSkillCatalogStatus({
      projectPath, userHome, skillConfig: { builtin: { enabled: false } },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });

    expect(snapshot.inventory?.candidates).toContainEqual(expect.objectContaining({
      sourceKind: "native-harness", canonicalName: "manual", effectiveVisibility: "explicit-only",
    }));
    expect(snapshot.inventory?.harnesses.find((entry) => entry.harness === "codex"))
      .toMatchObject({ candidateCount: 0, descriptionBytes: 0 });
  });

  it("discovers Codex .agents ancestry from project root through cwd", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root); const cwd = join(projectPath, "packages", "app"); const userHome = join(root, "user");
    const nested = join(cwd, ".agents", "skills", "nested"); mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "SKILL.md"), "---\nname: nested\ndescription: nested\n---\n", "utf8");
    const snapshot = readSkillCatalogStatus({ projectPath, cwd, userHome, skillConfig: { builtin: { enabled: false } }, pluginProvider: () => ({ roots: [], diagnostics: [] }) });
    expect(snapshot.inventory?.candidates).toContainEqual(expect.objectContaining({ name: "nested", sourceKind: "shared-agents" }));
  });

  it("adds diagnostic external inventory without changing resolved entries", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "user");
    const canonical = join(userHome, ".kiln", "skills", "planner");
    const shared = join(userHome, ".agents", "skills", "planner");
    mkdirSync(canonical, { recursive: true });
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), "---\nname: planner\ndescription: canonical\n---\n", "utf8");
    writeFileSync(join(shared, "SKILL.md"), "---\nname: planner\ndescription: external\n---\n", "utf8");

    const snapshot = readSkillCatalogStatus({
      projectPath, userHome, skillConfig: { builtin: { enabled: false } },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.description).toBe("canonical");
    expect(snapshot.inventory?.identities).toContainEqual(expect.objectContaining({
      canonicalName: "planner", classification: "divergent-collision",
    }));
  });

  it("relates install-state-owned native copies instead of reporting independent collisions", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "user");
    const canonical = join(userHome, ".kiln", "skills", "planner");
    const native = join(userHome, ".codex", "skills", "planner");
    const content = "---\nname: planner\ndescription: canonical\n---\n";
    mkdirSync(canonical, { recursive: true });
    mkdirSync(native, { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), content, "utf8");
    writeFileSync(join(native, "SKILL.md"), content, "utf8");
    writeNativeProjectionInstallState(join(userHome, ".kiln", "runtime", "native-projections"), upsertNativeProjectionTargetState(
      emptyNativeProjectionInstallState(),
      createNativeProjectionFileSnapshot({
        targetId: "codex-skill:planner/SKILL.md",
        filePath: join(native, "SKILL.md"), content,
        harness: "codex", sourceIdentity: "user:planner/SKILL.md",
      }),
    ));

    const snapshot = readSkillCatalogStatus({
      projectPath, userHome, skillConfig: { builtin: { enabled: false } },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });

    expect(snapshot.inventory?.identities).toContainEqual(expect.objectContaining({
      canonicalName: "planner", classification: "unique",
    }));
    expect(snapshot.inventory?.candidates).toContainEqual(expect.objectContaining({
      sourceKind: "native-harness", relationship: "managed-projection", relatedCanonicalName: "planner",
    }));
  });

  it("does not relate a same-name native copy owned by another harness or source identity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root); const userHome = join(root, "user");
    const canonical = join(userHome, ".kiln", "skills", "planner");
    const native = join(userHome, ".codex", "skills", "planner");
    mkdirSync(canonical, { recursive: true }); mkdirSync(native, { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), "---\nname: planner\ndescription: canonical\n---\n", "utf8");
    writeFileSync(join(native, "SKILL.md"), "---\nname: planner\ndescription: divergent\n---\n", "utf8");
    writeNativeProjectionInstallState(join(userHome, ".kiln", "runtime", "native-projections"), upsertNativeProjectionTargetState(
      emptyNativeProjectionInstallState(),
      createNativeProjectionFileSnapshot({
        targetId: "codex-skill:planner/SKILL.md", filePath: join(native, "SKILL.md"),
        content: "other", harness: "claude", sourceIdentity: "native:planner/SKILL.md",
      }),
    ));
    const snapshot = readSkillCatalogStatus({ projectPath, userHome, skillConfig: { builtin: { enabled: false } }, pluginProvider: () => ({ roots: [], diagnostics: [] }) });
    expect(snapshot.inventory?.identities).toContainEqual(expect.objectContaining({
      canonicalName: "planner", classification: "divergent-collision",
    }));
    expect(snapshot.inventory?.candidates.find((candidate) => candidate.sourceId.startsWith("native:codex"))?.relationship).toBe("external");
  });

  it.each([
    ["wrong canonical source name", (state: Record<string, unknown>) => ({ ...state, sourceIdentity: "user:other/SKILL.md" })],
    ["mismatched internal target id", (state: Record<string, unknown>) => ({ ...state, targetId: "codex-skill:other/SKILL.md" })],
    ["document projection kind", (state: Record<string, unknown>) => ({ ...state, projectionKind: "document" })],
    ["unexpected native path", (state: Record<string, unknown>, root: string) => ({ ...state, filePath: join(root, "elsewhere", "SKILL.md") })],
  ])("does not relate native copies with %s", (_label, mutate) => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root); const userHome = join(root, "user");
    const canonical = join(userHome, ".kiln", "skills", "planner");
    const native = join(userHome, ".codex", "skills", "planner");
    const content = "---\nname: planner\ndescription: canonical\n---\n";
    mkdirSync(canonical, { recursive: true }); mkdirSync(native, { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), content, "utf8"); writeFileSync(join(native, "SKILL.md"), content, "utf8");
    const state = createNativeProjectionFileSnapshot({
      targetId: "codex-skill:planner/SKILL.md", filePath: join(native, "SKILL.md"), content,
      harness: "codex", sourceIdentity: "user:planner/SKILL.md",
    });
    writeNativeProjectionInstallState(join(userHome, ".kiln", "runtime", "native-projections"), {
      version: 1,
      targets: { "codex-skill:planner/SKILL.md": mutate(state as unknown as Record<string, unknown>, root) as never },
    });

    const snapshot = readSkillCatalogStatus({
      projectPath, userHome, skillConfig: { builtin: { enabled: false } },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    });
    expect(snapshot.inventory?.candidates.find((candidate) => candidate.sourceId.startsWith("native:codex"))?.relationship)
      .toBe("external");
  });


  it("reports explicit-only builtin visibility as unrealized before native sync", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const snapshot = readSkillCatalogStatus({
      projectPath: createProjectPath(root),
      userHome: join(root, "user"),
      skillConfig: {
        builtin: { enabled: true, include: ["tdd-workflow"] },
        visibility: { overrides: { "tdd-workflow": "explicit-only" } },
      },
    });

    expect(snapshot.entries.find((entry) => entry.name === "tdd-workflow")).toMatchObject({
      desiredVisibility: "explicit-only",
      projections: expect.arrayContaining([
        expect.objectContaining({
          target: "codex",
          effectiveVisibility: "disabled",
          visibilityCapability: "unsupported",
        }),
      ]),
    });
  });

  it("reports desired and effective visibility without claiming unsupported OpenCode semantics", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "user");
    const sourceDir = join(userHome, ".kiln", "skills", "planner");
    const codexDir = join(userHome, ".codex", "skills", "planner");
    const claudeDir = join(userHome, ".claude", "skills", "planner");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(join(codexDir, "agents"), { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: planner\ndescription: valid\n---\n", "utf8");
    writeFileSync(join(codexDir, "SKILL.md"), "---\nname: planner\ndescription: valid\n---\n", "utf8");
    writeFileSync(
      join(codexDir, "agents", "openai.yaml"),
      "policy:\n  allow_implicit_invocation: false\n",
      "utf8",
    );
    writeFileSync(
      join(claudeDir, "SKILL.md"),
      "---\nname: planner\ndescription: valid\ndisable-model-invocation: true\n---\n",
      "utf8",
    );

    const snapshot = readSkillCatalogStatus({
      projectPath,
      userHome,
      skillConfig: {
        builtin: { enabled: false },
        visibility: { overrides: { planner: "explicit-only" } },
      },
    });
    const planner = snapshot.entries.find((entry) => entry.name === "planner");

    expect(planner?.desiredVisibility).toBe("explicit-only");
    expect(planner?.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "codex", effectiveVisibility: "explicit-only", visibilityCapability: "exact" }),
      expect.objectContaining({ target: "claude", effectiveVisibility: "explicit-only", visibilityCapability: "exact" }),
      expect.objectContaining({
        target: "opencode",
        effectiveVisibility: "disabled",
        visibilityCapability: "unsupported",
        visibilityReason: expect.stringContaining("cannot prove explicit-only enforcement"),
      }),
    ]));
  });

  it("treats absent disabled projections as current policy and blocks admission", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "user");
    const sourceDir = join(userHome, ".kiln", "skills", "planner");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: planner\ndescription: valid\n---\n", "utf8");

    const snapshot = readSkillCatalogStatus({
      projectPath,
      userHome,
      skillConfig: {
        builtin: { enabled: false },
        visibility: { overrides: { planner: "disabled" } },
      },
    });
    const planner = snapshot.entries.find((entry) => entry.name === "planner");

    expect(planner).toMatchObject({
      desiredVisibility: "disabled",
      admission: { state: "blocked" },
      omissionReason: "Disabled by skills.visibility policy.",
    });
    expect(planner?.projections.every((projection) =>
      projection.status === "projected" && projection.effectiveVisibility === "disabled"
    )).toBe(true);
  });

  it("reports a disabled skill as drifted while generated managed metadata remains", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "user");
    const sourceDir = join(userHome, ".kiln", "skills", "planner");
    const metadataPath = join(userHome, ".codex", "skills", "planner", "agents", "openai.yaml");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(join(userHome, ".codex", "skills", "planner", "agents"), { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "---\nname: planner\ndescription: valid\n---\n", "utf8");
    writeFileSync(metadataPath, "policy:\n  allow_implicit_invocation: false\n", "utf8");
    const target = createNativeProjectionFileSnapshot({
      targetId: "codex-skill:planner/agents/openai.yaml",
      filePath: metadataPath,
      content: "policy:\n  allow_implicit_invocation: false\n",
      harness: "codex",
      sourceIdentity: "user:planner/agents/openai.yaml",
    });
    writeNativeProjectionInstallState(
      join(userHome, ".kiln", "runtime", "native-projections"),
      upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), target),
    );

    const snapshot = readSkillCatalogStatus({
      projectPath,
      userHome,
      skillConfig: {
        builtin: { enabled: false },
        visibility: { overrides: { planner: "disabled" } },
      },
    });

    expect(snapshot.entries.find((entry) => entry.name === "planner")?.projections)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ target: "codex", status: "drifted", effectiveVisibility: "disabled" }),
      ]));
  });

  it("does not claim disabled visibility while an unmanaged native skill remains loadable", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "user");
    const sourceDir = join(userHome, ".kiln", "skills", "planner");
    const nativeDir = join(userHome, ".codex", "skills", "planner");
    const content = "---\nname: planner\ndescription: valid\n---\n";
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), content, "utf8");
    writeFileSync(join(nativeDir, "SKILL.md"), content, "utf8");

    const snapshot = readSkillCatalogStatus({
      projectPath,
      userHome,
      skillConfig: {
        builtin: { enabled: false },
        visibility: { overrides: { planner: "disabled" } },
      },
    });

    expect(snapshot.entries.find((entry) => entry.name === "planner")?.projections)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          target: "codex",
          status: "unmanaged-native",
          effectiveVisibility: "implicit",
          visibilityCapability: "unsupported",
        }),
      ]));
  });

  it("does not admit an unsafe flat skill name", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "user");
    const projectSkills = resolveProjectStateBinding(projectPath, { kilnHome: join(userHome, ".kiln") }).skillsPath;
    mkdirSync(projectSkills, { recursive: true });
    writeFileSync(join(projectSkills, "unsafe.md"), "---\nname: ../escape\ndescription: invalid\n---\n", { encoding: "utf8", flag: "w" });

    const snapshot = readSkillCatalogStatus({
      projectPath,
      userHome,
      skillConfig: { builtin: { enabled: false } },
    });

    expect(snapshot.entries).toEqual([]);
  });

  it("reports identity mismatch as drift instead of blessing canonical bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-status-"));
    const projectPath = createProjectPath(root);
    const userHome = join(root, "user");
    const sourceDir = join(userHome, ".kiln", "skills", "planner");
    const targetPath = join(userHome, ".codex", "skills", "planner", "SKILL.md");
    const content = "---\nname: planner\ndescription: valid\n---\n";
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(join(userHome, ".codex", "skills", "planner"), { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), content, { encoding: "utf8", flag: "w" });
    writeFileSync(targetPath, content, { encoding: "utf8", flag: "w" });
    const target = createNativeProjectionFileSnapshot({
      targetId: "codex-skill:planner/SKILL.md",
      filePath: join(root, "outside", "SKILL.md"),
      content,
      harness: "codex",
      sourceIdentity: "skill:planner/SKILL.md",
    });
    writeNativeProjectionInstallState(
      join(userHome, ".kiln", "runtime", "native-projections"),
      upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), target),
    );

    const snapshot = readSkillCatalogStatus({
      projectPath,
      userHome,
      skillConfig: { builtin: { enabled: false } },
    });
    const planner = snapshot.entries.find((entry) => entry.name === "planner");

    expect(planner?.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "codex", status: "drifted" }),
    ]));
  });

});

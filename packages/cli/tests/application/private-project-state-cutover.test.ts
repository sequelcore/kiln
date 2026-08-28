import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeConfigMutation } from "../../src/application/config-mutation-operations.js";
import { applyConfigMutation, proposeConfigMutation } from "../../src/application/config-mutation-authority.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";
import { captureCanonicalReconciliationGeneration } from "../../src/application/config-reconciliation-generation.js";
import { renderProjectContextMarkdown, writeProjectContextAdoption } from "../../src/application/project-context.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { readConfigStatusSnapshot, readConfigStatusView } from "../../src/application/config-status.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function fixture(label: string): { readonly projectPath: string; readonly kilnHome: string } {
  const projectPath = mkdtempSync(join(tmpdir(), `kiln-private-${label}-`));
  const kilnHome = join(projectPath, "synthetic-kiln-home");
  fixtures.push(projectPath);
  mkdirSync(join(projectPath, ".kiln"), { recursive: true });
  writeFileSync(join(projectPath, ".kiln", "kiln.yaml"), "version: '1'\ndomain: legacy\n", "utf8");
  return { projectPath, kilnHome };
}

describe("private project-state cutover", () => {
  it("mechanically rejects repository-local state constructors and deleted compatibility paths", () => {
    const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
    const sourceRoots = [join(repositoryRoot, "packages"), join(repositoryRoot, "scripts")];
    const forbidden = [
      /(?:join|resolve)\(\s*(?:projectPath|projectRoot|repositoryRoot|rootPath|cwd)\s*,\s*["']\.kiln["']/u,
      /\$\{(?:projectPath|projectRoot|repositoryRoot|rootPath|cwd)\}[\\/]\.kiln/u,
      /["']\.kiln-worktrees["']/u,
      /function\s+readKilnYaml\s*\(/u,
      /legacyGlobalSettlementPath|Historical settlement lacks activation|Legacy config proposal/u,
    ];
    const violations = sourceRoots
      .flatMap((root) => productionTypeScriptFiles(root))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return forbidden.some((pattern) => pattern.test(source)) ? [relative(repositoryRoot, path)] : [];
      });

    expect(violations).toEqual([]);
    expect(existsSync(join(repositoryRoot, ".kiln"))).toBe(false);
  });

  it("normalizes project config and agent mutations below the private binding", () => {
    const { projectPath, kilnHome } = fixture("mutation-paths");
    const binding = resolveProjectStateBinding(projectPath, { kilnHome });
    mkdirSync(binding.projectStateRoot, { recursive: true });
    writeFileSync(binding.configPath, "version: '1'\ndomain: private\n", "utf8");
    const context = { projectPath, globalConfigPath: join(kilnHome, "config.yaml"), projectStateBinding: binding };

    const setting = normalizeConfigMutation("setting.set", context, {
      scope: "project",
      key: "domain",
      value: "canonical",
    });
    const agent = normalizeConfigMutation("agent.upsert", context, {
      name: "reviewer",
      role: "Review",
      goal: "Review changes",
      tier: "reasoning",
      tools: ["read"],
    });

    expect(setting.path).toBe(binding.configPath);
    expect(agent.path).toBe(join(binding.agentsPath, "reviewer.md"));
    expect(setting.path).not.toContain(`${projectPath}\\.kiln`);
    expect(readFileSync(join(projectPath, ".kiln", "kiln.yaml"), "utf8")).toContain("legacy");
  });

  it("writes reviewed context privately and leaves the repository marker untouched", () => {
    const { projectPath, kilnHome } = fixture("context");
    const binding = resolveProjectStateBinding(projectPath, { kilnHome });
    const legacyPath = join(projectPath, ".kiln", "project-context.md");
    writeFileSync(legacyPath, "legacy context\n", "utf8");

    const result = writeProjectContextAdoption(projectPath, { projectStateBinding: binding });

    expect(result.path).toBe(binding.contextPath);
    expect(existsSync(binding.contextPath)).toBe(true);
    expect(readFileSync(legacyPath, "utf8")).toBe("legacy context\n");
  });

  it("commits mutation records and project skill bytes only below the private root", async () => {
    const { projectPath, kilnHome } = fixture("authority");
    const binding = resolveProjectStateBinding(projectPath, { kilnHome });
    const record = proposeConfigMutation({
      projectPath,
      projectStateBinding: binding,
      operation: "skill.upsert",
      payload: {
        scope: "project",
        name: "private-skill",
        description: "Private skill",
        instructions: "Use private state.",
      },
    });
    expect(record.proposal.status).toBe("valid");
    expect(record.writes[0]?.path).toBe(join(binding.skillsPath, "private-skill", "SKILL.md"));
    new ConfigMutationStore(projectPath, { root: binding.mutationsPath }).saveProposal(record);

    const result = await applyConfigMutation({
      projectPath,
      projectStateBinding: binding,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: async () => [],
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    expect(existsSync(join(binding.skillsPath, "private-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectPath, ".kiln", "skills"))).toBe(false);
    expect(existsSync(binding.mutationsPath)).toBe(true);
  });

  it("derives reconciliation generations from private config and context", () => {
    const { projectPath, kilnHome } = fixture("generation");
    const binding = resolveProjectStateBinding(projectPath, { kilnHome });
    mkdirSync(binding.projectStateRoot, { recursive: true });
    writeFileSync(binding.configPath, "version: '1'\ndomain: first\n", "utf8");
    writeFileSync(binding.contextPath, "first\n", "utf8");
    const first = captureCanonicalReconciliationGeneration(projectPath, "workflow-snapshot", { projectStateBinding: binding });
    writeFileSync(join(projectPath, ".kiln", "kiln.yaml"), "version: '1'\ndomain: ignored\n", "utf8");
    const legacyOnly = captureCanonicalReconciliationGeneration(projectPath, "workflow-snapshot", { projectStateBinding: binding });
    expect(legacyOnly).toBe(first);
    writeFileSync(binding.contextPath, "second\n", "utf8");
    expect(captureCanonicalReconciliationGeneration(projectPath, "workflow-snapshot", { projectStateBinding: binding })).not.toBe(first);
  });

  it("projects private config, context, and configured agents as status evidence", async () => {
    const { projectPath, kilnHome } = fixture("status");
    const binding = resolveProjectStateBinding(projectPath, { kilnHome });
    mkdirSync(binding.projectStateRoot, { recursive: true });
    mkdirSync(binding.agentsPath, { recursive: true });
    writeFileSync(binding.configPath, "version: '1'\ndomain: private-status\n", "utf8");
    writeFileSync(binding.contextPath, renderProjectContextMarkdown({ reviewNotes: "Private context." }), "utf8");
    writeFileSync(join(binding.agentsPath, "reviewer.md"), [
      "---",
      "name: reviewer",
      "role: Review",
      "goal: Review changes",
      "tier: reasoning",
      "---",
      "Private agent.",
      "",
    ].join("\n"), "utf8");

    const snapshot = await readConfigStatusSnapshot({
      projectPath,
      userHome: kilnHome,
      projectStateBinding: binding,
      view: "agents",
    });
    expect(snapshot.project.kilnYaml).toEqual({ path: binding.configPath, status: "valid" });
    expect(snapshot.project.projectContext).toEqual({ path: binding.contextPath, status: "valid" });
    expect("hasKilnYaml" in snapshot.project).toBe(false);
    const agents = await readConfigStatusView(snapshot, "agents");
    expect(agents.value).toMatchObject({ agents: [expect.objectContaining({ id: "reviewer" })] });
  });
});

function productionTypeScriptFiles(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "tests") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (
        entry.isFile()
        && (path.endsWith(".ts") || path.endsWith(".tsx"))
        && !path.endsWith(".test.ts")
        && !path.endsWith(".test.tsx")
      ) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files;
}

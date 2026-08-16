import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "@kilnai/core/agents";
import { estimateTextTokens, skillConfigToContextCandidate } from "@kilnai/core/context";
import {
  evaluateProgressiveLoadingPromotion,
  type ProgressiveLoadingObservation,
} from "@kilnai/core/eval";
import { createDefaultBuiltinToolSurface } from "@kilnai/core/tools";
import { withProgressiveRuntimeToolProjection } from "../../src/config/builtin-tool-surface-config.js";
import { createConfiguredSkillRegistry } from "../../src/config/skill-registry.js";
import { resolveTaskSkillSelection } from "../../src/config/task-skill-selection.js";

const CASES = [
  { taskId: "read-architecture", skillName: "architecture-reading", requiredToolName: "read" },
  { taskId: "search-symbols", skillName: "repository-search", requiredToolName: "grep" },
  { taskId: "inspect-metadata", skillName: "metadata-inspection", requiredToolName: "stat" },
  { taskId: "query-structured-data", skillName: "structured-query", requiredToolName: "json_query" },
  { taskId: "research-source", skillName: "source-research", requiredToolName: "web_search" },
] as const;

describe("progressive loading representative benchmark", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("is non-inferior across five normal-path tasks while reducing irrelevant skill and schema tokens", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-progressive-loading-benchmark-"));
    roots.push(root);
    for (const benchmarkCase of CASES) {
      writeSkill(root, benchmarkCase.skillName, `${benchmarkCase.taskId} governed procedure. ${"detail ".repeat(80)}`);
    }
    writeSkill(root, "unselected-specialist", `Irrelevant specialist body. ${"unused ".repeat(180)}`);

    const registry = createConfiguredSkillRegistry({
      projectPath: root,
      userHome: root,
      skillConfig: { builtin: { enabled: false } },
    });
    const eagerSkillTokens = registry.all().reduce((total, index) => {
      const skill = registry.load(index.name);
      if (!skill) throw new Error(`Benchmark skill ${index.name} failed to materialize.`);
      return total + estimateTextTokens(skillConfigToContextCandidate(skill, { required: true }).content);
    }, 0);

    const eagerSurface = createDefaultBuiltinToolSurface();
    const progressiveSurface = createDefaultBuiltinToolSurface(withProgressiveRuntimeToolProjection({}, "read-only"));
    const eagerToolTokens = toolTokens(eagerSurface.toolDefinitions);
    const progressiveToolTokens = toolTokens(progressiveSurface.toolDefinitions);
    const observations: ProgressiveLoadingObservation[] = [];

    for (const benchmarkCase of CASES) {
      const selection = resolveTaskSkillSelection({
        explicitSkills: [benchmarkCase.skillName],
        projectPath: root,
        userHome: root,
        skillConfig: { builtin: { enabled: false } },
        requesterLabel: `Progressive loading benchmark ${benchmarkCase.taskId}`,
      });
      const selectedSkillTokens = selection.projectionEvidence.selectedContextTokens;
      const requiredEagerTool = eagerSurface.toolDefinitions.find((tool) => tool.name === benchmarkCase.requiredToolName);
      const requiredProgressiveTool = progressiveSurface.toolDefinitions.find((tool) => tool.name === benchmarkCase.requiredToolName);
      const taskSucceeded = selection.skillNames.includes(benchmarkCase.skillName) && requiredProgressiveTool !== undefined;
      const selectionHash = selection.projectionEvidence.selectionHash;

      observations.push({
        taskId: benchmarkCase.taskId,
        policy: "eager",
        taskSucceeded: requiredEagerTool !== undefined,
        skillInstructionTokens: eagerSkillTokens,
        irrelevantSkillTokens: eagerSkillTokens - selectedSkillTokens,
        toolSchemaTokens: eagerToolTokens,
        irrelevantToolSchemaTokens: eagerToolTokens - toolTokens(requiredEagerTool ? [requiredEagerTool] : []),
        selectionEvidenceId: hash(["eager", ...registry.all().map((skill) => skill.name)]),
        replayEvidenceId: hash(eagerSurface.toolDefinitions.map((tool) => tool.name)),
      }, {
        taskId: benchmarkCase.taskId,
        policy: "progressive",
        taskSucceeded,
        skillInstructionTokens: selectedSkillTokens,
        irrelevantSkillTokens: 0,
        toolSchemaTokens: progressiveToolTokens,
        irrelevantToolSchemaTokens:
          progressiveToolTokens - toolTokens(requiredProgressiveTool ? [requiredProgressiveTool] : []),
        selectionEvidenceId: selectionHash,
        replayEvidenceId: hash(progressiveSurface.toolDefinitions.map((tool) => tool.name)),
      });
    }

    const report = evaluateProgressiveLoadingPromotion(observations);

    expect(report).toMatchObject({
      taskCount: 5,
      eagerSuccessRate: 1,
      progressiveSuccessRate: 1,
      promotionEligible: true,
      issues: [],
    });
    expect(report.tokenDelta.totalModelFacing).toBeLessThan(0);
    expect(report.tokenDelta.irrelevantSkills).toBeLessThan(0);
    expect(report.tokenDelta.irrelevantToolSchemas).toBeLessThan(0);
  });
});

function writeSkill(root: string, name: string, instructions: string): void {
  const directory = join(root, ".kiln", "skills", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${name} benchmark skill.`,
    "---",
    "",
    `# ${name}`,
    "",
    instructions,
    "",
  ].join("\n"), "utf8");
}

function toolTokens(tools: readonly ToolDefinition[]): number {
  return tools.reduce((total, tool) => total + estimateTextTokens(JSON.stringify({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  })), 0);
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateSkillValuePromotion, type SkillValueObservation } from "../../src/eval/skill-value-promotion.js";
import { KILN_CORE_BUILTIN_SKILLS, parseSkillMd } from "../../src/skill/index.js";

interface ConceptModelingTask {
  readonly id: string;
  readonly kind: "positive" | "negative-control";
  readonly prompt: string;
  readonly routingPrompt: string;
  readonly expectedSkillSelection: boolean;
  readonly requiredSignals: readonly string[];
}

interface ConceptModelingTasks {
  readonly tasks: readonly ConceptModelingTask[];
}

interface SignalAdjudication {
  readonly id: string;
  readonly satisfied: boolean;
  readonly evidence: string;
}

interface SkillAdjudication {
  readonly taskId: string;
  readonly condition: "baseline" | "skill";
  readonly threadId: string;
  readonly signals: readonly SignalAdjudication[];
}

interface SkillAdjudications {
  readonly adjudications: readonly SkillAdjudication[];
}

interface RoutingAdjudication {
  readonly taskId: string;
  readonly threadId: string;
  readonly replayEvidenceId: string;
  readonly routingPromptDigest: string;
  readonly selectedSkill: string | null;
  readonly selectedSkills: readonly string[];
  readonly conceptModelingSelected: boolean;
  readonly expectedSelected: boolean;
  readonly routingCorrect: boolean;
  readonly evidence: string;
}

interface RoutingAdjudications {
  readonly adjudications: readonly RoutingAdjudication[];
}

interface Protocol {
  readonly routingCohort: {
    readonly promptRule: string;
  };
}

interface ArtifactBinding {
  readonly path: string;
  readonly sha256: string;
}

interface ConceptModelingFixture {
  readonly observations: readonly SkillValueObservation[];
  readonly artifactBindings: {
    readonly candidate: ArtifactBinding;
    readonly protocol: ArtifactBinding;
    readonly tasks: ArtifactBinding;
    readonly schema: ArtifactBinding;
    readonly adjudications: ArtifactBinding;
    readonly routing: ArtifactBinding;
  };
}

const benchmarkPath = fileURLToPath(new URL("../../evals/benchmark/kiln-concept-modeling-v1.json", import.meta.url));
const benchmarkRoot = dirname(benchmarkPath);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const digest = (bytes: Uint8Array): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const key = (taskId: string, condition: string): string => `${taskId}:${condition}`;

describe("concept-modeling skill promotion", () => {
  it("recomputes the paired value gate from adjudications and binds all evidence", () => {
    const fixture = readJson<ConceptModelingFixture>(benchmarkPath);
    const tasks = readJson<ConceptModelingTasks>(join(benchmarkRoot, "../fixtures/concept-modeling-v1/tasks.json"));
    const protocol = readJson<Protocol>(join(benchmarkRoot, "../fixtures/concept-modeling-v1/protocol.json"));
    const adjudications = readJson<SkillAdjudications>(join(benchmarkRoot, "../fixtures/concept-modeling-v1/adjudications.json"));
    const routing = readJson<RoutingAdjudications>(join(benchmarkRoot, "../fixtures/concept-modeling-v1/routing-adjudications.json"));
    const taskById = new Map(tasks.tasks.map((task) => [task.id, task]));
    const adjudicationByKey = new Map(adjudications.adjudications.map((entry) => [key(entry.taskId, entry.condition), entry]));
    const observationByKey = new Map(fixture.observations.map((entry) => [key(entry.taskId, entry.condition), entry]));
    const routingByTask = new Map(routing.adjudications.map((entry) => [entry.taskId, entry]));

    const expectedObservationKeys = tasks.tasks.flatMap((task) => [key(task.id, "baseline"), key(task.id, "skill")]);
    expect(observationByKey.size).toBe(expectedObservationKeys.length);
    expect(new Set(observationByKey.keys())).toEqual(new Set(expectedObservationKeys));
    expect(adjudicationByKey.size).toBe(expectedObservationKeys.length);
    expect(new Set(adjudicationByKey.keys())).toEqual(new Set(expectedObservationKeys));
    expect(routingByTask.size).toBe(tasks.tasks.length);
    expect(new Set(routingByTask.keys())).toEqual(new Set(tasks.tasks.map((task) => task.id)));
    expect(new Set(Object.keys(fixture.artifactBindings))).toEqual(
      new Set(["candidate", "protocol", "tasks", "schema", "adjudications", "routing"]),
    );

    for (const adjudication of adjudications.adjudications) {
      const task = taskById.get(adjudication.taskId);
      const observation = observationByKey.get(key(adjudication.taskId, adjudication.condition));
      expect(task).toBeDefined();
      expect(observation).toBeDefined();
      expect(adjudication.signals).toHaveLength(task!.requiredSignals.length);
      expect(new Set(adjudication.signals.map((signal) => signal.id))).toEqual(new Set(task!.requiredSignals));
      expect(adjudication.signals.every((signal) => signal.evidence.trim().length > 0)).toBe(true);
      const qualityScore = adjudication.signals.filter((signal) => signal.satisfied).length / adjudication.signals.length;
      const passed = adjudication.signals.every((signal) => signal.satisfied);
      expect(observation!.qualityScore).toBe(qualityScore);
      expect(observation!.passed).toBe(passed);
      expect(observation!.replayEvidenceId).toBe(`codex-thread:${adjudication.threadId}`);
      const route = routingByTask.get(adjudication.taskId);
      expect(route).toBeDefined();
      expect(observation!.routingCorrect).toBe(route!.routingCorrect);
    }

    for (const route of routing.adjudications) {
      const task = taskById.get(route.taskId);
      expect(task).toBeDefined();
      expect(route.replayEvidenceId).toBe(`codex-thread:${route.threadId}`);
      expect(route.routingPromptDigest).toBe(digest(Buffer.from(task!.routingPrompt, "utf8")));
      expect(route.conceptModelingSelected).toBe(route.selectedSkills.includes("concept-modeling"));
      expect(route.selectedSkill === null || route.selectedSkills.includes(route.selectedSkill)).toBe(true);
      expect(route.expectedSelected).toBe(task!.expectedSkillSelection);
      expect(route.routingCorrect).toBe(route.conceptModelingSelected === route.expectedSelected);
      expect(route.evidence.trim().length).toBeGreaterThan(0);
    }

    for (const [name, binding] of Object.entries(fixture.artifactBindings)) {
      expect(binding.path, `${name} artifact path`).not.toContain("\\");
      expect(digest(readFileSync(join(benchmarkRoot, binding.path))), `${name} artifact digest`).toBe(binding.sha256);
    }
    const candidateDigest = fixture.artifactBindings.candidate.sha256;
    const protocolDigest = fixture.artifactBindings.protocol.sha256;
    expect(new Set(fixture.observations.map((entry) => entry.skillDigest))).toEqual(new Set([candidateDigest]));
    expect(new Set(fixture.observations.map((entry) => entry.candidateSetDigest))).toEqual(new Set([protocolDigest]));
    expect(protocol.routingCohort.promptRule).toMatch(/routingPrompt/);

    const report = evaluateSkillValuePromotion(fixture.observations, {
      minimumTaskCount: 6,
      minimumMeanQualityDelta: 0.08,
      maximumMeanTokenIncrease: 1_000,
      maximumMeanLatencyIncreaseMs: 1_000,
      maximumMeanCostIncreaseUsd: 0,
    });

    expect(report).toMatchObject({
      policyId: "skill-value-promotion-v1",
      taskCount: 6,
      baselineSuccessRate: 5 / 6,
      skillSuccessRate: 1,
      meanQualityDelta: 1 / 12,
      tokenDelta: 813.5,
      latencyDeltaMs: -573.5,
      regressedTaskIds: [],
      promotionEligible: true,
      issues: [],
    });
    expect(report.tokenDelta).toBeLessThanOrEqual(1_000);
    expect(report.latencyDeltaMs).toBeLessThanOrEqual(1_000);
  });

  it("binds the evaluated candidate to the builtin semantic contract", () => {
    const fixture = readJson<ConceptModelingFixture>(benchmarkPath);
    const candidatePath = join(benchmarkRoot, fixture.artifactBindings.candidate.path);
    const candidateBytes = readFileSync(candidatePath);
    const candidate = parseSkillMd(candidateBytes.toString("utf8"), candidatePath);
    const builtin = KILN_CORE_BUILTIN_SKILLS.find((skill) => skill.name === "concept-modeling");

    expect(digest(candidateBytes)).toBe(fixture.artifactBindings.candidate.sha256);
    expect(builtin).toBeDefined();
    expect(candidate).toMatchObject({
      name: builtin?.name,
      description: builtin?.description,
      tools: builtin?.tools,
      tags: builtin?.tags,
    });
    expect(candidate.instructions.trim()).toBe(builtin?.instructions.trim());
  });
});

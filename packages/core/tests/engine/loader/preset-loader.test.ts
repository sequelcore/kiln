import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPresetConfig, PresetLoaderError } from "../../../src/engine/loader/preset-loader.js";
import { parseAppYaml } from "../../../src/engine/loader/app-loader.js";
import type { App } from "../../../src/engine/composites/app.js";
import type { Team } from "../../../src/engine/composites/team.js";

function makeTeam(overrides?: Partial<Team>): Team {
  return {
    name: "dev",
    agents: {
      architect: { name: "Aria", role: "Senior Architect", goal: "Design robust solutions", tier: "reasoning", tools: [], structured: true },
      worker: { name: "Marcus", role: "Implementation Specialist", goal: "Write clean code", tier: "coding", tools: ["tool_a"], count: 2, sandbox: true },
      optimizer: { name: "Zoe", role: "Performance Optimizer", goal: "Optimize for speed", tier: "fast", tools: ["tool_b"] },
    },
    workflow: {
      phases: ["analyze", "research", "architect", "implement", "verify", "synthesize"],
      gates: {
        architect: { requires: ["human_approval"] },
        verify: { requires: ["tests_pass", "typecheck", "lint"] },
      },
      maxIterations: 3,
    },
    capabilities: [
      { name: "tool_a", description: "Tool A", schema: {}, tags: [], annotations: {} },
      { name: "tool_b", description: "Tool B", schema: {}, tags: [], annotations: {} },
    ],
    qualityGates: [],
    ...overrides,
  };
}

function makeApp(teams?: Record<string, Team>, fallback?: string): App {
  const resolvedTeams = teams ?? { development: makeTeam({ name: "development" }) };
  return {
    name: "test-app",
    teams: resolvedTeams,
    router: { fallback: fallback ?? Object.keys(resolvedTeams)[0]!, rules: [] },
    memory: { scopes: ["user"], backend: "sqlite+fts5" },
    channels: ["cli"],
  };
}

describe("loadPresetConfig", () => {
  it("extracts phases from team workflow", () => {
    const config = loadPresetConfig(makeApp());
    expect(config.phases).toEqual([
      "analyze", "research", "architect", "implement", "verify", "synthesize",
    ]);
  });

  it("detects approval gate from human_approval requirement", () => {
    const config = loadPresetConfig(makeApp());
    expect(config.requireApproval).toBe(true);
    expect(config.approvalAfterPhase).toBe("architect");
  });

  it("sets requireApproval false when no human_approval gate", () => {
    const team = makeTeam({
      workflow: {
        phases: ["plan", "execute", "review"],
        gates: { review: { requires: ["tests_pass"] } },
      },
    });
    const config = loadPresetConfig(makeApp({ dev: team }, "dev"));
    expect(config.requireApproval).toBe(false);
    expect(config.approvalAfterPhase).toBeUndefined();
  });

  it("extracts parallelWorkers from coding agent count", () => {
    const config = loadPresetConfig(makeApp());
    expect(config.parallelWorkers).toBe(2);
  });

  it("defaults parallelWorkers to 2 when no coding agent count", () => {
    const team = makeTeam({
      agents: {
        bot: { name: "Bot", role: "Generalist", goal: "Handle tasks", tier: "coding", tools: [] },
      },
    });
    const config = loadPresetConfig(makeApp({ dev: team }, "dev"));
    expect(config.parallelWorkers).toBe(2);
  });

  it("extracts maxIterations from workflow", () => {
    const config = loadPresetConfig(makeApp());
    expect(config.maxIterations).toBe(3);
  });

  it("defaults maxIterations to 3 when not set", () => {
    const team = makeTeam({
      workflow: { phases: ["a", "b"], gates: {} },
    });
    const config = loadPresetConfig(makeApp({ dev: team }, "dev"));
    expect(config.maxIterations).toBe(3);
  });

  it("defaults maxDepth to 3", () => {
    const config = loadPresetConfig(makeApp());
    expect(config.maxDepth).toBe(3);
  });

  it("uses router fallback team when no teamName specified", () => {
    const app = makeApp({ alpha: makeTeam({ name: "alpha" }) }, "alpha");
    const config = loadPresetConfig(app);
    expect(config.phases).toEqual([
      "analyze", "research", "architect", "implement", "verify", "synthesize",
    ]);
  });

  it("uses specified teamName when provided", () => {
    const team2 = makeTeam({
      name: "team2",
      workflow: { phases: ["receive", "respond"], gates: {} },
    });
    const app = makeApp({
      main: makeTeam({ name: "main" }),
      team2,
    }, "main");
    const config = loadPresetConfig(app, "team2");
    expect(config.phases).toEqual(["receive", "respond"]);
    expect(config.requireApproval).toBe(false);
  });

  it("throws PresetLoaderError for unknown team", () => {
    const app = makeApp();
    expect(() => loadPresetConfig(app, "nonexistent")).toThrow(PresetLoaderError);
    expect(() => loadPresetConfig(app, "nonexistent")).toThrow(/not found/);
  });

  it("includes available teams in error message", () => {
    const app = makeApp({
      alpha: makeTeam({ name: "alpha" }),
      beta: makeTeam({ name: "beta" }),
    }, "alpha");
    try {
      loadPresetConfig(app, "gamma");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("alpha");
      expect((e as Error).message).toContain("beta");
    }
  });

  it("works with example preset end-to-end", () => {
    const presetPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../src/presets/example.yaml",
    );
    const app = parseAppYaml(readFileSync(presetPath, "utf-8"));
    const config = loadPresetConfig(app);

    expect(config.phases).toEqual([
      "analyze", "research", "architect", "implement", "verify", "synthesize",
    ]);
    expect(config.requireApproval).toBe(true);
    expect(config.approvalAfterPhase).toBe("architect");
    expect(config.parallelWorkers).toBe(2);
    expect(config.maxIterations).toBe(3);
    expect(config.maxDepth).toBe(3);
  });
});

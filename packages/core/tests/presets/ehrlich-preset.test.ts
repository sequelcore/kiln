import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppYaml, validateAppGraph, validateApp, loadPresetConfig } from "../../src/engine/index.js";

const PRESET_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/presets/ehrlich.yaml",
);

function loadEhrlichPreset() {
  const content = readFileSync(PRESET_PATH, "utf-8");
  return parseAppYaml(content);
}

describe("ehrlich.yaml preset", () => {
  it("loads without parse errors", () => {
    const app = loadEhrlichPreset();
    expect(app.name).toBe("ehrlich");
  });

  it("passes graph validation", () => {
    const app = loadEhrlichPreset();
    expect(validateAppGraph(app)).toBeNull();
  });

  it("passes full app validation", () => {
    const app = loadEhrlichPreset();
    expect(validateApp(app)).toEqual([]);
  });

  it("has correct channels", () => {
    const app = loadEhrlichPreset();
    expect(app.channels).toEqual(["web", "api"]);
  });

  it("has memory config with 5 scopes and postgresql backend", () => {
    const app = loadEhrlichPreset();
    expect(app.memory.scopes).toHaveLength(5);
    expect(app.memory.scopes).toContain("user");
    expect(app.memory.scopes).toContain("agent:director");
    expect(app.memory.scopes).toContain("agent:researcher");
    expect(app.memory.scopes).toContain("agent:summarizer");
    expect(app.memory.scopes).toContain("project:default");
    expect(app.memory.backend).toBe("postgresql");
    expect(app.memory.sync).toBeUndefined();
  });

  it("has one team: investigation", () => {
    const app = loadEhrlichPreset();
    expect(Object.keys(app.teams)).toEqual(["investigation"]);
  });

  it("has router with fallback to investigation", () => {
    const app = loadEhrlichPreset();
    expect(app.router.fallback).toBe("investigation");
    expect(app.router.rules).toHaveLength(0);
  });

  describe("investigation team", () => {
    it("has 3 agents: director, researcher, summarizer", () => {
      const team = loadEhrlichPreset().teams["investigation"]!;
      const agentNames = Object.keys(team.agents);
      expect(agentNames).toHaveLength(3);
      expect(agentNames).toContain("director");
      expect(agentNames).toContain("researcher");
      expect(agentNames).toContain("summarizer");
    });

    it("director is reasoning tier with no tools and structured output", () => {
      const director = loadEhrlichPreset().teams["investigation"]!.agents["director"]!;
      expect(director.tier).toBe("reasoning");
      expect(director.tools).toEqual([]);
      expect(director.structured).toBe(true);
    });

    it("researcher is coding tier with 13 tools, count 2, sandboxed", () => {
      const researcher = loadEhrlichPreset().teams["investigation"]!.agents["researcher"]!;
      expect(researcher.tier).toBe("coding");
      expect(researcher.tools).toHaveLength(13);
      expect(researcher.count).toBe(2);
      expect(researcher.sandbox).toBe(true);
    });

    it("researcher has investigation + literature + statistics tools", () => {
      const researcher = loadEhrlichPreset().teams["investigation"]!.agents["researcher"]!;
      const tools = researcher.tools;
      // Investigation lifecycle
      expect(tools).toContain("ehrlich_propose_hypothesis");
      expect(tools).toContain("ehrlich_design_experiment");
      expect(tools).toContain("ehrlich_evaluate_hypothesis");
      expect(tools).toContain("ehrlich_conclude_investigation");
      // Literature
      expect(tools).toContain("ehrlich_search_literature");
      expect(tools).toContain("ehrlich_search_citations");
      expect(tools).toContain("ehrlich_get_reference");
      // Statistics
      expect(tools).toContain("ehrlich_run_statistical_test");
      expect(tools).toContain("ehrlich_run_categorical_test");
    });

    it("summarizer is fast tier with 3 tools", () => {
      const summarizer = loadEhrlichPreset().teams["investigation"]!.agents["summarizer"]!;
      expect(summarizer.tier).toBe("fast");
      expect(summarizer.tools).toHaveLength(3);
      expect(summarizer.tools).toContain("ehrlich_classify_domain");
      expect(summarizer.tools).toContain("ehrlich_compress_output");
      expect(summarizer.tools).toContain("ehrlich_grade_evidence");
    });

    it("has 6-phase scientific workflow", () => {
      const team = loadEhrlichPreset().teams["investigation"]!;
      expect(team.workflow.phases).toEqual([
        "classification", "literature", "formulation", "testing", "controls", "synthesis",
      ]);
    });

    it("has gates on formulation, testing, and synthesis phases", () => {
      const gates = loadEhrlichPreset().teams["investigation"]!.workflow.gates;
      expect(gates["formulation"]!.requires).toContain("human_approval");
      expect(gates["testing"]!.requires).toContain("hypotheses_approved");
      expect(gates["synthesis"]!.requires).toContain("evidence_graded");
    });

    it("has 20 capabilities", () => {
      const team = loadEhrlichPreset().teams["investigation"]!;
      expect(team.capabilities).toHaveLength(20);
    });

    it("capabilities cover all expected tags", () => {
      const team = loadEhrlichPreset().teams["investigation"]!;
      const allTags = new Set(team.capabilities.flatMap((c) => c.tags));
      expect(allTags).toContain("investigation");
      expect(allTags).toContain("literature");
      expect(allTags).toContain("statistics");
      expect(allTags).toContain("domain");
      expect(allTags).toContain("compression");
      expect(allTags).toContain("evidence");
      expect(allTags).toContain("visualization");
      expect(allTags).toContain("cost");
    });

    it("has 3 quality gates", () => {
      const team = loadEhrlichPreset().teams["investigation"]!;
      expect(team.qualityGates).toHaveLength(3);
      const names = team.qualityGates.map((g) => g.name);
      expect(names).toContain("evidence_threshold");
      expect(names).toContain("reproducibility_check");
      expect(names).toContain("bias_assessment");
    });

    it("all agent tool refs exist in capabilities", () => {
      const team = loadEhrlichPreset().teams["investigation"]!;
      const capNames = new Set(team.capabilities.map((c) => c.name));
      for (const [, agent] of Object.entries(team.agents)) {
        for (const tool of agent.tools) {
          expect(capNames.has(tool)).toBe(true);
        }
      }
    });
  });

  describe("preset loader integration", () => {
    it("produces OrchestratorConfig from ehrlich preset", () => {
      const app = loadEhrlichPreset();
      const config = loadPresetConfig(app);
      expect(config.phases).toEqual([
        "classification", "literature", "formulation", "testing", "controls", "synthesis",
      ]);
    });

    it("approval gate is after formulation phase", () => {
      const app = loadEhrlichPreset();
      const config = loadPresetConfig(app);
      expect(config.requireApproval).toBe(true);
      expect(config.approvalAfterPhase).toBe("formulation");
    });

    it("has 2 parallel workers from researcher count", () => {
      const app = loadEhrlichPreset();
      const config = loadPresetConfig(app);
      expect(config.parallelWorkers).toBe(2);
    });

    it("has maxIterations of 3", () => {
      const app = loadEhrlichPreset();
      const config = loadPresetConfig(app);
      expect(config.maxIterations).toBe(3);
    });
  });
});

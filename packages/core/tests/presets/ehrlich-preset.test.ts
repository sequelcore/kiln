import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppYaml, validateAppGraph, validateApp } from "../../src/engine/index.js";

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

  it("has one team: investigation", () => {
    const app = loadEhrlichPreset();
    expect(Object.keys(app.teams)).toEqual(["investigation"]);
  });

  it("has router with fallback to investigation", () => {
    const app = loadEhrlichPreset();
    expect(app.router.fallback).toBe("investigation");
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
    });

    it("researcher is coding tier with 13 tools", () => {
      const researcher = loadEhrlichPreset().teams["investigation"]!.agents["researcher"]!;
      expect(researcher.tier).toBe("coding");
      expect(researcher.tools).toHaveLength(13);
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

});

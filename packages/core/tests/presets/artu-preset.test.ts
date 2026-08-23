import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppYaml, validateAppGraph, validateApp } from "../../src/engine/index.js";

const PRESET_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/presets/artu.yaml",
);

function loadArtuPreset() {
  const content = readFileSync(PRESET_PATH, "utf-8");
  return parseAppYaml(content);
}

describe("artu.yaml preset", () => {
  it("loads without parse errors", () => {
    const app = loadArtuPreset();
    expect(app.name).toBe("artu");
  });

  it("passes graph validation", () => {
    const app = loadArtuPreset();
    expect(validateAppGraph(app)).toBeNull();
  });

  it("passes full app validation", () => {
    const app = loadArtuPreset();
    expect(validateApp(app)).toEqual([]);
  });

  it("has one team: trading", () => {
    const app = loadArtuPreset();
    expect(Object.keys(app.teams)).toEqual(["trading"]);
  });

  it("has router with fallback to trading", () => {
    const app = loadArtuPreset();
    expect(app.router.fallback).toBe("trading");
  });

  describe("trading team", () => {
    it("has 3 agents: director, worker, optimizer", () => {
      const team = loadArtuPreset().teams["trading"]!;
      const agentNames = Object.keys(team.agents);
      expect(agentNames).toHaveLength(3);
      expect(agentNames).toContain("director");
      expect(agentNames).toContain("worker");
      expect(agentNames).toContain("optimizer");
    });

    it("director has no tools", () => {
      const director = loadArtuPreset().teams["trading"]!.agents["director"]!;
      expect(director.tools).toEqual([]);
    });

    it("worker has 26 tools", () => {
      const worker = loadArtuPreset().teams["trading"]!.agents["worker"]!;
      expect(worker.tools).toHaveLength(26);
    });

    it("worker has market + ml + regime + portfolio + execution + memory tools", () => {
      const worker = loadArtuPreset().teams["trading"]!.agents["worker"]!;
      const tools = worker.tools;
      // Market Intelligence
      expect(tools).toContain("artu_scan_market");
      expect(tools).toContain("artu_get_ticker");
      expect(tools).toContain("artu_get_order_book");
      expect(tools).toContain("artu_get_historical_candles");
      expect(tools).toContain("artu_get_funding_rates");
      // ML & Features
      expect(tools).toContain("artu_compute_features");
      expect(tools).toContain("artu_get_current_signal");
      expect(tools).toContain("artu_get_model_probabilities");
      expect(tools).toContain("artu_get_feature_importance");
      // Regime Detection
      expect(tools).toContain("artu_get_current_regime");
      expect(tools).toContain("artu_get_transition_probabilities");
      expect(tools).toContain("artu_predict_next_regime");
      // Risk & Portfolio
      expect(tools).toContain("artu_get_portfolio_state");
      expect(tools).toContain("artu_get_correlation_matrix");
      expect(tools).toContain("artu_calculate_position_size");
      expect(tools).toContain("artu_get_risk_parameters");
      expect(tools).toContain("artu_get_trades");
      expect(tools).toContain("artu_get_daily_pnl");
      expect(tools).toContain("artu_get_performance_attribution");
      // Execution Directives
      expect(tools).toContain("artu_set_watchlist");
      expect(tools).toContain("artu_set_allocation");
      expect(tools).toContain("artu_set_risk_params");
      expect(tools).toContain("artu_override_signal");
      // Memory
      expect(tools).toContain("artu_recall_similar_regime");
      expect(tools).toContain("artu_record_decision");
      expect(tools).toContain("artu_get_lessons");
    });

    it("optimizer has no tools", () => {
      const optimizer = loadArtuPreset().teams["trading"]!.agents["optimizer"]!;
      expect(optimizer.tools).toHaveLength(0);
    });

    it("has 26 capabilities", () => {
      const team = loadArtuPreset().teams["trading"]!;
      expect(team.capabilities).toHaveLength(26);
    });

    it("capabilities cover all expected tags: market, ml, regime, portfolio, execution, memory", () => {
      const team = loadArtuPreset().teams["trading"]!;
      const allTags = new Set(team.capabilities.flatMap((c) => c.tags));
      expect(allTags).toContain("market");
      expect(allTags).toContain("ml");
      expect(allTags).toContain("regime");
      expect(allTags).toContain("portfolio");
      expect(allTags).toContain("execution");
      expect(allTags).toContain("memory");
    });

    it("all agent tool refs exist in capabilities", () => {
      const team = loadArtuPreset().teams["trading"]!;
      const capNames = new Set(team.capabilities.map((c) => c.name));
      for (const [, agent] of Object.entries(team.agents)) {
        for (const tool of agent.tools) {
          expect(capNames.has(tool)).toBe(true);
        }
      }
    });

    it("does not carry legacy annotations on override_signal", () => {
      const team = loadArtuPreset().teams["trading"]!;
      const overrideCap = team.capabilities.find((c) => c.name === "artu_override_signal");
      expect(overrideCap).toBeDefined();
      expect((overrideCap as { annotations?: unknown } | undefined)?.annotations).toBeUndefined();
    });

    it("does not carry legacy annotations on market intelligence tools", () => {
      const team = loadArtuPreset().teams["trading"]!;
      const marketTools = [
        "artu_scan_market",
        "artu_get_ticker",
        "artu_get_order_book",
        "artu_get_historical_candles",
        "artu_get_funding_rates",
      ];
      for (const toolName of marketTools) {
        const cap = team.capabilities.find((c) => c.name === toolName);
        expect(cap).toBeDefined();
        expect((cap as { annotations?: unknown } | undefined)?.annotations).toBeUndefined();
      }
    });
  });

});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppYaml, validateAppGraph, validateApp, loadPresetConfig } from "../../src/engine/index.js";

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

  it("has correct channels", () => {
    const app = loadArtuPreset();
    expect(app.channels).toEqual(["api", "websocket", "cli"]);
  });

  it("has memory config with 5 scopes and sqlite+fts5 backend, no sync", () => {
    const app = loadArtuPreset();
    expect(app.memory.scopes).toHaveLength(5);
    expect(app.memory.scopes).toContain("user");
    expect(app.memory.scopes).toContain("agent:director");
    expect(app.memory.scopes).toContain("agent:worker");
    expect(app.memory.scopes).toContain("agent:optimizer");
    expect(app.memory.scopes).toContain("project:default");
    expect(app.memory.backend).toBe("sqlite+fts5");
    expect(app.memory.sync).toBeUndefined();
  });

  it("has one team: trading", () => {
    const app = loadArtuPreset();
    expect(Object.keys(app.teams)).toEqual(["trading"]);
  });

  it("has router with fallback to trading, no rules", () => {
    const app = loadArtuPreset();
    expect(app.router.fallback).toBe("trading");
    expect(app.router.rules).toHaveLength(0);
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

    it("director is reasoning tier with no tools and structured output", () => {
      const director = loadArtuPreset().teams["trading"]!.agents["director"]!;
      expect(director.tier).toBe("reasoning");
      expect(director.tools).toEqual([]);
      expect(director.structured).toBe(true);
    });

    it("worker is coding tier with 26 tools, count 2, sandboxed", () => {
      const worker = loadArtuPreset().teams["trading"]!.agents["worker"]!;
      expect(worker.tier).toBe("coding");
      expect(worker.tools).toHaveLength(26);
      expect(worker.count).toBe(2);
      expect(worker.sandbox).toBe(true);
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

    it("optimizer is fast tier with 0 tools", () => {
      const optimizer = loadArtuPreset().teams["trading"]!.agents["optimizer"]!;
      expect(optimizer.tier).toBe("fast");
      expect(optimizer.tools).toHaveLength(0);
    });

    it("has 6-phase workflow: scan, analyze, thesis, allocate, rebalance, monitor", () => {
      const team = loadArtuPreset().teams["trading"]!;
      expect(team.workflow.phases).toEqual([
        "scan", "analyze", "thesis", "allocate", "rebalance", "monitor",
      ]);
    });

    it("has gates on thesis (human_approval), rebalance (directive_validated), monitor (positions_verified)", () => {
      const gates = loadArtuPreset().teams["trading"]!.workflow.gates;
      expect(gates["thesis"]!.requires).toContain("human_approval");
      expect(gates["rebalance"]!.requires).toContain("directive_validated");
      expect(gates["monitor"]!.requires).toContain("positions_verified");
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

    it("has 3 quality gates: model_validation, paper_trading_metrics, directive_schema", () => {
      const team = loadArtuPreset().teams["trading"]!;
      expect(team.qualityGates).toHaveLength(3);
      const names = team.qualityGates.map((g) => g.name);
      expect(names).toContain("model_validation");
      expect(names).toContain("paper_trading_metrics");
      expect(names).toContain("directive_schema");
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

  describe("preset loader integration", () => {
    it("produces OrchestratorConfig from artu preset", () => {
      const app = loadArtuPreset();
      const config = loadPresetConfig(app);
      expect(config.phases).toEqual([
        "scan", "analyze", "thesis", "allocate", "rebalance", "monitor",
      ]);
    });

    it("approval gate is after thesis phase", () => {
      const app = loadArtuPreset();
      const config = loadPresetConfig(app);
      expect(config.requireApproval).toBe(true);
      expect(config.approvalAfterPhase).toBe("thesis");
    });

    it("has 2 parallel workers from worker count", () => {
      const app = loadArtuPreset();
      const config = loadPresetConfig(app);
      expect(config.parallelWorkers).toBe(2);
    });

    it("has maxIterations of 3", () => {
      const app = loadArtuPreset();
      const config = loadPresetConfig(app);
      expect(config.maxIterations).toBe(3);
    });
  });
});

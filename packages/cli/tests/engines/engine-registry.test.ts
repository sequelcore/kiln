import { describe, expect, it, vi } from "vitest";
import {
  EngineRegistry,
  resolveEngineAvailabilityMap,
  resolveEngineRoute,
  type EngineProbeRunner,
} from "../../src/engines/engine-registry.js";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";

const baseConfig: KilnGlobalConfig = {
  version: "1",
  engines: {
    codex: { enabled: true, billing: "plus-quota" },
    opencode: { enabled: true, billing: "free" },
  },
  routing: {
    defaultWorker: "codex",
    fallback: "opencode",
    budgetAware: true,
    budget: {
      codex: { dailyTokenCeiling: 100, onCeiling: "fallback" },
      opencode: { dailyTokenCeiling: null },
    },
  },
};

describe("EngineRegistry", () => {
  it("probes enabled known harness engines with --version", () => {
    const runner = vi.fn<EngineProbeRunner>(() => ({ status: 0 }));
    const registry = new EngineRegistry({ runner });

    const results = registry.probeAll(baseConfig);

    expect(results.map((result) => result.engineId)).toEqual(["codex", "opencode"]);
    expect(results.every((result) => result.available)).toBe(true);
    expect(runner).toHaveBeenCalledWith("codex", ["--version"], 2_000);
    expect(runner).toHaveBeenCalledWith("opencode", ["--version"], 2_000);
  });

  it("marks binary failures unavailable", () => {
    const registry = new EngineRegistry({
      runner: () => ({ status: 1, error: new Error("not found") }),
    });

    expect(registry.probe("codex")).toMatchObject({
      engineId: "codex",
      available: false,
      reason: "not found",
    });
  });

  it("builds an availability map from session-start engine probes", () => {
    const registry = new EngineRegistry({
      runner: (command) => ({ status: command === "codex" ? 1 : 0 }),
    });

    const availability = resolveEngineAvailabilityMap(baseConfig, registry);

    expect(availability.get("codex")).toBe(false);
    expect(availability.get("opencode")).toBe(true);
  });

  it("resolves fallback when budget-aware routing crosses the ceiling", () => {
    const route = resolveEngineRoute(baseConfig, {
      getDailyTokensUsed: (engineId) => engineId === "codex" ? 150 : 0,
    });

    expect(route).toEqual({
      worker: "opencode",
      reason: "budget-ceiling",
      defaultWorker: "codex",
      fallback: "opencode",
      budget: {
        engineId: "codex",
        tokensUsed: 150,
        ceiling: 100,
        withinBudget: false,
      },
    });
  });

  it("resolves fallback when default worker is unavailable", () => {
    const route = resolveEngineRoute(baseConfig, {
      isEngineAvailable: (engineId) => engineId !== "codex",
    });

    expect(route.worker).toBe("opencode");
    expect(route.reason).toBe("unavailable");
    expect(route.defaultWorker).toBe("codex");
  });

  it("keeps default worker when budget awareness is disabled", () => {
    const route = resolveEngineRoute({
      ...baseConfig,
      routing: { ...baseConfig.routing, budgetAware: false },
    }, {
      getDailyTokensUsed: () => 150,
    });

    expect(route.worker).toBe("codex");
    expect(route.reason).toBe("default");
  });
});

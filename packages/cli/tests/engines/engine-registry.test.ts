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
  workerRouting: {
    defaultWorker: "codex",
    fallback: "opencode",
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

  it("retries only a timed-out Claude Code cold start with a bounded window", () => {
    const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    const runner = vi.fn<EngineProbeRunner>()
      .mockReturnValueOnce({ status: null, error: timeout })
      .mockReturnValueOnce({ status: 0 });
    const registry = new EngineRegistry({ runner });

    expect(registry.probe("claude").available).toBe(true);
    expect(runner).toHaveBeenNthCalledWith(1, "claude", ["--version"], 2_000);
    expect(runner).toHaveBeenNthCalledWith(2, "claude", ["--version"], 8_000);
  });

  it("honors an explicit probe timeout for every harness", () => {
    const runner = vi.fn<EngineProbeRunner>(() => ({ status: 0 }));
    const registry = new EngineRegistry({ runner, timeoutMs: 750 });

    registry.probe("claude");

    expect(runner).toHaveBeenCalledWith("claude", ["--version"], 750);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-timeout Claude failure", () => {
    const runner = vi.fn<EngineProbeRunner>(() => ({ status: 1, error: new Error("not authenticated") }));
    const registry = new EngineRegistry({ runner });

    expect(registry.probe("claude")).toMatchObject({ available: false, reason: "not authenticated" });
    expect(runner).toHaveBeenCalledTimes(1);
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

  it("resolves fallback when default worker is unavailable", () => {
    const route = resolveEngineRoute(baseConfig, {
      isEngineAvailable: (engineId) => engineId !== "codex",
    });

    expect(route.worker).toBe("opencode");
    expect(route.reason).toBe("unavailable");
    expect(route.defaultWorker).toBe("codex");
  });

  it("uses ordered routing routes before scalar default and fallback fields", () => {
    const route = resolveEngineRoute({
      ...baseConfig,
      workerRouting: {
        ...baseConfig.workerRouting,
        defaultWorker: "opencode",
        fallback: "opencode",
        routes: [
          { provider: "codex-oauth", model: "gpt-5.4-mini" },
          { provider: "openrouter", model: "openrouter/free" },
          { provider: "codex", model: "gpt-5.4-mini" },
        ],
      },
    });

    expect(route.worker).toBe("codex-oauth");
    expect(route.defaultWorker).toBe("codex-oauth");
    expect(route.fallback).toBe("openrouter");
  });

  it("keeps the default worker when it is available", () => {
    const route = resolveEngineRoute(baseConfig);

    expect(route.worker).toBe("codex");
    expect(route.reason).toBe("default");
  });
});

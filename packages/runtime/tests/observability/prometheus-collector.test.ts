import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KilnEvent } from "@kilnai/core";

// Track mock calls for assertions
const mockInc = vi.fn();
const mockObserve = vi.fn();
const mockMetrics = vi.fn().mockResolvedValue("# HELP kiln_llm_requests_total\n");

class MockCounter {
  constructor(public readonly opts: Record<string, unknown>) {}
  inc(labels: Record<string, string>, value?: number) {
    mockInc(this.opts.name, labels, value);
  }
}

class MockHistogram {
  constructor(public readonly opts: Record<string, unknown>) {}
  observe(labels: Record<string, string>, value: number) {
    mockObserve(this.opts.name, labels, value);
  }
}

class MockRegistry {
  contentType = "text/plain; version=0.0.4";
  metrics = mockMetrics;
}

vi.mock("prom-client", () => ({
  Counter: MockCounter,
  Histogram: MockHistogram,
  Registry: MockRegistry,
}));

// Import after mock is set up
const { PrometheusCollector } = await import(
  "../../src/observability/prometheus-collector.js"
);

function makeEvent(
  type: string,
  extra: Record<string, unknown> = {},
): KilnEvent {
  return {
    type,
    timestamp: new Date(),
    sessionId: "sess-1",
    ...extra,
  } as KilnEvent;
}

describe("PrometheusCollector", () => {
  beforeEach(() => {
    mockInc.mockClear();
    mockObserve.mockClear();
    mockMetrics.mockClear();
  });

  it("increments counters on cost_update event", async () => {
    const collector = new PrometheusCollector();
    // Wait for initialization
    await collector.getRegistry();

    await collector.save(
      makeEvent("cost_update", {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        totalCostUsd: 0.005,
        byRoleModel: {
          assistant: { model: "claude-3-haiku", calls: 1, costUsd: 0.005 },
        },
      }),
    );

    // llm_requests counter
    expect(mockInc).toHaveBeenCalledWith(
      "kiln_llm_requests_total",
      { provider: "anthropic", model: "claude-3-haiku", status: "success" },
      undefined,
    );

    // cost_usd counter
    expect(mockInc).toHaveBeenCalledWith(
      "kiln_cost_usd_total",
      { provider: "anthropic", model: "claude-3-haiku" },
      0.005,
    );

    // tokens counters
    expect(mockInc).toHaveBeenCalledWith(
      "kiln_llm_tokens_total",
      { direction: "input", provider: "", model: "" },
      100,
    );
    expect(mockInc).toHaveBeenCalledWith(
      "kiln_llm_tokens_total",
      { direction: "output", provider: "", model: "" },
      50,
    );
  });

  it("increments tool counter on tool_result event", async () => {
    const collector = new PrometheusCollector();
    await collector.getRegistry();

    await collector.save(
      makeEvent("tool_result", {
        toolName: "search",
        success: true,
        durationMs: 150,
      }),
    );

    expect(mockInc).toHaveBeenCalledWith(
      "kiln_tool_calls_total",
      { tool_name: "search", success: "true" },
      undefined,
    );
  });

  it("increments tool cache hit counter", async () => {
    const collector = new PrometheusCollector();
    await collector.getRegistry();

    await collector.save(
      makeEvent("tool_cache_hit", { toolName: "lookup" }),
    );

    expect(mockInc).toHaveBeenCalledWith(
      "kiln_tool_cache_hits_total",
      { tool_name: "lookup" },
      undefined,
    );
  });

  it("increments error counter on error event", async () => {
    const collector = new PrometheusCollector();
    await collector.getRegistry();

    await collector.save(makeEvent("error", { code: "PROVIDER_ERROR" }));

    expect(mockInc).toHaveBeenCalledWith(
      "kiln_errors_total",
      { code: "PROVIDER_ERROR" },
      undefined,
    );
  });

  it("increments agent routing counter", async () => {
    const collector = new PrometheusCollector();
    await collector.getRegistry();

    await collector.save(
      makeEvent("agent_routed", {
        agentName: "sales-agent",
        routingTier: "regex",
      }),
    );

    expect(mockInc).toHaveBeenCalledWith(
      "kiln_agent_routings_total",
      { agent_name: "sales-agent", routing_tier: "regex" },
      undefined,
    );
  });

  it("increments model routing counter", async () => {
    const collector = new PrometheusCollector();
    await collector.getRegistry();

    await collector.save(
      makeEvent("model_routed", {
        provider: "anthropic",
        model: "claude-3-opus",
        routingTier: "complexity",
      }),
    );

    expect(mockInc).toHaveBeenCalledWith(
      "kiln_model_routings_total",
      {
        provider: "anthropic",
        model: "claude-3-opus",
        routing_tier: "complexity",
      },
      undefined,
    );
  });

  it("does nothing for unknown event types", async () => {
    const collector = new PrometheusCollector();
    await collector.getRegistry();

    mockInc.mockClear();
    mockObserve.mockClear();

    await collector.save(makeEvent("phase_changed", { phase: "planning" }));

    expect(mockInc).not.toHaveBeenCalled();
    expect(mockObserve).not.toHaveBeenCalled();
  });

  it("getBySession() throws (write-only)", async () => {
    const collector = new PrometheusCollector();

    await expect(collector.getBySession("sess-1")).rejects.toThrow(
      "PrometheusCollector is write-only",
    );
  });

  it("getAfter() throws (write-only)", async () => {
    const collector = new PrometheusCollector();

    await expect(collector.getAfter("sess-1", "evt-1")).rejects.toThrow(
      "PrometheusCollector is write-only",
    );
  });

  it("getRegistry() returns registry when prom-client is available", async () => {
    const collector = new PrometheusCollector();
    const registry = await collector.getRegistry();

    expect(registry).not.toBeNull();
    expect(registry!.contentType).toBe("text/plain; version=0.0.4");

    const metricsOutput = await registry!.metrics();
    expect(metricsOutput).toContain("kiln_llm_requests_total");
  });

  it("supports custom prefix", async () => {
    const collector = new PrometheusCollector({ prefix: "myapp" });
    await collector.getRegistry();

    mockInc.mockClear();

    await collector.save(makeEvent("error", { code: "TIMEOUT" }));

    expect(mockInc).toHaveBeenCalledWith(
      "myapp_errors_total",
      { code: "TIMEOUT" },
      undefined,
    );
  });

  describe("inferProvider", () => {
    it("infers anthropic from claude models", async () => {
      const collector = new PrometheusCollector();
      await collector.getRegistry();

      await collector.save(
        makeEvent("cost_update", {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          totalCostUsd: 0.001,
          byRoleModel: {
            assistant: {
              model: "claude-3-sonnet",
              calls: 1,
              costUsd: 0.001,
            },
          },
        }),
      );

      expect(mockInc).toHaveBeenCalledWith(
        "kiln_llm_requests_total",
        { provider: "anthropic", model: "claude-3-sonnet", status: "success" },
        undefined,
      );
    });

    it("infers openai from gpt models", async () => {
      const collector = new PrometheusCollector();
      await collector.getRegistry();

      await collector.save(
        makeEvent("cost_update", {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          totalCostUsd: 0.001,
          byRoleModel: {
            assistant: {
              model: "gpt-4o",
              calls: 1,
              costUsd: 0.001,
            },
          },
        }),
      );

      expect(mockInc).toHaveBeenCalledWith(
        "kiln_llm_requests_total",
        { provider: "openai", model: "gpt-4o", status: "success" },
        undefined,
      );
    });

    it("infers deepseek from deepseek models", async () => {
      const collector = new PrometheusCollector();
      await collector.getRegistry();

      await collector.save(
        makeEvent("cost_update", {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          totalCostUsd: 0.001,
          byRoleModel: {
            assistant: {
              model: "deepseek-chat",
              calls: 1,
              costUsd: 0.001,
            },
          },
        }),
      );

      expect(mockInc).toHaveBeenCalledWith(
        "kiln_llm_requests_total",
        { provider: "deepseek", model: "deepseek-chat", status: "success" },
        undefined,
      );
    });

    it("defaults to ollama for unknown models", async () => {
      const collector = new PrometheusCollector();
      await collector.getRegistry();

      await collector.save(
        makeEvent("cost_update", {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          totalCostUsd: 0,
          byRoleModel: {
            assistant: {
              model: "llama3",
              calls: 1,
              costUsd: 0,
            },
          },
        }),
      );

      expect(mockInc).toHaveBeenCalledWith(
        "kiln_llm_requests_total",
        { provider: "ollama", model: "llama3", status: "success" },
        undefined,
      );
    });
  });
});

describe("PrometheusCollector (prom-client unavailable)", () => {
  it("save() is a no-op when prom-client is not available", async () => {
    // Create a collector that simulates failed initialization
    const collector = new PrometheusCollector();
    // Force initialized to false to simulate missing prom-client
    (collector as unknown as { initialized: boolean }).initialized = false;

    mockInc.mockClear();

    await collector.save(makeEvent("error", { code: "TEST" }));

    expect(mockInc).not.toHaveBeenCalled();
  });

  it("getRegistry() returns null when not initialized", async () => {
    const collector = new PrometheusCollector();
    // Force registry to null and initPromise to resolved
    (collector as unknown as { registry: null }).registry = null;
    (collector as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();

    const registry = await collector.getRegistry();
    expect(registry).toBeNull();
  });
});

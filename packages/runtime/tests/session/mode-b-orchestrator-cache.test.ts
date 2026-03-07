import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderAdapter, Capability, ToolDefinition } from "@kilnai/core";
import { textParts, EventBus, ToolCache } from "@kilnai/core";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";

function makeSession(): ModeBSession {
  return new ModeBSession({ appName: "app", userId: "user-1", systemPrompt: "Be helpful." });
}

function makeProviderWithToolCall(): ProviderAdapter {
  let callCount = 0;
  return {
    name: "mock",
    createMessage: vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          parts: textParts("thinking..."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-1", name: "get_weather", input: { city: "London" } }],
          stopReason: "tool_use",
        };
      }
      return {
        parts: textParts("done"),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      };
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeCapabilityMap(cacheTtl?: number): ReadonlyMap<string, Capability> {
  const cap: Capability = {
    name: "get_weather",
    description: "Gets weather",
    schema: {},
    tags: [],
    annotations: cacheTtl !== undefined ? { readOnly: true, cacheTtl } : { readOnly: true },
  };
  return new Map([["get_weather", cap]]);
}

const TOOL_DEF: ToolDefinition = {
  name: "get_weather",
  description: "Gets weather",
  inputSchema: {},
  tags: new Set(),
};

describe("ModeBOrchestrator - Tool Result Caching", () => {
  let toolCache: ToolCache;
  let toolFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toolCache = new ToolCache();
    toolFn = vi.fn().mockResolvedValue("sunny, 20C");
  });

  it("executes tool normally on first call and caches result", async () => {
    const provider = makeProviderWithToolCall();

    const orchestrator = new ModeBOrchestrator({
      provider,
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
    });

    await orchestrator.processMessage(makeSession(), textParts("weather in London"));

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(toolCache.size).toBe(1);

    // Verify the cached value
    const cached = toolCache.get("get_weather", { city: "London" });
    expect(cached).toBe("sunny, 20C");
  });

  it("returns cached result on second call without executing tool", async () => {
    // Pre-populate cache
    toolCache.set("get_weather", { city: "London" }, "sunny, 20C", 60);

    const provider = makeProviderWithToolCall();

    const orchestrator = new ModeBOrchestrator({
      provider,
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
    });

    await orchestrator.processMessage(makeSession(), textParts("weather in London"));

    // Tool function should NOT have been called -- cache hit
    expect(toolFn).not.toHaveBeenCalled();
  });

  it("executes tool on cache miss (different args)", async () => {
    // Cache London, but request Paris
    toolCache.set("get_weather", { city: "London" }, "sunny, 20C", 60);

    let callCount = 0;
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            parts: textParts("thinking..."),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [{ id: "tc-1", name: "get_weather", input: { city: "Paris" } }],
            stopReason: "tool_use",
          };
        }
        return {
          parts: textParts("done"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        };
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };

    const parisFn = vi.fn().mockResolvedValue("cloudy, 15C");

    const orchestrator = new ModeBOrchestrator({
      provider,
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", parisFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
    });

    await orchestrator.processMessage(makeSession(), textParts("weather in Paris"));

    // Different args -- should execute
    expect(parisFn).toHaveBeenCalledTimes(1);
    // Both entries should be cached now
    expect(toolCache.size).toBe(2);
  });

  it("emits tool_cache_hit event on cache hit", async () => {
    toolCache.set("get_weather", { city: "London" }, "sunny, 20C", 60);

    const provider = makeProviderWithToolCall();
    const eventBus = new EventBus(100);
    const emitSpy = vi.spyOn(eventBus, "emit");

    const orchestrator = new ModeBOrchestrator({
      provider,
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
      eventBus,
    });

    await orchestrator.processMessage(makeSession(), textParts("weather in London"));

    const cacheHitEvents = emitSpy.mock.calls.filter((c) => c[0].type === "tool_cache_hit");
    expect(cacheHitEvents).toHaveLength(1);
    expect(cacheHitEvents[0]![0]).toMatchObject({
      type: "tool_cache_hit",
      toolName: "get_weather",
      cacheTtl: 60,
    });
  });

  it("does not cache when capability has no cacheTtl", async () => {
    const provider = makeProviderWithToolCall();

    const orchestrator = new ModeBOrchestrator({
      provider,
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(), // no cacheTtl
      toolCache,
    });

    await orchestrator.processMessage(makeSession(), textParts("weather in London"));

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(toolCache.size).toBe(0);
  });

  it("works without toolCache (backward compatible)", async () => {
    const provider = makeProviderWithToolCall();

    const orchestrator = new ModeBOrchestrator({
      provider,
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      // No toolCache
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("weather in London"));

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(result.queued).toBe(false);
  });

  it("does not emit tool_called event on cache hit", async () => {
    toolCache.set("get_weather", { city: "London" }, "sunny, 20C", 60);

    const provider = makeProviderWithToolCall();
    const eventBus = new EventBus(100);
    const emitSpy = vi.spyOn(eventBus, "emit");

    const orchestrator = new ModeBOrchestrator({
      provider,
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
      eventBus,
    });

    await orchestrator.processMessage(makeSession(), textParts("weather in London"));

    // tool_called should NOT be emitted on cache hit (cache check is before emitToolCalled)
    const toolCalledEvents = emitSpy.mock.calls.filter((c) => c[0].type === "tool_called");
    expect(toolCalledEvents).toHaveLength(0);
  });
});

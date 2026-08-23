import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
  type ProviderAdapter,
  resolveCommunicationIntent,
  ToolCache,
  type ToolDefinition,
} from "@kilnai/core/agents";
import { sha256ContentIdentity } from "@kilnai/core/content-addressing";
import { type ActionEffectEnvelope, type Capability, textParts } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { measureProviderRequestRegions } from "../../src/session/runtime-session-orchestrator-telemetry.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { createFixtureClaimConfig, createFixtureToolPermission } from "./runtime-claim-fixture.js";

const READ_ONLY_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["external-system"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "authenticated",
  consequences: [],
  idempotency: "idempotent",
};

function makeSession(): RuntimeSession {
  return new RuntimeSession({ appName: "app", tenantId: "test-tenant", userId: "user-1", systemPrompt: "Be helpful." });
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
    effectEnvelope: READ_ONLY_EFFECT,
    cacheTtl,
  };
  return new Map([["get_weather", cap]]);
}

const TOOL_DEF: ToolDefinition = {
  name: "get_weather",
  description: "Gets weather",
  inputSchema: {},
  tags: new Set(),
};

function claimConfig(session: RuntimeSession, provider: ProviderAdapter, extra: Record<string, unknown> = {}) {
  return {
    ...createFixtureClaimConfig({
      session,
      provider,
      toolPermissions: [createFixtureToolPermission("get_weather")],
    }),
    ...extra,
  };
}

describe("RuntimeSessionOrchestrator - Tool Result Caching", () => {
  let toolCache: ToolCache;
  let toolFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toolCache = new ToolCache();
    toolFn = vi.fn().mockResolvedValue("sunny, 20C");
  });

  it("executes tool normally on first call and caches result", async () => {
    const provider = makeProviderWithToolCall();
    const currentSession = makeSession();

    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
    });

    await orchestrator.processMessage(currentSession, textParts("weather in London"), undefined, undefined, claimConfig(currentSession, provider));

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(toolCache.size).toBe(1);

    // Verify the cached value
    const cached = toolCache.get("get_weather", { city: "London" });
    expect(cached).toBe("sunny, 20C");
  });

  it("records reconciled provider request evidence for every tool round", async () => {
    const provider = makeProviderWithToolCall();
    const currentSession = makeSession();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
    });

    const result = await orchestrator.processMessage(
      currentSession,
      textParts("weather in London"),
      undefined,
      undefined,
      {
        ...claimConfig(currentSession, provider),
        communicationIntent: resolveCommunicationIntent([{
          source: "project",
          intent: { locale: "en-GB", requiredContent: ["verification"], onUnsupported: "omit" },
        }]),
      },
    );

    expect(result.providerRequests).toEqual([
      expect.objectContaining({
        requestIndex: 0,
        inputTokens: 100,
        outputTokens: 50,
        cumulativeInputTokens: 100,
        cumulativeOutputTokens: 50,
        toolCount: 1,
        stopReason: "tool_use",
      }),
      expect.objectContaining({
        requestIndex: 1,
        inputTokens: 100,
        outputTokens: 50,
        cumulativeInputTokens: 200,
        cumulativeOutputTokens: 100,
        toolCount: 1,
        stopReason: "end_turn",
      }),
    ]);
    expect(result.providerRequests?.[0]?.systemBytes).toBeGreaterThan(0);
    expect(result.providerRequests?.map((request) => request.communicationResolution?.identity)).toEqual([
      result.communicationResolution?.identity,
      result.communicationResolution?.identity,
    ]);
    expect(result.providerRequests?.[0]?.messageBytes).toBeGreaterThan(0);
    expect(result.providerRequests?.[0]?.toolSchemaBytes).toBeGreaterThan(0);
    expect(result.providerRequests?.[0]?.systemHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.providerRequests?.[0]?.effectivePrompt?.finalPromptHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const sentSystem = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0].system;
    expect(result.providerRequests?.[0]?.effectivePrompt?.finalPromptHash).toBe(
      `sha256:${createHash("sha256").update(sentSystem).digest("hex")}`,
    );
    expect(result.providerRequests?.[0]?.effectivePrompt?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sha256ContentIdentity("runtime-base-prompt"), scope: "static" }),
      expect.objectContaining({ id: sha256ContentIdentity("runtime-routing-suffix"), scope: "dynamic" }),
    ]));
    expect(JSON.stringify(result.providerRequests?.[0]?.effectivePrompt)).not.toContain("Be helpful.");
    expect(result.providerRequests?.[0]?.messageHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.providerRequests?.[0]?.toolSchemaHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.providerRequests?.[0]?.stablePrefixHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.providerRequests?.[0]?.stablePrefixBytes).toBeGreaterThan(0);
    expect(result.providerRequests?.[0]?.stablePrefixRegionCount).toBe(2);
    expect(result.providerRequests?.[0]?.volatileRegionBytes).toBe(result.providerRequests?.[0]?.messageBytes);
    expect(result.providerRequests?.[0]?.cacheRegions.map((region) => ({
      source: region.source,
      stability: region.stability,
      includedInStablePrefix: region.includedInStablePrefix,
    }))).toEqual([
      { source: "tool_schema", stability: "stable", includedInStablePrefix: true },
      { source: "system", stability: "stable", includedInStablePrefix: true },
      { source: "messages", stability: "volatile", includedInStablePrefix: false },
    ]);
    expect(result.providerRequests?.[0]?.cacheRegions)
      .toEqual(expect.not.arrayContaining([expect.objectContaining({ serialized: expect.any(String) })]));
    expect(result.providerRequests?.[0]?.cachePartition.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.providerRequests?.[0]?.cachePartition.dimensions.map((dimension) => dimension.source))
      .toEqual(["tenant", "route", "policy", "authority"]);
    expect(result.providerRequests?.[0]?.cachePartition.dimensions.every((dimension) =>
      /^sha256:[a-f0-9]{64}$/u.test(dimension.hash)
    )).toBe(true);
    expect(JSON.stringify(result.providerRequests?.[0]?.cachePartition)).not.toContain("test-tenant");
    expect(result.providerRequests?.[1]?.stablePrefixHash).toBe(result.providerRequests?.[0]?.stablePrefixHash);
    expect(result.providerRequests?.[1]?.cachePartition.hash).toBe(result.providerRequests?.[0]?.cachePartition.hash);
    expect(result.providerRequests?.[1]?.messageHash).not.toBe(result.providerRequests?.[0]?.messageHash);
    expect(result.providerRequests?.[1]?.messageBytes).toBeGreaterThan(
      result.providerRequests?.[0]?.messageBytes ?? 0,
    );
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(100);
  });

  it("partitions identical stable prefixes by tenant route policy and authority", () => {
    const base = {
      system: "stable system",
      messages: [{ role: "user", parts: [{ type: "text", text: "volatile turn" }] }],
      tools: [{ name: "stable_tool" }],
      toolCount: 1,
      cachePartition: {
        tenantId: "tenant-a",
        provider: "codex-oauth",
        model: "gpt-5.5",
        policyIdentity: { version: "policy-v1" },
        authority: {
          requestedAuthority: "read_only",
          admittedAuthority: "read_only",
          sourcePolicy: "runtime_surface_projection",
        },
      },
    } as const;
    const tenantB = measureProviderRequestRegions({
      ...base,
      cachePartition: { ...base.cachePartition, tenantId: "tenant-b" },
    });
    const routeB = measureProviderRequestRegions({
      ...base,
      cachePartition: { ...base.cachePartition, model: "kimi-k2.7-code" },
    });
    const policyB = measureProviderRequestRegions({
      ...base,
      cachePartition: { ...base.cachePartition, policyIdentity: { version: "policy-v2" } },
    });
    const authorityB = measureProviderRequestRegions({
      ...base,
      cachePartition: {
        ...base.cachePartition,
        authority: {
          requestedAuthority: "destructive",
          admittedAuthority: "fail_closed",
          sourcePolicy: "provider_profile_gate",
        },
      },
    });
    const original = measureProviderRequestRegions(base);

    expect(tenantB.stablePrefixHash).toBe(original.stablePrefixHash);
    expect(routeB.stablePrefixHash).toBe(original.stablePrefixHash);
    expect(policyB.stablePrefixHash).toBe(original.stablePrefixHash);
    expect(authorityB.stablePrefixHash).toBe(original.stablePrefixHash);
    expect(new Set([
      original.cachePartition.hash,
      tenantB.cachePartition.hash,
      routeB.cachePartition.hash,
      policyB.cachePartition.hash,
      authorityB.cachePartition.hash,
    ])).toHaveLength(5);
  });

  it("partitions provider requests by the approved context policy selection", async () => {
    const baselineProvider = makeProviderWithToolCall();
    const baselineSession = makeSession();
    const baseline = await new RuntimeSessionOrchestrator({ provider: baselineProvider, model: "unknown", tools: [TOOL_DEF], builtinTools: new Map([["get_weather", toolFn]]), capabilityMap: makeCapabilityMap(60) }).processMessage(
      baselineSession,
      textParts("same input"),
      undefined,
      undefined,
      claimConfig(baselineSession, baselineProvider, { contextPolicy: { policyId: "context-whole-block-v1", configurationHash: `sha256:${"a".repeat(64)}`, contextAllocationMode: "whole-block" } }),
    );
    const candidateProvider = makeProviderWithToolCall();
    const candidateSession = makeSession();
    const candidate = await new RuntimeSessionOrchestrator({ provider: candidateProvider, model: "unknown", tools: [TOOL_DEF], builtinTools: new Map([["get_weather", toolFn]]), capabilityMap: makeCapabilityMap(60) }).processMessage(
      candidateSession,
      textParts("same input"),
      undefined,
      undefined,
      claimConfig(candidateSession, candidateProvider, { contextPolicy: { policyId: "context-segmented-v1", configurationHash: `sha256:${"b".repeat(64)}`, contextAllocationMode: "segmented" } }),
    );

    expect(candidate.providerRequests?.[0]?.stablePrefixHash).toBe(baseline.providerRequests?.[0]?.stablePrefixHash);
    expect(candidate.providerRequests?.[0]?.cachePartition.hash).not.toBe(baseline.providerRequests?.[0]?.cachePartition.hash);
  });

  it("measures only the leading contiguous stable prefix", () => {
    const evidence = measureProviderRequestRegions({
      system: "stable system",
      messages: [{ role: "user", parts: [{ type: "text", text: "volatile turn" }] }],
      tools: [{ name: "stable_tool" }],
      toolCount: 1,
      requestRegionOrder: ["system", "messages", "tool_schema"],
    });

    expect(evidence.cacheRegions.map((region) => ({
      source: region.source,
      includedInStablePrefix: region.includedInStablePrefix,
    }))).toEqual([
      { source: "system", includedInStablePrefix: true },
      { source: "messages", includedInStablePrefix: false },
      { source: "tool_schema", includedInStablePrefix: false },
    ]);
    expect(evidence.stablePrefixRegionCount).toBe(1);
    expect(evidence.stablePrefixBytes).toBe(evidence.cacheRegions[0]?.bytes);
    expect(evidence.volatileRegionBytes).toBe(
      (evidence.cacheRegions[1]?.bytes ?? 0) + (evidence.cacheRegions[2]?.bytes ?? 0),
    );
    expect(evidence.stablePrefixHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(evidence.cacheRegions.every((region) => /^sha256:[a-f0-9]{64}$/u.test(region.hash))).toBe(true);
  });

  it("returns cached result on second call without executing tool", async () => {
    // Pre-populate cache
    toolCache.set("get_weather", { city: "London" }, "sunny, 20C", 60);

    const provider = makeProviderWithToolCall();
    const currentSession = makeSession();

    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
    });

    await orchestrator.processMessage(currentSession, textParts("weather in London"), undefined, undefined, claimConfig(currentSession, provider));

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

    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", parisFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
    });
    const currentSession = makeSession();

    await orchestrator.processMessage(currentSession, textParts("weather in Paris"), undefined, undefined, claimConfig(currentSession, provider));

    // Different args -- should execute
    expect(parisFn).toHaveBeenCalledTimes(1);
    // Both entries should be cached now
    expect(toolCache.size).toBe(2);
  });

  it("emits tool_cache_hit event on cache hit", async () => {
    toolCache.set("get_weather", { city: "London" }, "sunny, 20C", 60);

    const provider = makeProviderWithToolCall();
    const currentSession = makeSession();
    const eventBus = new EventBus(100);
    const emitSpy = vi.spyOn(eventBus, "emit");

    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
      eventBus,
    });

    await orchestrator.processMessage(currentSession, textParts("weather in London"), undefined, undefined, claimConfig(currentSession, provider));

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
    const currentSession = makeSession();

    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(), // no cacheTtl
      toolCache,
    });

    await orchestrator.processMessage(currentSession, textParts("weather in London"), undefined, undefined, claimConfig(currentSession, provider));

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(toolCache.size).toBe(0);
  });

  it("works without toolCache", async () => {
    const provider = makeProviderWithToolCall();
    const currentSession = makeSession();

    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      // No toolCache
    });

    const result = await orchestrator.processMessage(currentSession, textParts("weather in London"), undefined, undefined, claimConfig(currentSession, provider));

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(result.queued).toBe(false);
  });

  it("emits correlated tool activity on cache hit", async () => {
    toolCache.set("get_weather", { city: "London" }, "sunny, 20C", 60);

    const provider = makeProviderWithToolCall();
    const currentSession = makeSession();
    const eventBus = new EventBus(100);
    const emitSpy = vi.spyOn(eventBus, "emit");

    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [TOOL_DEF],
      builtinTools: new Map([["get_weather", toolFn]]),
      capabilityMap: makeCapabilityMap(60),
      toolCache,
      eventBus,
    });

    await orchestrator.processMessage(currentSession, textParts("weather in London"), undefined, undefined, claimConfig(currentSession, provider));

    const toolCalledEvents = emitSpy.mock.calls.filter((c) => c[0].type === "tool_called");
    expect(toolCalledEvents).toHaveLength(1);
    const toolCallId = toolCalledEvents[0]?.[0].toolCallId;
    expect(toolCallId).toEqual(expect.any(String));

    const toolResultEvents = emitSpy.mock.calls.filter((c) => c[0].type === "tool_result");
    expect(toolResultEvents).toEqual([
      [expect.objectContaining({
        toolCallId,
        toolName: "get_weather",
        success: true,
      })],
    ]);
  });
});

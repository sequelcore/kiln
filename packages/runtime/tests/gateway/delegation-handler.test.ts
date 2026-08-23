import { describe, it, expect, vi } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { type AppDelegation, textParts } from "@kilnai/core/engine";
import {
  executeDelegation,
  validateResponseSchema,
  type DelegationRegistry,
  type DelegationTarget,
} from "../../src/gateway/delegation-handler.js";

function makeMockProvider(
  content = '{"recommendation":"use TypeScript"}',
): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts(content),
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeRegistry(targets: DelegationTarget[]): DelegationRegistry {
  return { targets: new Map(targets.map((t) => [t.appName, t])) };
}

function targetFromProvider(provider: ProviderAdapter, systemPrompt = "You are a helper."): DelegationTarget {
  return {
    appName: "app-b",
    systemPrompt,
    execute: ({ request }) => provider.createMessage(request),
  };
}

function makeValidDelegation(
  overrides?: Partial<AppDelegation>,
): AppDelegation {
  return {
    fromApp: "app-a",
    toApp: "app-b",
    task: "Estimate complexity",
    schema: {
      type: "object",
      required: ["recommendation"],
      properties: { recommendation: { type: "string" } },
    },
    ...overrides,
  };
}

describe("executeDelegation", () => {
  it("returns AppDelegationResult on success", async () => {
    const provider = makeMockProvider();
    const registry = makeRegistry([
      targetFromProvider(provider),
    ]);
    const delegation = makeValidDelegation();

    const result = await executeDelegation(delegation, registry);

    expect("delegationId" in result).toBe(true);
    const success = result as import("@kilnai/core").AppDelegationResult;
    expect(typeof success.delegationId).toBe("string");
    expect(success.delegationId.length).toBeGreaterThan(0);
    expect(success.fromApp).toBe("app-a");
    expect(success.toApp).toBe("app-b");
    expect(success.result).toEqual({ recommendation: "use TypeScript" });
  });

  it("result includes token usage from provider response", async () => {
    const provider = makeMockProvider();
    const registry = makeRegistry([
      targetFromProvider(provider),
    ]);

    const result = await executeDelegation(makeValidDelegation(), registry);

    expect("tokenUsage" in result).toBe(true);
    const success = result as import("@kilnai/core").AppDelegationResult;
    expect(success.tokenUsage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
    });
  });

  it("result includes durationMs > 0", async () => {
    const provider = makeMockProvider();
    const registry = makeRegistry([
      targetFromProvider(provider),
    ]);

    const result = await executeDelegation(makeValidDelegation(), registry);

    expect("durationMs" in result).toBe(true);
    const success = result as import("@kilnai/core").AppDelegationResult;
    expect(success.durationMs).toBeGreaterThan(0);
  });

  it("returns TARGET_APP_NOT_FOUND when toApp not in registry", async () => {
    const registry = makeRegistry([]);
    const delegation = makeValidDelegation();

    const result = await executeDelegation(delegation, registry);

    expect("code" in result).toBe(true);
    const error = result as import("@kilnai/core").DelegationError;
    expect(error.code).toBe("TARGET_APP_NOT_FOUND");
    expect(error.message).toContain("app-b");
    expect(error.fromApp).toBe("app-a");
    expect(error.toApp).toBe("app-b");
  });

  it("returns SCHEMA_VALIDATION_FAILED when provider returns non-JSON content", async () => {
    const provider = makeMockProvider("not json");
    const registry = makeRegistry([
      targetFromProvider(provider),
    ]);

    const result = await executeDelegation(makeValidDelegation(), registry);

    expect("code" in result).toBe(true);
    const error = result as import("@kilnai/core").DelegationError;
    expect(error.code).toBe("SCHEMA_VALIDATION_FAILED");
    expect(error.message).toContain("not valid JSON");
  });

  it("returns SCHEMA_VALIDATION_FAILED when response misses required fields", async () => {
    const provider = makeMockProvider("{}");
    const registry = makeRegistry([
      targetFromProvider(provider),
    ]);

    const result = await executeDelegation(makeValidDelegation(), registry);

    expect("code" in result).toBe(true);
    const error = result as import("@kilnai/core").DelegationError;
    expect(error.code).toBe("SCHEMA_VALIDATION_FAILED");
    expect(error.message).toContain("recommendation");
  });

  it("returns TIMEOUT when provider call takes too long", async () => {
    const slowProvider: ProviderAdapter = {
      name: "slow-mock",
      createMessage: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  parts: textParts('{"recommendation":"slow"}'),
                  inputTokens: 10,
                  outputTokens: 5,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  toolCalls: [],
                }),
              200,
            ),
          ),
      ),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };

    const registry = makeRegistry([
      targetFromProvider(slowProvider),
    ]);
    const delegation = makeValidDelegation({ timeout: 10 });

    const result = await executeDelegation(delegation, registry);

    expect("code" in result).toBe(true);
    const error = result as import("@kilnai/core").DelegationError;
    expect(error.code).toBe("TIMEOUT");
  });

  it("returns PROVIDER_ERROR when provider.createMessage throws", async () => {
    const failingProvider: ProviderAdapter = {
      name: "failing-mock",
      createMessage: vi.fn().mockRejectedValue(new Error("API unavailable")),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };

    const registry = makeRegistry([
      targetFromProvider(failingProvider),
    ]);

    const result = await executeDelegation(makeValidDelegation(), registry);

    expect("code" in result).toBe(true);
    const error = result as import("@kilnai/core").DelegationError;
    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error.message).toBe("API unavailable");
  });

  it("passes outputSchema to provider.createMessage options", async () => {
    const provider = makeMockProvider();
    const registry = makeRegistry([
      targetFromProvider(provider),
    ]);
    const delegation = makeValidDelegation();

    await executeDelegation(delegation, registry);

    expect(provider.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outputSchema: delegation.schema,
      }),
    );
  });

  it("builds system prompt containing delegation task and context", async () => {
    const provider = makeMockProvider();
    const registry = makeRegistry([
      targetFromProvider(provider, "You are a coding assistant."),
    ]);
    const delegation = makeValidDelegation({
      context: "The codebase uses TypeScript 5.6.",
    });

    await executeDelegation(delegation, registry);

    const callArgs = (provider.createMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { system: string };
    expect(callArgs.system).toContain("You are a coding assistant.");
    expect(callArgs.system).toContain("Estimate complexity");
    expect(callArgs.system).toContain("The codebase uses TypeScript 5.6.");
    expect(callArgs.system).toContain("From: app-a");
  });
});

describe("validateResponseSchema", () => {
  it("returns valid: true for object matching schema", () => {
    const result = validateResponseSchema(
      { recommendation: "use TypeScript", count: 42 },
      {
        type: "object",
        required: ["recommendation"],
        properties: {
          recommendation: { type: "string" },
          count: { type: "number" },
        },
      },
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid: false for missing required fields", () => {
    const result = validateResponseSchema(
      { other: "field" },
      {
        type: "object",
        required: ["recommendation"],
        properties: { recommendation: { type: "string" } },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("recommendation"))).toBe(true);
  });

  it("returns valid: false for wrong property types", () => {
    const result = validateResponseSchema(
      { recommendation: 123 },
      {
        type: "object",
        properties: { recommendation: { type: "string" } },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("recommendation"))).toBe(true);
    expect(result.errors.some((e) => e.includes("string"))).toBe(true);
  });

  it("returns valid: true when no required/properties in schema (permissive)", () => {
    const result = validateResponseSchema(
      { anything: "goes" },
      { type: "object" },
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

import { describe, it, expect, vi } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { type AppDelegation, textParts } from "@kilnai/core/engine";
import { Message, Task } from "@a2a-js/sdk";
import {
  executeA2ADelegation,
  executeDelegation,
  validateResponseSchema,
  type DelegationRegistry,
  type DelegationTarget,
} from "../../src/gateway/delegation-handler.js";
import { A2ATimeoutError, type A2AClientPort } from "../../src/a2a/a2a-client.js";

function a2aClientReturning(response: Message | Task): A2AClientPort {
  return {
    discoverAgent: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(response),
    cancelTask: vi.fn().mockResolvedValue(undefined),
  };
}

function a2aUserMessage(): Message {
  return Message.fromJSON({
    kind: "message",
    messageId: "request-1",
    role: "ROLE_USER",
    parts: [{ kind: "text", text: "Estimate complexity" }],
  });
}

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

describe("executeA2ADelegation", () => {
  it("extracts structured data from a completed v1 Task without inventing usage", async () => {
    const task = Task.fromJSON({
      id: "task-1",
      contextId: "context-1",
      status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [{ artifactId: "artifact-1", parts: [{ kind: "data", data: { recommendation: "ship" } }] }],
    });

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(task),
    );

    expect(result).toMatchObject({ result: { recommendation: "ship" } });
    expect(result).not.toHaveProperty("tokenUsage");
  });

  it("extracts structured data from a direct v1 Message", async () => {
    const message = Message.fromJSON({
      kind: "message",
      messageId: "response-1",
      role: "ROLE_AGENT",
      parts: [{ kind: "data", data: { answer: 42 } }],
    });

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(message),
    );

    expect(result).toMatchObject({ result: { answer: 42 } });
  });

  it("rejects non-completed v1 task states", async () => {
    const task = Task.fromJSON({
      id: "task-1",
      contextId: "context-1",
      status: { state: "TASK_STATE_REJECTED", message: { kind: "message", messageId: "status-1", role: "ROLE_AGENT", parts: [{ kind: "text", text: "Not supported" }] } },
    });

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(task),
    );

    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toContain("TASK_STATE_REJECTED");
  });

  it("attempts cancellation before reporting a non-completed Task", async () => {
    const task = Task.fromJSON({
      id: "task-working",
      contextId: "context-1",
      status: { state: "TASK_STATE_WORKING" },
    });
    const events: string[] = [];
    const client: A2AClientPort = {
      discoverAgent: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(task),
      cancelTask: vi.fn().mockImplementation(async () => { events.push("cancel"); }),
    };

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      client,
    );
    events.push("reported");

    expect(events).toEqual(["cancel", "reported"]);
    expect(client.cancelTask).toHaveBeenCalledWith("https://agent.example", "task-working", 5_000);
    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("preserves the primary task-state diagnosis when best-effort cancellation fails", async () => {
    const task = Task.fromJSON({
      id: "task-working",
      contextId: "context-1",
      status: { state: "TASK_STATE_WORKING" },
    });
    const client = a2aClientReturning(task);
    vi.mocked(client.cancelTask).mockRejectedValue(new Error("credential=secret"));

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      client,
    );

    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toContain("TASK_STATE_WORKING");
    expect("message" in result && result.message).not.toContain("secret");
  });

  it("maps the typed A2A timeout to TIMEOUT without parsing its message", async () => {
    const client = a2aClientReturning(Message.fromJSON({
      kind: "message",
      messageId: "unused",
      role: "ROLE_AGENT",
      parts: [{ kind: "text", text: "unused" }],
    }));
    vi.mocked(client.sendMessage).mockRejectedValue(
      new A2ATimeoutError("a deliberately changed timeout description"),
    );

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage(), timeout: 5 },
      "app-a",
      client,
    );

    expect(result).toMatchObject({ code: "TIMEOUT", message: "A2A delegation timed out" });
  });

  it("rejects a completed Task with no artifact data", async () => {
    const task = Task.fromJSON({
      id: "task-1",
      contextId: "context-1",
      status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [],
    });

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(task),
    );

    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toContain("no extractable output");
  });

  it("rejects oversized part collections", async () => {
    const message = Message.fromJSON({
      kind: "message",
      messageId: "response-1",
      role: "ROLE_AGENT",
      parts: Array.from({ length: 65 }, (_, index) => ({ kind: "text", text: `part-${index}` })),
    });

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(message),
    );

    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toContain("part limit");
  });

  it("rejects a malformed part without content", async () => {
    const message = Message.fromJSON({
      kind: "message",
      messageId: "response-1",
      role: "ROLE_AGENT",
      parts: [{}],
    });

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(message),
    );

    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toContain("malformed part");
  });

  it("rejects cyclic structured data without leaking serialization details", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const message = Message.fromJSON({
      kind: "message",
      messageId: "response-1",
      role: "ROLE_AGENT",
      parts: [{ kind: "data", data: cyclic }],
    });

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(message),
    );

    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toBe("A2A response data exceeds structural limits");
  });

  it("rejects deeply nested and oversized structured data", async () => {
    let deep: Record<string, unknown> = {};
    for (let depth = 0; depth < 40; depth += 1) deep = { child: deep };
    const message = Message.fromJSON({
      kind: "message",
      messageId: "response-1",
      role: "ROLE_AGENT",
      parts: [{ kind: "data", data: deep }],
    });

    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(message),
    );

    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toBe("A2A response data exceeds structural limits");
  });

  it.each([
    ["deep text JSON", JSON.stringify(nestedObject(40)), "structural limits"],
    ["over-node text JSON", JSON.stringify(Object.fromEntries(Array.from({ length: 10 }, (_, group) => [`g${group}`, Array.from({ length: 1_000 }, (_, item) => ({ item }))]))), "structural limits"],
    ["over-entry text JSON", JSON.stringify(Object.fromEntries(Array.from({ length: 1_025 }, (_, item) => [`k${item}`, item]))), "structural limits"],
  ])("rejects %s before returning parsed text", async (_name, text, expected) => {
    const message = Message.fromJSON({ kind: "message", messageId: "response-1", role: "ROLE_AGENT", parts: [{ kind: "text", text }] });
    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a",
      a2aClientReturning(message),
    );
    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toContain(expected);
  });

  it("rejects excessive artifacts without flattening their parts", async () => {
    const task = Task.fromJSON({
      id: "task-1", contextId: "context-1", status: { state: "TASK_STATE_COMPLETED" },
      artifacts: Array.from({ length: 17 }, (_, index) => ({ artifactId: `artifact-${index}`, parts: [{ kind: "data", data: { index } }] })),
    });
    const result = await executeA2ADelegation(
      { type: "a2a", agentUrl: "https://agent.example", message: a2aUserMessage() },
      "app-a", a2aClientReturning(task),
    );
    expect(result).toMatchObject({ code: "PROVIDER_ERROR" });
    expect("message" in result && result.message).toContain("artifact limit");
  });
});

function nestedObject(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = {};
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

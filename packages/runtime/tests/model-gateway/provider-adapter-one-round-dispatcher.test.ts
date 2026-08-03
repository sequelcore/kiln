import { describe, expect, it, vi } from "vitest";
import {
  createAccountRef,
  type AgentResponse,
  type CreateMessageOptions,
  type ModelGatewayOneRoundDispatchInput,
  type ModelTurn,
  type ProviderAdapter,
} from "@kilnai/core";
import {
  ProviderAdapterOneRoundDispatcher,
  ProviderAdapterOneRoundError,
} from "../../src/model-gateway/provider-adapter-one-round-dispatcher.js";

const account = createAccountRef("configured:account-a:revision-a");

function turn(overrides: Partial<ModelTurn> = {}): ModelTurn {
  return {
    instructions: "base",
    history: [
      { role: "developer", parts: [{ type: "text", text: "policy" }] },
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      { role: "assistant", parts: [{ type: "tool-call", call: { kind: "function", id: "call-1", name: "lookup", input: { kind: "json-object", value: { q: "x" } } } }] },
      { role: "user", parts: [{ type: "tool-result", callId: "call-1", content: [{ type: "text", text: "found" }] }] },
    ],
    tools: [{ kind: "function", name: "lookup", description: "Lookup", inputSchema: { type: "object" } }],
    toolChoice: { kind: "tool", name: "lookup" },
    maxOutputTokens: 128,
    ...overrides,
  };
}

function input(value = turn()): ModelGatewayOneRoundDispatchInput {
  return {
    account,
    route: { providerId: "anthropic", providerModelId: "claude-test", scope: "virtual:model" },
    sessionId: "session-a",
    turn: value,
  };
}

function adapter(response?: Partial<AgentResponse>): ProviderAdapter & { createMessage: ReturnType<typeof vi.fn> } {
  return {
    name: "anthropic",
    createMessage: vi.fn(async (): Promise<AgentResponse> => ({
      parts: [{ type: "text", text: "done" }],
      inputTokens: 4,
      outputTokens: 2,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      toolCalls: [{ id: "call-2", name: "lookup", input: { q: "y" } }],
      stopReason: "tool_use",
      ...response,
    })),
    async *streamMessage() { return; },
  };
}

describe("ProviderAdapterOneRoundDispatcher", () => {
  it("rejects an executable deliberation level before provider I/O when transport is undeclared", async () => {
    const provider = adapter();
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });

    await expect(dispatcher.dispatchOneRound(input(turn({
      deliberationResolution: {
        status: "exact",
        selectedLevel: "high" as never,
        source: "route",
        capabilityEvidence: {
          sourceIdentity: "test:anthropic",
          sourceRevision: "revision-1",
          observedAt: "2026-08-02T00:00:00.000Z",
        },
      },
    })))).rejects.toMatchObject({ code: "unsupported-capability" });
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("maps the supported provider-adapter intersection and dispatches exactly once", async () => {
    const provider = adapter();
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });

    await expect(dispatcher.dispatchOneRound(input())).resolves.toEqual({
      parts: [
        { type: "text", text: "done" },
        { type: "tool-call", call: { kind: "function", id: "call-2", name: "lookup", input: { kind: "json-object", value: { q: "y" } } } },
      ],
      usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0 },
      stopReason: "tool_use",
    });
    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(provider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-a",
      system: "base\n\npolicy",
      maxTokens: 128,
      toolChoice: { type: "tool", name: "lookup" },
      messages: [
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { role: "assistant", parts: [{ type: "tool_use", id: "call-1", name: "lookup", input: { q: "x" } }] },
        { role: "user", parts: [{ type: "tool_result", toolUseId: "call-1", content: "found", contentParts: [{ type: "text", text: "found" }] }] },
      ],
    } satisfies Partial<CreateMessageOptions>));
  });

  it("treats explicit parallelToolCalls false as the portable sequential default", async () => {
    const provider = adapter();
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });

    await expect(dispatcher.dispatchOneRound(input(turn({ parallelToolCalls: false })))).resolves.toBeDefined();
    expect(provider.createMessage).toHaveBeenCalledTimes(1);
  });

  it("projects namespaced function identities into reversible provider-safe aliases", async () => {
    const createMessage = vi.fn(async (options: CreateMessageOptions): Promise<AgentResponse> => ({
      parts: [], inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      toolCalls: [{ id: "call-next", name: options.tools![1]!.name, input: {} }], stopReason: "tool_use",
    }));
    const provider: ProviderAdapter = { name: "fixture", createMessage, async *streamMessage() { return; } };
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });
    const namespaced: ModelTurn = {
      history: [{ role: "assistant", parts: [{ type: "tool-call", call: { kind: "function", namespace: "files", id: "call-prior", name: "read", input: { kind: "json-object", value: {} } } }] }],
      tools: [
        { kind: "function", namespace: "database", name: "read", inputSchema: {} },
        { kind: "function", namespace: "files", name: "read", inputSchema: {} },
      ],
      toolChoice: { kind: "tool", namespace: "files", name: "read" },
    };

    await expect(dispatcher.dispatchOneRound(input(namespaced))).resolves.toMatchObject({
      parts: [{ type: "tool-call", call: { kind: "function", namespace: "files", id: "call-next", name: "read" } }],
    });
    const sent = createMessage.mock.calls[0]![0];
    expect(sent.tools?.map((tool) => tool.name)).toHaveLength(2);
    expect(new Set(sent.tools?.map((tool) => tool.name)).size).toBe(2);
    expect(sent.tools?.every((tool) => /^kiln_ns_\d+_[A-Za-z0-9_-]+$/.test(tool.name))).toBe(true);
    expect(sent.toolChoice).toEqual({ type: "tool", name: sent.tools![1]!.name });
    expect(sent.messages[0]).toMatchObject({ parts: [{ type: "tool_use", name: sent.tools![1]!.name }] });
  });

  it.each([
    ["custom tools", { tools: [{ kind: "custom", name: "shell", grammar: { syntax: "lark", source: "start: /x/" } }] }],
    ["parallel tool calls", { parallelToolCalls: true }],
    ["response formats", { responseFormat: { kind: "json-schema", name: "out", schema: { type: "object" } } }],
    ["reasoning summaries", { reasoningSummary: "concise" }],
    ["text verbosity", { textVerbosity: "high" }],
  ])("fails closed before dispatch for unsupported %s", async (_label, overrides) => {
    const provider = adapter();
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });
    await expect(dispatcher.dispatchOneRound(input(turn(overrides as Partial<ModelTurn>))))
      .rejects.toBeInstanceOf(ProviderAdapterOneRoundError);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("fails closed on duplicate tool call ids from the raw adapter instead of projecting them", async () => {
    // The one-round bridge projects adapter-produced tool calls directly into the model-turn
    // result; identity must be validated here too, not only by the built-in adapters.
    const provider = adapter({
      toolCalls: [
        { id: "dup", name: "lookup", input: { q: "a" } },
        { id: "dup", name: "lookup", input: { q: "b" } },
      ],
    });
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });

    await expect(dispatcher.dispatchOneRound(input())).rejects.toMatchObject({
      code: "TOOL_CALL_IDENTITY_INVALID",
    });
  });

  it("rejects route and account mismatches before dispatch", async () => {
    const provider = adapter();
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });
    await expect(dispatcher.dispatchOneRound({ ...input(), route: { ...input().route, providerId: "openai" } })).rejects.toMatchObject({ code: "route-mismatch" });
    await expect(dispatcher.dispatchOneRound({ ...input(), account: createAccountRef("other") })).rejects.toMatchObject({ code: "account-mismatch" });
    expect(provider.createMessage).not.toHaveBeenCalled();
  });
});

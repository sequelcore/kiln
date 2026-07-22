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

  it.each([
    ["custom tools", { tools: [{ kind: "custom", name: "shell", grammar: { syntax: "lark", source: "start: /x/" } }] }],
    ["parallel tool calls", { parallelToolCalls: true }],
    ["response formats", { responseFormat: { kind: "json-schema", name: "out", schema: { type: "object" } } }],
    ["reasoning controls", { reasoning: { effort: "high" } }],
    ["text verbosity", { textVerbosity: "high" }],
  ])("fails closed before dispatch for unsupported %s", async (_label, overrides) => {
    const provider = adapter();
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });
    await expect(dispatcher.dispatchOneRound(input(turn(overrides as Partial<ModelTurn>))))
      .rejects.toBeInstanceOf(ProviderAdapterOneRoundError);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("rejects route and account mismatches before dispatch", async () => {
    const provider = adapter();
    const dispatcher = new ProviderAdapterOneRoundDispatcher({ account, providerId: "anthropic", adapter: provider });
    await expect(dispatcher.dispatchOneRound({ ...input(), route: { ...input().route, providerId: "openai" } })).rejects.toMatchObject({ code: "route-mismatch" });
    await expect(dispatcher.dispatchOneRound({ ...input(), account: createAccountRef("other") })).rejects.toMatchObject({ code: "account-mismatch" });
    expect(provider.createMessage).not.toHaveBeenCalled();
  });
});

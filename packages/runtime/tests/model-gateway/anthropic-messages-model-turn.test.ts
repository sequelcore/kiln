import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_MESSAGES_PROTOCOL_LIMITS,
  AnthropicMessagesProtocolError,
  parseAnthropicMessagesRequest,
} from "../../src/model-gateway/anthropic-messages-protocol.js";
import {
  AnthropicMessagesModelTurnError,
  inspectAnthropicMessagesCapabilities,
  mapAnthropicMessagesRequestToModelTurn,
  mapModelTurnResultToAnthropicMessagesEvents,
} from "../../src/model-gateway/anthropic-messages-model-turn.js";

function request(overrides: Record<string, unknown> = {}) {
  return {
    model: "claude-kiln",
    max_tokens: 256,
    stream: true,
    system: [{ type: "text", text: "governed" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "look" }, { type: "image", source: { type: "url", url: "https://example.test/image.png" } }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "inspect", input: { path: "a.ts" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", is_error: false, content: [{ type: "text", text: "ok" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } }] }] },
    ],
    tools: [{ name: "inspect", description: "Inspect", input_schema: { type: "object", properties: { path: { type: "string" } } } }],
    tool_choice: { type: "tool", name: "inspect", disable_parallel_tool_use: true },
    ...overrides,
  };
}

describe("Anthropic Messages model-turn boundary", () => {
  it("maps lossless text, tools, tool results, images, and output limits", () => {
    const parsed = parseAnthropicMessagesRequest(request());
    expect(mapAnthropicMessagesRequestToModelTurn(parsed)).toEqual({
      instructions: "governed",
      history: [
        { role: "user", parts: [{ type: "text", text: "look" }, { type: "image", source: { kind: "url", url: "https://example.test/image.png" } }] },
        { role: "assistant", parts: [{ type: "tool-call", call: { kind: "function", id: "call-1", name: "inspect", input: { kind: "json-object", value: { path: "a.ts" } } } }] },
        { role: "user", parts: [{ type: "tool-result", callId: "call-1", isError: false, content: [{ type: "text", text: "ok" }, { type: "image", source: { kind: "base64", mediaType: "image/png", data: "aGVsbG8=" } }] }] },
      ],
      tools: [{ kind: "function", name: "inspect", description: "Inspect", inputSchema: { type: "object", properties: { path: { type: "string" } } } }],
      toolChoice: { kind: "tool", name: "inspect" },
      parallelToolCalls: false,
      maxOutputTokens: 256,
    });
  });

  it("treats Anthropic's default tool mode as parallel-capable unless explicitly disabled", () => {
    const parsed = parseAnthropicMessagesRequest(request({ tool_choice: undefined }));
    expect(inspectAnthropicMessagesCapabilities(parsed)).toContain("parallel-tool-calls");
    expect(mapAnthropicMessagesRequestToModelTurn(parsed).parallelToolCalls).toBe(true);

    const serial = parseAnthropicMessagesRequest(request({ tool_choice: { type: "auto", disable_parallel_tool_use: true } }));
    expect(inspectAnthropicMessagesCapabilities(serial)).not.toContain("parallel-tool-calls");
    expect(mapAnthropicMessagesRequestToModelTurn(serial).parallelToolCalls).toBe(false);
  });

  it("preserves supported effort controls as explicit governed capabilities", () => {
    const high = parseAnthropicMessagesRequest(request({ output_config: { effort: "high" } }));
    expect(inspectAnthropicMessagesCapabilities(high)).toContain("reasoning-controls");
    expect(mapAnthropicMessagesRequestToModelTurn(high).reasoning).toEqual({ effort: "high" });

    const medium = parseAnthropicMessagesRequest(request({ output_config: { effort: "medium" } }));
    expect(inspectAnthropicMessagesCapabilities(medium)).toContain("reasoning-controls");
    expect(mapAnthropicMessagesRequestToModelTurn(medium).reasoning).toEqual({ effort: "medium" });
  });

  it.each([
    ["non-streaming", { stream: false }],
    ["thinking", { thinking: { type: "enabled", budget_tokens: 128 } }],
    ["sampling", { temperature: 0.5 }],
    ["context management", { context_management: {} }],
    ["structured output", { output_config: { effort: "high", format: { type: "json_schema", schema: {} } } }],
    ["unsupported maximum effort", { output_config: { effort: "max" } }],
    ["task budget", { output_config: { effort: "medium", task_budget: 1000 } }],
    ["server tools", { tools: [{ type: "web_search_20250305", name: "web_search" }] }],
    ["documents", { messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "eA==" } }] }] }],
    ["unsafe image URL", { messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "file:///secret" } }] }] }],
    ["non-canonical base64", { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "a" } }] }] }],
    ["cache controls", { system: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }] }],
  ])("rejects unsupported %s before mapping", (_label, override) => {
    expect(() => parseAnthropicMessagesRequest(request(override))).toThrow(AnthropicMessagesProtocolError);
  });

  it("rejects thinking/signature replay blocks instead of synthesizing signatures", () => {
    expect(() => parseAnthropicMessagesRequest(request({ messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "secret", signature: "opaque" }] }] }))).toThrow(AnthropicMessagesProtocolError);
  });

  it("bounds aggregate messages, blocks, tools, and JSON schema depth", () => {
    expect(() => parseAnthropicMessagesRequest(request({ messages: Array.from({ length: ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxMessages + 1 }, () => ({ role: "user", content: "x" })) }))).toThrow(AnthropicMessagesProtocolError);
    expect(() => parseAnthropicMessagesRequest(request({ messages: [{ role: "user", content: Array.from({ length: ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxBlocksPerMessage + 1 }, () => ({ type: "text", text: "x" })) }] }))).toThrow(AnthropicMessagesProtocolError);
    expect(() => parseAnthropicMessagesRequest(request({ tools: Array.from({ length: ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxTools + 1 }, (_, index) => ({ name: `tool-${index}`, input_schema: {} })) }))).toThrow(AnthropicMessagesProtocolError);
    let schema: Record<string, unknown> = {};
    for (let index = 0; index <= ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxJsonDepth; index++) schema = { nested: schema };
    expect(() => parseAnthropicMessagesRequest(request({ tools: [{ name: "deep", input_schema: schema }] }))).toThrow(AnthropicMessagesProtocolError);
  });

  it("projects text and function calls to the mandatory Anthropic SSE sequence with cache usage", () => {
    const events = mapModelTurnResultToAnthropicMessagesEvents({
      messageId: "msg_kiln_1", model: "claude-kiln",
      result: {
        parts: [
          { type: "text", text: "done" },
          { type: "tool-call", call: { kind: "function", id: "call-2", name: "inspect", input: { kind: "json-object", value: { path: "b.ts" } } } },
        ],
        usage: { inputTokens: 9, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 2 },
        stopReason: "tool_use",
      },
    });
    expect(events.map((event) => event.event)).toEqual([
      "message_start", "content_block_start", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop",
    ]);
    expect(events[0]?.data).toMatchObject({ message: { usage: { input_tokens: 9, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } });
    expect(events[5]?.data).toMatchObject({ delta: { type: "input_json_delta", partial_json: "{\"path\":\"b.ts\"}" } });
  });

  it("fails projection for result parts Anthropic Messages cannot represent", () => {
    expect(() => mapModelTurnResultToAnthropicMessagesEvents({
      messageId: "msg_kiln_1", model: "claude-kiln",
      result: { parts: [{ type: "reasoning-summary", text: "hidden" }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" },
    })).toThrow(AnthropicMessagesModelTurnError);
  });
});

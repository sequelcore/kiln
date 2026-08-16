import { describe, expect, it } from "vitest";
import type { ModelTurnResult } from "@kilnai/core/agents";
import {
  OpenAIResponsesModelTurnError,
  inspectOpenAIResponsesModelTurnCapabilities,
  mapModelTurnResultToOpenAIResponsesEvents,
  mapOpenAIResponsesRequestToModelTurn,
  preflightOpenAIResponsesModelTurn,
} from "../../src/gateway/openai-responses-model-turn.js";
import { parseOpenAIResponsesRequest } from "../../src/gateway/openai-responses-protocol.js";

const rawCustomInput = "*** Begin Patch\r\n+ synthetic\r\n*** End Patch";

function richRequest() {
  return parseOpenAIResponsesRequest({
    model: "gpt-5-codex",
    instructions: "Keep the result concise.",
    input: [
      { type: "message", role: "developer", content: "Use declared tools." },
      { type: "message", role: "user", content: [
        { type: "input_text", text: "Inspect this." },
        { type: "input_image", image_url: "https://example.test/image.png" },
        { type: "input_image", image_url: "data:image/png;base64,QUJD" },
      ] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Working.", annotations: [] }] },
      { type: "function_call", id: "fc_prior", call_id: "call_fn", name: "lookup", arguments: "{\"id\":7}" },
      { type: "function_call_output", call_id: "call_fn", output: [{ type: "input_text", text: "found" }, { type: "input_image", image_url: "data:image/png;base64,REVG" }] },
      { type: "custom_tool_call", id: "ctc_prior", call_id: "call_custom", name: "apply_patch", input: rawCustomInput },
      { type: "custom_tool_call_output", call_id: "call_custom", output: "patched" },
    ],
    tools: [
      { type: "function", name: "lookup", description: "Lookup", parameters: { type: "object", properties: { id: { type: "number" } } }, strict: true },
      { type: "custom", name: "apply_patch", description: "Patch", format: { type: "grammar", syntax: "lark", definition: "start: PATCH" } },
    ],
    tool_choice: { type: "custom", name: "apply_patch" },
    parallel_tool_calls: true,
    reasoning: { effort: "high", summary: "concise" },
    text: { verbosity: "low", format: { type: "json_schema", name: "answer", schema: { type: "object" }, strict: true } },
    include: ["reasoning.encrypted_content"], stream_options: { reasoning_summary_delivery: "sequential_cutoff" },
    stream: true, store: false,
  });
}

describe("OpenAI Responses to ModelTurn anti-corruption mapping", () => {
  it("preserves supported text, images, tools, controls, calls, and matched outputs", () => {
    const turn = mapOpenAIResponsesRequestToModelTurn(richRequest());
    expect(turn).toEqual({
      instructions: "Keep the result concise.",
      history: [
        { role: "developer", parts: [{ type: "text", text: "Use declared tools." }] },
        { role: "user", parts: [
          { type: "text", text: "Inspect this." },
          { type: "image", source: { kind: "url", url: "https://example.test/image.png" } },
          { type: "image", source: { kind: "base64", mediaType: "image/png", data: "QUJD" } },
        ] },
        { role: "assistant", parts: [{ type: "text", text: "Working." }] },
        { role: "assistant", parts: [{ type: "tool-call", call: { kind: "function", id: "call_fn", name: "lookup", input: { kind: "json-object", value: { id: 7 } } } }] },
        { role: "user", parts: [{ type: "tool-result", callId: "call_fn", content: [{ type: "text", text: "found" }, { type: "image", source: { kind: "base64", mediaType: "image/png", data: "REVG" } }] }] },
        { role: "assistant", parts: [{ type: "tool-call", call: { kind: "custom", id: "call_custom", name: "apply_patch", input: { kind: "raw-text", value: rawCustomInput } } }] },
        { role: "user", parts: [{ type: "tool-result", callId: "call_custom", content: [{ type: "text", text: "patched" }] }] },
      ],
      tools: [
        { kind: "function", name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: { id: { type: "number" } } }, strict: true },
        { kind: "custom", name: "apply_patch", description: "Patch", grammar: { syntax: "lark", source: "start: PATCH" } },
      ],
      toolChoice: { kind: "tool", name: "apply_patch" }, parallelToolCalls: true,
      responseFormat: { kind: "json-schema", name: "answer", schema: { type: "object" }, strict: true },
      reasoning: { effort: "high", summary: "concise" },
      textVerbosity: "low",
    });
  });

  it("maps the OpenCode output-token limit into the neutral turn", () => {
    const request = parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [{ role: "user", content: "hello" }],
      max_output_tokens: 4096,
      stream: true,
      store: false,
    });

    expect(mapOpenAIResponsesRequestToModelTurn(request).maxOutputTokens).toBe(4096);
  });

  it("normalizes Codex direct-tool reasoning none without requiring provider reasoning transport", () => {
    const request = parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", name: "shell_command", parameters: { type: "object" }, strict: true }],
      reasoning: { effort: "none" },
      stream: true,
      store: false,
    });

    const summary = inspectOpenAIResponsesModelTurnCapabilities(request);
    expect(summary.required).toEqual(["text", "function-tools"]);
    expect(mapOpenAIResponsesRequestToModelTurn(request)).not.toHaveProperty("reasoning");
  });

  it("omits Codex-only chat metadata from the protocol-neutral ModelTurn", () => {
    const request = parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [
        { type: "message", role: "assistant", content: "Tool failed.", internal_chat_message_metadata_passthrough: { state: "failed" } },
        { type: "function_call", call_id: "call-failed", name: "shell", arguments: "{}", internal_chat_message_metadata_passthrough: { state: "failed" } },
        { type: "function_call_output", call_id: "call-failed", output: "exit 1", internal_chat_message_metadata_passthrough: { state: "failed" } },
      ],
      stream: true,
      store: false,
    });

    const turn = mapOpenAIResponsesRequestToModelTurn(request);
    expect(JSON.stringify(turn)).not.toContain("internal_chat_message_metadata_passthrough");
    expect(turn.history).toEqual([
      { role: "assistant", parts: [{ type: "text", text: "Tool failed." }] },
      { role: "assistant", parts: [{ type: "tool-call", call: { kind: "function", id: "call-failed", name: "shell", input: { kind: "json-object", value: {} } } }] },
      { role: "user", parts: [{ type: "tool-result", callId: "call-failed", content: [{ type: "text", text: "exit 1" }] }] },
    ]);
  });

  it("preserves namespace identity for grouped Codex function tools and calls", () => {
    const request = parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [{ type: "function_call", call_id: "call-read", namespace: "workspace", name: "read", arguments: "{}" }],
      tools: [{
        type: "namespace",
        name: "workspace",
        description: "Workspace operations",
        tools: [{ type: "function", name: "read", parameters: { type: "object" }, strict: true }],
      }],
      stream: true,
      store: false,
    });

    const turn = mapOpenAIResponsesRequestToModelTurn(request);
    expect(turn.tools).toEqual([{ kind: "function", namespace: "workspace", namespaceDescription: "Workspace operations", name: "read", inputSchema: { type: "object" }, strict: true }]);
    expect(turn.history).toEqual([{ role: "assistant", parts: [{ type: "tool-call", call: { kind: "function", namespace: "workspace", id: "call-read", name: "read", input: { kind: "json-object", value: {} } } }] }]);
  });

  it("preserves namespace identity in an explicit function tool choice", () => {
    const request = parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [{ role: "user", content: "read it" }],
      tools: [{
        type: "namespace",
        name: "workspace",
        tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
      }],
      tool_choice: { type: "function", namespace: "workspace", name: "read" },
      stream: true,
      store: false,
    });

    expect(mapOpenAIResponsesRequestToModelTurn(request).toolChoice).toEqual({
      kind: "tool",
      namespace: "workspace",
      name: "read",
    });
  });

  it("omits provider-hosted web search as an evidenced optional capability", () => {
    const request = parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", name: "lookup", parameters: { type: "object" } },
        { type: "web_search", external_web_access: true, search_content_types: ["text", "image"] },
      ],
      stream: true,
      store: false,
    });

    const summary = inspectOpenAIResponsesModelTurnCapabilities(request);
    expect(summary.unsupported).toEqual([]);
    expect(summary.optionalRequested).toContain("provider-hosted-web-search");
    expect(preflightOpenAIResponsesModelTurn(request, new Set(["text", "function-tools"])).unavailableOptional)
      .toContain("provider-hosted-web-search");
    expect(mapOpenAIResponsesRequestToModelTurn(request).tools).toEqual([
      expect.objectContaining({ kind: "function", name: "lookup" }),
    ]);
  });

  it.each([
    ["unsupported-item-reference", [{ type: "item_reference", id: "msg_1" }]],
    ["unsupported-reasoning-replay", [{ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" }]],
    ["unsupported-local-shell", [{ type: "local_shell_call", id: "lsc_1", call_id: "call_1", status: "completed", action: { type: "exec", command: ["pwd"] } }, { type: "function_call_output", call_id: "call_1", output: "ok" }]],
    ["unsupported-tool-search", [{ type: "tool_search_call", id: "tsc_1", call_id: "call_1", arguments: { query: "x" }, execution: "client", status: "completed" }, { type: "tool_search_output", call_id: "call_1", tools: [], execution: "client", status: "completed" }]],
  ])("fails closed with typed code %s", (code, input) => {
    const request = parseOpenAIResponsesRequest({ model: "gpt-5-codex", input, stream: true, store: false });
    expect(() => mapOpenAIResponsesRequestToModelTurn(request)).toThrow(OpenAIResponsesModelTurnError);
    expect(() => mapOpenAIResponsesRequestToModelTurn(request)).toThrow(expect.objectContaining({ code }));
  });

  it("reports required capabilities and rejects a route before invocation", () => {
    const summary = inspectOpenAIResponsesModelTurnCapabilities(richRequest());
    expect(summary.unsupported).toEqual([]);
    expect(summary.required).toEqual(expect.arrayContaining(["text", "input-image-url", "input-image-base64", "function-tools", "custom-tools-lark", "parallel-tool-calls", "json-schema-response", "reasoning-controls", "text-verbosity"]));
    expect(summary.optionalRequested).toEqual(["reasoning-encrypted-content"]);
    expect(() => preflightOpenAIResponsesModelTurn(richRequest(), new Set(["text"]))).toThrow(expect.objectContaining({ code: "unsupported-route-capability" }));
    const degraded = preflightOpenAIResponsesModelTurn(richRequest(), new Set(summary.required));
    expect(degraded.unavailableOptional).toEqual(["reasoning-encrypted-content"]);
  });

  it("classifies declared tool_search as unsupported and rejects non-image data URLs", () => {
    const toolSearch = parseOpenAIResponsesRequest({ model: "gpt-5-codex", input: [{ type: "message", role: "user", content: "hi" }], tools: [{ type: "tool_search" }], stream: true, store: false });
    expect(inspectOpenAIResponsesModelTurnCapabilities(toolSearch).unsupported).toContainEqual({ code: "unsupported-tool-search", path: "tools[0]" });
    expect(() => mapOpenAIResponsesRequestToModelTurn(toolSearch)).toThrow(expect.objectContaining({ code: "unsupported-tool-search" }));
    const textData = parseOpenAIResponsesRequest({ model: "gpt-5-codex", input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "data:text/plain;base64,QUJD" }] }], stream: true, store: false });
    expect(() => mapOpenAIResponsesRequestToModelTurn(textData)).toThrow(expect.objectContaining({ code: "invalid-image-data-url" }));
  });

  it("rejects a legacy custom tool without the Codex Lark format at model normalization", () => {
    const request = parseOpenAIResponsesRequest({ model: "gpt-5-codex", input: [{ type: "message", role: "user", content: "hi" }], tools: [{ type: "custom", name: "legacy_freeform" }], stream: true, store: false });
    expect(() => mapOpenAIResponsesRequestToModelTurn(request)).toThrow(expect.objectContaining({ code: "unsupported-custom-tool-format", path: "tools[0].format" }));
  });
});

describe("ModelTurnResult to Responses SSE", () => {
  it("emits ordered text, function, custom lifecycles and terminal usage", () => {
    const result: ModelTurnResult = {
      parts: [
        { type: "reasoning-summary", text: "checked constraints" },
        { type: "text", text: "hello" },
        { type: "tool-call", call: { kind: "function", id: "call_fn", name: "lookup", input: { kind: "json-object", value: { id: 7 } } } },
        { type: "tool-call", call: { kind: "custom", id: "call_custom", name: "apply_patch", input: { kind: "raw-text", value: rawCustomInput } } },
      ],
      usage: { inputTokens: 8, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 }, stopReason: "tool_calls",
    };
    const events = mapModelTurnResultToOpenAIResponsesEvents({ responseId: "resp_1", model: "gpt-5-codex", result });
    expect(events.map((event) => event.type)).toEqual([
      "response.created", "response.in_progress",
      "response.output_item.added", "response.reasoning_summary_part.added", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.output_item.done",
      "response.output_item.added", "response.content_part.added", "response.output_text.delta", "response.output_text.done", "response.content_part.done", "response.output_item.done",
      "response.output_item.added", "response.function_call_arguments.delta", "response.function_call_arguments.done", "response.output_item.done",
      "response.output_item.added", "response.custom_tool_call_input.delta", "response.custom_tool_call_input.done", "response.output_item.done",
      "response.completed",
    ]);
    expect(events.find((event) => event.type === "response.custom_tool_call_input.done")?.input).toBe(rawCustomInput);
    expect(events.at(-1)?.response.usage).toEqual({ input_tokens: 8, input_tokens_details: { cached_tokens: 2 }, output_tokens: 5, total_tokens: 13 });
    expect(events.omissions).toEqual([{ code: "cache-write-tokens-not-representable", field: "usage.cacheWriteTokens", value: 1, protocolVersion: "codex-0.147.0" }]);
    expect((events.at(-1)?.response as { output: unknown[] }).output.map((item: any) => item.type)).toEqual(["reasoning", "message", "function_call", "custom_tool_call"]);
  });

  it("maps one normal Codex round through request preflight and reasoning/function/custom response", () => {
    const request = richRequest(); const summary = inspectOpenAIResponsesModelTurnCapabilities(request);
    const admitted = preflightOpenAIResponsesModelTurn(request, new Set(summary.required));
    const turn = mapOpenAIResponsesRequestToModelTurn(request);
    const result: ModelTurnResult = { parts: [
      { type: "reasoning-summary", text: "plan" }, { type: "text", text: "done" },
      { type: "tool-call", call: { kind: "function", id: "fn", name: "lookup", input: { kind: "json-object", value: { id: 7 } } } },
      { type: "tool-call", call: { kind: "custom", id: "custom", name: "apply_patch", input: { kind: "raw-text", value: rawCustomInput } } },
    ], usage: { inputTokens: 12, outputTokens: 6, cacheReadTokens: 4, cacheWriteTokens: 2 }, stopReason: "tool_calls" };
    const events = mapModelTurnResultToOpenAIResponsesEvents({ responseId: "resp_round", model: request.model, result });
    expect({ verbosity: turn.textVerbosity, degradation: admitted.unavailableOptional, output: (events.at(-1)?.response as any).output.map((item: any) => item.type), usage: events.at(-1)?.response.usage }).toEqual({
      verbosity: "low", degradation: ["reasoning-encrypted-content"], output: ["reasoning", "message", "function_call", "custom_tool_call"],
      usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 4 }, output_tokens: 6, total_tokens: 18 },
    });
    expect(events.omissions).toEqual([{ code: "cache-write-tokens-not-representable", field: "usage.cacheWriteTokens", value: 2, protocolVersion: "codex-0.147.0" }]);
  });

  it("projects namespace identity back onto Responses function-call events", () => {
    const result: ModelTurnResult = {
      parts: [{ type: "tool-call", call: { kind: "function", namespace: "workspace", id: "call-read", name: "read", input: { kind: "json-object", value: {} } } }],
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "tool_use",
    };

    const events = mapModelTurnResultToOpenAIResponsesEvents({ responseId: "resp_namespace", model: "synthetic-model", result });
    expect(events.find((event) => event.type === "response.output_item.added")?.item).toMatchObject({ namespace: "workspace", name: "read" });
    expect((events.at(-1)?.response as { output: unknown[] }).output).toEqual([expect.objectContaining({ namespace: "workspace", name: "read" })]);
  });
});

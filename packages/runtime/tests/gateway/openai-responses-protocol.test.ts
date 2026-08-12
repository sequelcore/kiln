import { describe, expect, it } from "vitest";
import {
  OPENAI_RESPONSES_PROTOCOL_LIMITS,
  OpenAIResponsesProtocolError,
  createResponsesStreamState,
  encodeSseEvent,
  parseOpenAIResponsesRequest,
} from "../../src/gateway/openai-responses-protocol.js";

describe("parseOpenAIResponsesRequest", () => {
  const request = {
    model: "gpt-5-codex",
    instructions: "Be concise.",
    input: [
      { type: "message", role: "developer", content: "Use tools carefully." },
      { type: "message", role: "user", content: [{ type: "input_text", text: "inspect" }, { type: "input_image", image_url: "https://example.test/a.png", detail: "low" }], internal_chat_message_metadata_passthrough: { turn_id: "turn-1" } },
      { type: "reasoning", id: "rsn_1", summary: [{ type: "summary_text", text: "prior reasoning" }] },
      { type: "function_call", id: "fc_1", call_id: "call_fn", name: "lookup", arguments: "{\"q\":\"x\"}" },
      { type: "function_call_output", call_id: "call_fn", output: "found" },
      { type: "custom_tool_call", id: "ctc_1", call_id: "call_custom", name: "apply_patch", input: "*** Begin Patch" },
      { type: "custom_tool_call_output", call_id: "call_custom", output: "done" },
    ],
    tools: [
      { type: "function", name: "lookup", description: "Find a record", parameters: { type: "object" } },
      { type: "custom", name: "apply_patch", description: "Patch a file", format: { type: "grammar", syntax: "lark", definition: "start: begin_patch hunk+ end_patch" } },
    ],
    tool_choice: { type: "function", name: "lookup" },
    parallel_tool_calls: true,
    reasoning: { effort: "high", summary: "auto" },
    include: ["reasoning.encrypted_content"],
    stream_options: { reasoning_summary_delivery: "sequential_cutoff" },
    text: { verbosity: "low", format: { type: "json_schema", name: "answer", schema: { type: "object" }, strict: true } },
    stream: true,
    store: false,
    prompt_cache_key: "tenant:demo",
    service_tier: "priority",
    client_metadata: {
      session_id: "018f0000-0000-7000-8000-000000000001",
      thread_id: "018f0000-0000-7000-8000-000000000002",
      turn_id: "018f0000-0000-7000-8000-000000000003",
    },
  };

  it("preserves the supported current Codex request semantics without adapter mapping", () => {
    const parsed = parseOpenAIResponsesRequest(request);
    expect(parsed).toEqual(request);
  });

  it("accepts missing custom format only at the wire parser boundary", () => {
    expect(() => parseOpenAIResponsesRequest({ model: "gpt-5-codex", input: [{ type: "message", role: "user", content: "hi" }], tools: [{ type: "custom", name: "legacy_freeform" }], stream: true, store: false })).not.toThrow();
  });

  it("bounds current Codex custom tool descriptions independently from ordinary strings", () => {
    const description = "x".repeat(OPENAI_RESPONSES_PROTOCOL_LIMITS.maxToolDescriptionLength);
    expect(() => parseOpenAIResponsesRequest({ ...request, tools: [{ type: "custom", name: "exec", description, format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } }] })).not.toThrow();
    expect(() => parseOpenAIResponsesRequest({ ...request, tools: [{ type: "custom", name: "exec", description: `${description}x`, format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } }] })).toThrow("custom tool.description exceeds");
  });

  it("accepts Codex history, item references, reasoning context, and grammar custom tools", () => {
    const parsed = parseOpenAIResponsesRequest({
      ...request,
      reasoning: { effort: "high", summary: "auto", context: "all_turns" },
      input: [
        { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "done", annotations: [] }] },
        { type: "item_reference", id: "msg_prior" },
        { type: "local_shell_call", id: "lsc_1", call_id: "shell_1", status: "completed", action: { type: "exec", command: ["pwd"], timeout_ms: 1000 } },
        { type: "function_call_output", call_id: "shell_1", output: "ok" },
        { type: "tool_search_call", id: "tsc_1", call_id: "search_1", execution: "client", status: "completed", arguments: { query: "calendar" } },
        { type: "tool_search_output", call_id: "search_1", execution: "client", status: "completed", tools: [] },
      ],
      tools: [{ type: "custom", name: "apply_patch", description: "Patch", format: { type: "grammar", syntax: "lark", definition: "start: PATCH" } }],
    });
    expect(parsed.reasoning).toEqual({ effort: "high", summary: "auto", context: "all_turns" });
    expect(parsed.input).toHaveLength(6);
  });

  it("accepts the current Codex CLI namespace and web-search tool shapes", () => {
    const parsed = parseOpenAIResponsesRequest({
      ...request,
      reasoning: null,
      tools: [
        {
          type: "namespace",
          name: "workspace",
          description: "Workspace operations",
          tools: [{
            type: "function",
            name: "read_file",
            description: "Read a workspace file",
            parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
            strict: true,
          }],
        },
        { type: "web_search", external_web_access: true },
      ],
    });

    expect(parsed.tools).toEqual([
      expect.objectContaining({ type: "namespace", name: "workspace" }),
      { type: "web_search", external_web_access: true },
    ]);
    expect(parsed.reasoning).toBeUndefined();
  });

  it("accepts namespaced function tool choice", () => {
    const parsed = parseOpenAIResponsesRequest({
      ...request,
      tool_choice: { type: "function", namespace: "workspace", name: "read_file" },
    });

    expect(parsed.tool_choice).toEqual({ type: "function", namespace: "workspace", name: "read_file" });
  });

  it("bounds expanded namespace tools independently from top-level tools", () => {
    const namespace = (name: string, count: number) => ({
      type: "namespace",
      name,
      tools: Array.from({ length: count }, (_, index) => ({
        type: "function",
        name: `tool_${index}`,
        parameters: { type: "object" },
      })),
    });

    expect(() => parseOpenAIResponsesRequest({
      ...request,
      tools: Array.from({ length: 4 }, (_, index) => namespace(`group_${index}`, 32)),
    })).not.toThrow();
    expect(() => parseOpenAIResponsesRequest({
      ...request,
      tools: [...Array.from({ length: 4 }, (_, index) => namespace(`group_${index}`, 32)), namespace("overflow", 1)],
    })).toThrow("expanded tool bound");
  });

  it("normalizes the OpenCode Responses message shorthand and output limit", () => {
    const parsed = parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [
        { role: "system", content: "Follow the operator policy." },
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
      max_output_tokens: 4096,
      stream: true,
      store: false,
    });

    expect(parsed.input).toEqual([
      { type: "message", role: "developer", content: "Follow the operator policy." },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
    expect(parsed.max_output_tokens).toBe(4096);
  });

  it("accepts bounded current Codex turn metadata", () => {
    expect(() => parseOpenAIResponsesRequest({
      ...request,
      client_metadata: { "x-codex-turn-metadata": "x".repeat(588) },
    })).not.toThrow();
    expect(() => parseOpenAIResponsesRequest({
      ...request,
      client_metadata: { "x-codex-turn-metadata": "x".repeat(4097) },
    })).toThrow("client_metadata exceeds documented bounds");
  });

  it("accepts a bounded OpenCode system prompt larger than 64 KiB", () => {
    expect(() => parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [{ role: "system", content: "x".repeat(71_879) }],
      stream: true,
      store: false,
    })).not.toThrow();
    expect(() => parseOpenAIResponsesRequest({
      model: "synthetic-model",
      input: [{ role: "system", content: "x".repeat(262_145) }],
      stream: true,
      store: false,
    })).toThrow("message content exceeds");
  });

  it("returns a detached plain-data snapshot", () => {
    const source = structuredClone(request);
    const parsed = parseOpenAIResponsesRequest(source);
    expect(parsed).not.toBe(source);
    (source.input[0] as { content: string }).content = "mutated";
    expect((parsed.input as Array<{ content?: string }>)[0]?.content).toBe("Use tools carefully.");
  });

  it("accepts a realistically bounded inline image", () => {
    const image = `data:image/png;base64,${"A".repeat(1_200_000)}`;
    expect(() => parseOpenAIResponsesRequest({ ...request, input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: image }] }] })).not.toThrow();
  });

  it("accepts structured function and custom tool outputs with text and images", () => {
    expect(() => parseOpenAIResponsesRequest({
      ...request,
      input: [
        { type: "function_call", call_id: "fn", name: "lookup", arguments: "{}" },
        { type: "function_call_output", call_id: "fn", output: [{ type: "input_text", text: "found" }, { type: "input_image", image_url: "data:image/png;base64,QUJD" }] },
        { type: "custom_tool_call", call_id: "custom", name: "patch", input: "patch" },
        { type: "custom_tool_call_output", call_id: "custom", output: [{ type: "input_text", text: "patched" }] },
      ],
    })).not.toThrow();
  });

  it("rejects aggregate inline-image content above the request budget", () => {
    const image = `data:image/png;base64,${"A".repeat(27 * 1024 * 1024)}`;
    const input = [0, 1].map(() => ({ type: "message", role: "user", content: [{ type: "input_image", image_url: image }] }));
    expect(() => parseOpenAIResponsesRequest({ ...request, input })).toThrow("aggregate request budget");
  });

  it("rejects excessively wide portable structures", () => {
    const schema = { enum: Array.from({ length: OPENAI_RESPONSES_PROTOCOL_LIMITS.maxPortableNodes + 1 }, () => 1) };
    expect(() => parseOpenAIResponsesRequest({ ...request, text: { format: { type: "json_schema", name: "wide", schema, strict: true } } })).toThrow("portable node count");
  });

  it.each([
    [{ ...request, ignored: true }, "unknown top-level field"],
    [{ ...request, stream: false }, "stream=true"],
    [{ ...request, store: true }, "store=false"],
    [{ ...request, base_url: "https://evil.test" }, "unknown top-level field"],
    [{ ...request, headers: { authorization: "synthetic" } }, "unknown top-level field"],
    [{ ...request, input: [{ type: "computer_call" }] }, "unsupported input item type"],
    [{ ...request, input: [{ type: "function_call", call_id: "a", name: "x", arguments: "{" }] }, "valid JSON"],
    [{ ...request, input: [{ type: "function_call", call_id: "same", name: "x", arguments: "{}" }, { type: "custom_tool_call", call_id: "same", name: "x", input: "x" }] }, "duplicate call_id"],
    [{ ...request, tools: [{ type: "web_search" }] }, "external_web_access"],
    [{ ...request, model: "x".repeat(65_537) }, "model exceeds"],
    [{ ...request, input: [{ type: "function_call_output", call_id: "missing", output: "x" }] }, "matching earlier call"],
    [{ ...request, input: [{ type: "custom_tool_call", call_id: "call_1", name: "x", input: "x" }, { type: "function_call_output", call_id: "call_1", output: "x" }] }, "matching function"],
    [{ ...request, input: [{ type: "function_call", call_id: "call_1", name: "x", arguments: "{}" }, { type: "function_call_output", call_id: "call_1", output: "x" }, { type: "function_call_output", call_id: "call_1", output: "again" }] }, "duplicate tool output"],
    [{ ...request, tools: [{ type: "custom", name: "x", format: { type: "grammar", syntax: "regex", definition: ".*" } }] }, "syntax"],
    [{ ...request, stream_options: { reasoning_summary_delivery: "parallel" } }, "reasoning_summary_delivery"],
  ])("rejects unsafe or unsupported input: %s", (input, message) => {
    expect(() => parseOpenAIResponsesRequest(input)).toThrow(OpenAIResponsesProtocolError);
    expect(() => parseOpenAIResponsesRequest(input)).toThrow(message);
  });

  it("rejects exotic prototypes and accessor-backed input", () => {
    expect(() => parseOpenAIResponsesRequest(Object.create({ model: "gpt-5-codex" }))).toThrow("plain data object");
    const accessor = { ...request } as Record<string, unknown>;
    Object.defineProperty(accessor, "model", { enumerable: true, get: () => "gpt-5-codex" });
    expect(() => parseOpenAIResponsesRequest(accessor)).toThrow("data properties");
  });

  it("rejects accessor, symbol, sparse, and custom properties on arrays", () => {
    const accessorArray = [...request.input] as unknown[];
    Object.defineProperty(accessorArray, "0", { enumerable: true, get: () => request.input[0] });
    expect(() => parseOpenAIResponsesRequest({ ...request, input: accessorArray })).toThrow("data entries");

    const symbolArray = [...request.input] as unknown[] & Record<symbol, unknown>;
    symbolArray[Symbol("hidden")] = "x";
    expect(() => parseOpenAIResponsesRequest({ ...request, input: symbolArray })).toThrow("string keys");

    const sparseArray = new Array(1);
    expect(() => parseOpenAIResponsesRequest({ ...request, input: sparseArray })).toThrow("dense");

    const customArray = [...request.input] as unknown[] & { hidden?: string };
    customArray.hidden = "x";
    expect(() => parseOpenAIResponsesRequest({ ...request, input: customArray })).toThrow("index properties");
  });
});

describe("Responses SSE builders", () => {
  it("emits stable IDs, typed tool events, mandatory usage totals, and one terminal event", () => {
    const stream = createResponsesStreamState({ responseId: "resp_synthetic", model: "gpt-5-codex" });
    const created = stream.created();
    const inProgress = stream.inProgress();
    const message = stream.messageAdded("msg_synthetic", 0);
    const partAdded = stream.outputTextPartAdded("msg_synthetic", 0);
    const delta = stream.outputTextDelta("msg_synthetic", 0, "hello");
    const textDone = stream.outputTextDone("msg_synthetic", 0, "hello");
    const partDone = stream.outputTextPartDone("msg_synthetic", 0, "hello");
    const messageDone = stream.outputItemDone({ itemId: "msg_synthetic", outputIndex: 0, item: { id: "msg_synthetic", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hello", annotations: [] }] } });
    const functionCall = stream.functionCallAdded({ itemId: "fc_synthetic", callId: "call_fn", name: "lookup", outputIndex: 1 });
    const fnDelta = stream.functionCallArgumentsDelta("fc_synthetic", 1, "{}");
    const fnDone = stream.functionCallArgumentsDone("fc_synthetic", 1, "{}");
    stream.outputItemDone({ itemId: "fc_synthetic", outputIndex: 1, item: { id: "fc_synthetic", type: "function_call", call_id: "call_fn", name: "lookup", arguments: "{}", status: "completed" } });
    const customCall = stream.customToolCallAdded({ itemId: "ctc_synthetic", callId: "call_custom", name: "apply_patch", outputIndex: 2 });
    const customDelta = stream.customToolCallInputDelta("ctc_synthetic", 2, "patch");
    const customDone = stream.customToolCallInputDone("ctc_synthetic", 2, "patch");
    stream.outputItemDone({ itemId: "ctc_synthetic", outputIndex: 2, item: { id: "ctc_synthetic", type: "custom_tool_call", call_id: "call_custom", name: "apply_patch", input: "patch", status: "completed" } });
    const done = stream.completed({ input_tokens: 3, output_tokens: 5, total_tokens: 8 });

    expect(created.response.id).toBe("resp_synthetic");
    expect(message.item.id).toBe("msg_synthetic");
    expect(inProgress.type).toBe("response.in_progress");
    expect(partAdded.type).toBe("response.content_part.added");
    expect(delta.type).toBe("response.output_text.delta");
    expect(textDone.type).toBe("response.output_text.done");
    expect(partDone.type).toBe("response.content_part.done");
    expect(messageDone.type).toBe("response.output_item.done");
    expect(functionCall.item.type).toBe("function_call");
    expect(customCall.item.type).toBe("custom_tool_call");
    expect(fnDelta.type).toBe("response.function_call_arguments.delta");
    expect(fnDone.type).toBe("response.function_call_arguments.done");
    expect(customDelta.type).toBe("response.custom_tool_call_input.delta");
    expect(customDone.type).toBe("response.custom_tool_call_input.done");
    expect(done.response.usage).toEqual({ input_tokens: 3, output_tokens: 5, total_tokens: 8 });
    expect(encodeSseEvent(created)).toBe(`event: response.created\ndata: ${JSON.stringify(created)}\n\n`);
    expect(() => stream.failed("internal_error")).toThrow("terminal");
  });

  it("requires a consistent mandatory usage total", () => {
    const stream = createResponsesStreamState({ responseId: "resp_synthetic", model: "gpt-5-codex" });
    stream.created(); stream.inProgress();
    expect(() => stream.completed({ input_tokens: 3, output_tokens: 5, total_tokens: 7 })).toThrow("total_tokens");
  });

  it("retains detached completed items in terminal output order", () => {
    const stream = createResponsesStreamState({ responseId: "resp_output", model: "gpt-5-codex" });
    stream.created(); stream.inProgress();

    const messageItem = { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hello", annotations: [] }] };
    stream.messageAdded("msg_1", 0); stream.outputTextPartAdded("msg_1", 0); stream.outputTextDelta("msg_1", 0, "hello"); stream.outputTextDone("msg_1", 0, "hello"); stream.outputTextPartDone("msg_1", 0, "hello");
    const messageDone = stream.outputItemDone({ itemId: "msg_1", outputIndex: 0, item: messageItem });

    const functionItem = { id: "fc_1", type: "function_call", call_id: "call_1", name: "lookup", arguments: "{\"q\":\"x\"}", status: "completed" };
    stream.functionCallAdded({ itemId: "fc_1", callId: "call_1", name: "lookup", outputIndex: 1 }); stream.functionCallArgumentsDelta("fc_1", 1, functionItem.arguments); stream.functionCallArgumentsDone("fc_1", 1, functionItem.arguments); stream.outputItemDone({ itemId: "fc_1", outputIndex: 1, item: functionItem });

    const customItem = { id: "ctc_1", type: "custom_tool_call", call_id: "call_2", name: "apply_patch", input: "patch", status: "completed" };
    stream.customToolCallAdded({ itemId: "ctc_1", callId: "call_2", name: "apply_patch", outputIndex: 2 }); stream.customToolCallInputDelta("ctc_1", 2, "patch"); stream.customToolCallInputDone("ctc_1", 2, "patch"); stream.outputItemDone({ itemId: "ctc_1", outputIndex: 2, item: customItem });

    messageItem.content[0]!.text = "caller mutation";
    ((messageDone.item as { content: Array<{ text: string }> }).content[0]!).text = "event mutation";
    const completed = stream.completed({ input_tokens: 2, output_tokens: 3, total_tokens: 5 });

    expect(completed.response.output).toEqual([
      { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hello", annotations: [] }] },
      functionItem,
      customItem,
    ]);
    expect(completed.response.output[0]).not.toBe(messageItem);
    expect(Object.getPrototypeOf(completed.response.output[0])).toBe(Object.prototype);
  });

  it("emits and retains a Codex reasoning-summary lifecycle with cache details", () => {
    const stream = createResponsesStreamState({ responseId: "resp_reasoning", model: "gpt-5-codex" });
    stream.created(); stream.inProgress();
    const added = stream.reasoningAdded("rs_1", 0);
    const part = stream.reasoningSummaryPartAdded("rs_1", 0, 0);
    const delta = stream.reasoningSummaryTextDelta("rs_1", 0, 0, "checking");
    const done = stream.reasoningSummaryTextDone("rs_1", 0, 0, "checking");
    stream.outputItemDone({ itemId: "rs_1", outputIndex: 0, item: { id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "checking" }] } });
    const completed = stream.completed({ input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 3 } });
    expect([added.type, part.type, delta.type, done.type]).toEqual(["response.output_item.added", "response.reasoning_summary_part.added", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done"]);
    expect(completed.response.output).toEqual([{ id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "checking" }] }]);
    expect(completed.response.usage).toEqual({ input_tokens: 10, input_tokens_details: { cached_tokens: 3 }, output_tokens: 4, total_tokens: 14 });
  });

  it("enforces lifecycle order and emits canonical non-leaking failures", () => {
    const stream = createResponsesStreamState({ responseId: "resp_failed", model: "gpt-5-codex" });
    expect(() => stream.outputTextDelta("msg_1", 0, "early")).toThrow("created");
    stream.created();
    stream.inProgress();
    const failed = stream.failed("service_unavailable");
    expect(failed.error).toEqual({ code: "service_unavailable", message: "The service is temporarily unavailable." });
    expect(failed.response.error).toEqual(failed.error);
    expect(JSON.stringify(failed)).not.toContain("provider");
  });

  it("rejects mismatched or unvalidated output item completion", () => {
    const stream = createResponsesStreamState({ responseId: "resp_synthetic", model: "gpt-5-codex" });
    stream.created(); stream.inProgress(); stream.messageAdded("msg_1", 0);
    expect(() => stream.outputItemDone({ itemId: "msg_2", outputIndex: 0, item: { type: "mcp_call" } })).toThrow();
  });
});

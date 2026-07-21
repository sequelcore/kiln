import { describe, expect, it, vi } from "vitest";
import { createAccountRef, type ModelGatewayOneRoundDispatchInput, type ModelTurn } from "@kilnai/core";
import {
  CodexOAuthModelTurnDispatcher,
  CodexOAuthModelTurnError,
  CODEX_OAUTH_RESPONSES_ENDPOINT,
  encodeCodexOAuthResponsesRequest,
} from "../../src/model-gateway/codex-oauth-model-turn-dispatcher.js";

const account = createAccountRef("account-fixture");
const route = { providerId: "codex-oauth", providerModelId: "gpt-5-codex", scope: "direct" };
const raw = "*** Begin Patch\r\n+ fixture\r\n*** End Patch";

function richTurn(): ModelTurn {
  return {
    instructions: "Be concise.",
    history: [
      { role: "developer", parts: [{ type: "text", text: "Use tools." }] },
      { role: "user", parts: [{ type: "text", text: "Inspect" }, { type: "image", source: { kind: "url", url: "https://example.test/a.png" } }, { type: "image", source: { kind: "base64", mediaType: "image/png", data: "QUJD" } }] },
      { role: "assistant", parts: [{ type: "reasoning-summary", text: "Prior plan" }, { type: "text", text: "Calling." }, { type: "tool-call", call: { kind: "function", id: "fn-prior", name: "lookup", input: { kind: "json-object", value: { id: 7 } } } }] },
      { role: "user", parts: [{ type: "tool-result", callId: "fn-prior", content: [{ type: "text", text: "found" }, { type: "image", source: { kind: "base64", mediaType: "image/png", data: "REVG" } }] }] },
      { role: "assistant", parts: [{ type: "tool-call", call: { kind: "custom", id: "custom-prior", name: "apply_patch", input: { kind: "raw-text", value: raw } } }] },
      { role: "user", parts: [{ type: "tool-result", callId: "custom-prior", content: [{ type: "text", text: "patched" }] }] },
    ],
    tools: [
      { kind: "function", name: "lookup", description: "Lookup", inputSchema: { type: "object" }, strict: true },
      { kind: "custom", name: "apply_patch", description: "Patch", grammar: { syntax: "lark", source: "start: PATCH" } },
    ],
    toolChoice: { kind: "tool", name: "apply_patch" }, parallelToolCalls: true,
    reasoning: { effort: "high", summary: "concise" }, textVerbosity: "low",
    responseFormat: { kind: "json-schema", name: "answer", schema: { type: "object" }, strict: true },
  };
}

function dispatchInput(turn: ModelTurn = richTurn(), overrides: Partial<ModelGatewayOneRoundDispatchInput> = {}): ModelGatewayOneRoundDispatchInput {
  return { account, route, sessionId: "session-fixture", turn, ...overrides };
}

function sseResponse(frames: unknown[], options: { status?: number; requestId?: string; chunkSize?: number; crlf?: boolean } = {}): Response {
  const newline = options.crlf ? "\r\n" : "\n";
  const text = frames.map((frame: any) => `event: ${frame.type}${newline}data: ${JSON.stringify(frame)}${newline}${newline}`).join("");
  const bytes = new TextEncoder().encode(text); const size = options.chunkSize ?? bytes.length; let offset = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= bytes.length) return controller.close(); controller.enqueue(bytes.slice(offset, Math.min(bytes.length, offset + size))); offset += size; } });
  return new Response(body, { status: options.status ?? 200, headers: { "content-type": "text/event-stream", ...(options.requestId ? { "x-request-id": options.requestId } : {}) } });
}

const completed = (
  output: unknown[] = [],
  usage = { input_tokens: 9, input_tokens_details: { cached_tokens: 3 }, output_tokens: 4, total_tokens: 13 },
) => ({ type: "response.completed", response: { id: "resp_1", output, usage } });

const richOutput = [
  { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "checked" }] },
  { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
  { type: "function_call", id: "fc_1", call_id: "call_fn", name: "lookup", arguments: "{\"id\":7}" },
  { type: "custom_tool_call", id: "ctc_1", call_id: "call_custom", name: "apply_patch", input: raw },
];

describe("Codex OAuth outbound request codec", () => {
  it("encodes the rich turn as the pinned Responses body", () => {
    expect(encodeCodexOAuthResponsesRequest(dispatchInput())).toEqual({
      model: "gpt-5-codex", instructions: "Be concise.", prompt_cache_key: "session-fixture",
      store: false, stream: true, stream_options: { reasoning_summary_delivery: "sequential_cutoff" }, include: ["reasoning.encrypted_content"],
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "Use tools." }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Inspect" }, { type: "input_image", image_url: "https://example.test/a.png" }, { type: "input_image", image_url: "data:image/png;base64,QUJD" }] },
        { type: "reasoning", summary: [{ type: "summary_text", text: "Prior plan" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Calling." }] },
        { type: "function_call", call_id: "fn-prior", name: "lookup", arguments: "{\"id\":7}" },
        { type: "function_call_output", call_id: "fn-prior", output: [{ type: "input_text", text: "found" }, { type: "input_image", image_url: "data:image/png;base64,REVG" }] },
        { type: "custom_tool_call", call_id: "custom-prior", name: "apply_patch", input: raw },
        { type: "custom_tool_call_output", call_id: "custom-prior", output: "patched" },
      ],
      tools: [{ type: "function", name: "lookup", description: "Lookup", parameters: { type: "object" }, strict: true }, { type: "custom", name: "apply_patch", description: "Patch", format: { type: "grammar", syntax: "lark", definition: "start: PATCH" } }],
      tool_choice: { type: "custom", name: "apply_patch" }, parallel_tool_calls: true,
      reasoning: { effort: "high", summary: "concise" }, text: { verbosity: "low", format: { type: "json_schema", name: "answer", schema: { type: "object" }, strict: true } },
    });
  });

  it.each([
    ["assistant image", { history: [{ role: "assistant", parts: [{ type: "image", source: { kind: "url", url: "https://example.test/a" } }] }] }],
    ["error result", { history: [{ role: "assistant", parts: [{ type: "tool-call", call: { kind: "function", id: "c", name: "f", input: { kind: "json-object", value: {} } } }] }, { role: "user", parts: [{ type: "tool-result", callId: "c", content: [{ type: "text", text: "bad" }], isError: true }] }], tools: [{ kind: "function", name: "f", inputSchema: {} }] }],
    ["max tokens", { history: [], maxOutputTokens: 10 }],
  ])("rejects unrepresentable %s before fetch", (_label, turn) => {
    expect(() => encodeCodexOAuthResponsesRequest(dispatchInput(turn as ModelTurn))).toThrow(expect.objectContaining({ code: "unsupported-capability" }));
  });
});

describe("CodexOAuthModelTurnDispatcher", () => {
  it("posts exactly once with bound credentials and maps chunked CRLF SSE output", async () => {
    const frames = [
      { type: "response.created", response: { id: "resp_1" } },
      { type: "response.output_item.done", item: { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "checked" }] } },
      { type: "response.output_item.done", item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "hello" }] } },
      { type: "response.output_item.done", item: { type: "function_call", id: "fc_1", call_id: "call_fn", name: "lookup", arguments: "{\"id\":7}" } },
      { type: "response.output_item.done", item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_custom", name: "apply_patch", input: raw } },
      completed(richOutput),
    ];
    const fetchFn = vi.fn(async () => sseResponse(frames, { requestId: "req_safe_1", chunkSize: 3, crlf: true }));
    const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret", chatgptAccountId: "chat-account" }, fetch: fetchFn });
    const result = await dispatcher.dispatchOneRound(dispatchInput(richTurn(), { account: createAccountRef("account-fixture") }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(CODEX_OAUTH_RESPONSES_ENDPOINT);
    expect(init).toMatchObject({ method: "POST", headers: { authorization: "Bearer token-secret", "content-type": "application/json", accept: "text/event-stream", "ChatGPT-Account-ID": "chat-account" } });
    expect(result).toEqual({ parts: [
      { type: "reasoning-summary", text: "checked" }, { type: "text", text: "hello" },
      { type: "tool-call", call: { kind: "function", id: "call_fn", name: "lookup", input: { kind: "json-object", value: { id: 7 } } } },
      { type: "tool-call", call: { kind: "custom", id: "call_custom", name: "apply_patch", input: { kind: "raw-text", value: raw } } },
    ], usage: { inputTokens: 9, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 0 }, stopReason: "completed" });
  });

  it("rejects binding and capability errors without fetching", async () => {
    const fetchFn = vi.fn(); const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn as typeof fetch });
    await expect(dispatcher.dispatchOneRound(dispatchInput(richTurn(), { account: createAccountRef("other") }))).rejects.toMatchObject({ code: "account-mismatch" });
    await expect(dispatcher.dispatchOneRound(dispatchInput(richTurn(), { route: { ...route, providerId: "other" } }))).rejects.toMatchObject({ code: "route-mismatch" });
    await expect(dispatcher.dispatchOneRound(dispatchInput({ history: [], maxOutputTokens: 1 }))).rejects.toMatchObject({ code: "unsupported-capability" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["http-error", async () => new Response("sentinel-token-secret", { status: 429, headers: { "x-request-id": "req_allowlisted" } })],
    ["malformed-sse", async () => sseResponse([{ type: "response.output_item.done", item: { type: "function_call", call_id: "c", name: "f", arguments: "{" } }, completed()])],
    ["provider-failed", async () => sseResponse([{ type: "response.failed", response: { error: { message: "sentinel-token-secret" } } }])],
    ["provider-incomplete", async () => sseResponse([{ type: "response.incomplete", response: { incomplete_details: { reason: "sentinel-token-secret" } } }])],
    ["incomplete-stream", async () => sseResponse([{ type: "response.created", response: { id: "r" } }])],
  ])("fails closed once for %s without leaking provider data", async (code, responseFactory) => {
    const fetchFn = vi.fn(responseFactory); const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn });
    const error = await dispatcher.dispatchOneRound(dispatchInput()).catch((value: unknown) => value) as CodexOAuthModelTurnError;
    expect(fetchFn).toHaveBeenCalledTimes(1); expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toMatch(/sentinel-token-secret|token-secret|Be concise|Inspect/);
    if (code === "http-error") expect(error).toMatchObject({ status: 429, providerRequestId: "req_allowlisted" });
  });

  it("canonicalizes network and abort failures without retry", async () => {
    for (const aborted of [false, true]) {
      const fetchFn = vi.fn(async () => { throw new Error("sentinel-token-secret"); });
      const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn });
      const controller = new AbortController(); if (aborted) controller.abort();
      const error = await dispatcher.dispatchOneRound(dispatchInput(richTurn(), { signal: controller.signal })).catch((value: unknown) => value) as CodexOAuthModelTurnError;
      expect(fetchFn).toHaveBeenCalledTimes(aborted ? 0 : 1); expect(error.code).toBe(aborted ? "aborted" : "network-error");
      expect(JSON.stringify(error)).not.toContain("sentinel-token-secret");
    }
  });

  it.each([
    ["response-too-large", { maxBytes: 1, maxEvents: 10 }],
    ["too-many-events", { maxBytes: 10_000, maxEvents: 1 }],
  ])("enforces the bounded SSE decoder with %s", async (code, sseLimits) => {
    const fetchFn = vi.fn(async () => sseResponse([{ type: "response.created", response: { id: "r" } }, completed()]));
    const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn, sseLimits });
    await expect(dispatcher.dispatchOneRound(dispatchInput())).rejects.toMatchObject({ code });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes an abort while consuming the response stream", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      pull(stream) { controller.abort(); stream.error(new Error("sentinel-token-secret")); },
    });
    const fetchFn = vi.fn(async () => new Response(body, { status: 200 }));
    const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn });
    const error = await dispatcher.dispatchOneRound(dispatchInput(richTurn(), { signal: controller.signal })).catch((value: unknown) => value) as CodexOAuthModelTurnError;
    expect(error.code).toBe("aborted");
    expect(JSON.stringify(error)).not.toContain("sentinel-token-secret");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("ignores injected endpoint-shaped data and always posts to the official endpoint", async () => {
    const fetchFn = vi.fn(async () => sseResponse([completed()]));
    const options = { account, credential: { accessToken: "token-secret" }, fetch: fetchFn, endpoint: "https://attacker.invalid/responses" };
    const dispatcher = new CodexOAuthModelTurnDispatcher(options);
    await dispatcher.dispatchOneRound(dispatchInput({ history: [] }));
    expect(fetchFn).toHaveBeenCalledWith(CODEX_OAUTH_RESPONSES_ENDPOINT, expect.any(Object));
  });

  it("accepts terminal-only output and maps it authoritatively", async () => {
    const fetchFn = vi.fn(async () => sseResponse([completed([richOutput[1]!])]));
    const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn });
    await expect(dispatcher.dispatchOneRound(dispatchInput({ history: [] }))).resolves.toMatchObject({ parts: [{ type: "text", text: "hello" }] });
  });

  it.each([
    ["missing terminal output", [{ type: "response.completed", response: { id: "r", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]],
    ["mismatched terminal output", [{ type: "response.output_item.done", item: richOutput[1] }, completed([{ ...richOutput[1], content: [{ type: "output_text", text: "different" }] }])]],
    ["truncated terminal output", [{ type: "response.output_item.done", item: richOutput[0] }, { type: "response.output_item.done", item: richOutput[1] }, completed([richOutput[0]!])]],
    ["duplicate terminal output", [completed([richOutput[1]!, richOutput[1]!])]],
  ])("fails closed for %s", async (_label, frames) => {
    const fetchFn = vi.fn(async () => sseResponse(frames));
    const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn });
    await expect(dispatcher.dispatchOneRound(dispatchInput({ history: [] }))).rejects.toMatchObject({ code: "malformed-sse" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate streamed tool call IDs as a typed safe error", async () => {
    const frames = [
      { type: "response.output_item.done", item: { type: "function_call", id: "item_1", call_id: "duplicate_call", name: "lookup", arguments: "{}" } },
      { type: "response.output_item.done", item: { type: "function_call", id: "item_2", call_id: "duplicate_call", name: "lookup", arguments: "{}" } },
    ];
    const fetchFn = vi.fn(async () => sseResponse(frames));
    const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn });
    const error = await dispatcher.dispatchOneRound(dispatchInput({ history: [] })).catch((value: unknown) => value) as CodexOAuthModelTurnError;
    expect(error).toMatchObject({ code: "malformed-sse" });
    expect(JSON.stringify(error)).not.toContain("duplicate_call");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("wraps final core contract validation failures as typed provider errors", async () => {
    const invalidOutput = [{ type: "reasoning", id: "reasoning_invalid", summary: [{ type: "summary_text", text: "" }] }];
    const fetchFn = vi.fn(async () => sseResponse([completed(invalidOutput)]));
    const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential: { accessToken: "token-secret" }, fetch: fetchFn });
    const error = await dispatcher.dispatchOneRound(dispatchInput({ history: [] })).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CodexOAuthModelTurnError);
    expect(error).toMatchObject({ code: "malformed-sse" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CreateMessageOptions,
  ToolDefinition,
  AgentStreamEvent,
} from "../../../src/agents/index.js";
import { extractText, textParts } from "../../../src/engine/domain/content.js";
import { OpenAIAdapter, GPT4O, GPT4O_MINI, O3, O3_MINI } from "../../../src/agents/infrastructure/openai.js";
import { DeepSeekAdapter, DEEPSEEK_CHAT, DEEPSEEK_REASONER } from "../../../src/agents/infrastructure/deepseek.js";
import { getInvalidToolInputDetails } from "../../../src/agents/tool-call-input.js";

function makeOptions(
  overrides: Partial<CreateMessageOptions> = {},
): CreateMessageOptions {
  return {
    system: "You are a helpful assistant.",
    messages: [{ role: "user", parts: textParts("Hello") }],
    ...overrides,
  };
}

function makeToolDef(name = "search"): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
    },
    tags: new Set(["test"]),
  };
}

function makeOpenAIResponse(overrides: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        message: {
          content: "Hello there!",
          tool_calls: undefined,
        },
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
    },
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    body: null,
  });
}

function mockSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

describe("OpenAIAdapter", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    adapter = new OpenAIAdapter({ apiKey: "test-openai-key" });
    // Override retryOptions to use instant sleep for tests
    const originalRetryOptions = adapter.retryOptions.bind(adapter);
    vi.spyOn(adapter, "retryOptions").mockImplementation(() => ({
      ...originalRetryOptions(),
      sleep: () => Promise.resolve(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("createMessage sends correct request format", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    const tool = makeToolDef("search");
    await adapter.createMessage(makeOptions({ tools: [tool] }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer test-openai-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ]);
    expect(body.max_tokens).toBe(4096);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "search tool",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      },
    ]);
  });

  it("maps response to AgentResponse", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(makeOpenAIResponse()));

    const response = await adapter.createMessage(makeOptions());

    expect(extractText(response.parts)).toBe("Hello there!");
    expect(response.inputTokens).toBe(100);
    expect(response.outputTokens).toBe(50);
    expect(response.toolCalls).toEqual([]);
  });

  it("handles tool calls in response", async () => {
    const body = makeOpenAIResponse({
      choices: [
        {
          message: {
            content: "Let me search.",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "search",
                  arguments: '{"query":"test"}',
                },
              },
            ],
          },
        },
      ],
    });
    vi.stubGlobal("fetch", mockFetchResponse(body));

    const response = await adapter.createMessage(makeOptions());

    expect(extractText(response.parts)).toBe("Let me search.");
    expect(response.toolCalls).toEqual([
      { id: "call_123", name: "search", input: { query: "test" } },
    ]);
  });

  it("round-trips canonical dotted tool names through provider-safe function names", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_managed",
            type: "function",
            function: {
              name: "managed_agent_invoke",
              arguments: '{"agent":"scout"}',
            },
          }],
        },
      }],
    }));
    vi.stubGlobal("fetch", mockFetch);

    const response = await adapter.createMessage(makeOptions({
      tools: [makeToolDef("managed_agent.invoke")],
      toolChoice: { type: "tool", name: "managed_agent.invoke" },
    }));

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.tools[0].function.name).toBe("managed_agent_invoke");
    expect(body.tool_choice.function.name).toBe("managed_agent_invoke");
    expect(response.toolCalls).toEqual([{
      id: "call_managed",
      name: "managed_agent.invoke",
      input: { agent: "scout" },
    }]);
  });

  it("uses deterministic distinct provider names when canonical names normalize to the same value", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions({
      tools: [
        makeToolDef("memory.search"),
        makeToolDef("memory_search"),
        makeToolDef("1password.lookup"),
      ],
    }));

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
      "memory_search",
      "memory_search_2",
      "tool_1password_lookup",
    ]);
  });

  it("projects strict tool contracts only when the tool explicitly requires them", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions({
      tools: [{ ...makeToolDef("submit_handoff"), strict: true }],
    }));

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.tools[0].function).toMatchObject({
      name: "submit_handoff",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query: { type: ["string", "null"] },
        },
        required: ["query"],
        additionalProperties: false,
      },
    });
  });

  it("serializes prior tool use and tool result messages for follow-up calls", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions({
      messages: [
        { role: "user", parts: textParts("Read the fixture.") },
        {
          role: "assistant",
          parts: [
            { type: "text", text: "Reading now." },
            {
              type: "tool_use",
              id: "call_read_1",
              name: "read",
              input: { filePath: "proof.txt" },
            },
          ],
        },
        {
          role: "user",
          parts: [{
            type: "tool_result",
            toolUseId: "call_read_1",
            content: "fixture contents",
            isError: false,
          }],
        },
      ],
    }));

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.messages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Read the fixture." },
      {
        role: "assistant",
        content: "Reading now.",
        tool_calls: [{
          id: "call_read_1",
          type: "function",
          function: {
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: "call_read_1",
        content: "fixture contents",
      },
    ]);
  });

  it("replays canonical dotted tool use with the same provider-safe identity", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions({
      tools: [makeToolDef("managed_agent.invoke")],
      messages: [{
        role: "assistant",
        parts: [{
          type: "tool_use",
          id: "call_managed",
          name: "managed_agent.invoke",
          input: { agent: "scout" },
        }],
      }],
    }));

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.messages[1].tool_calls[0].function.name).toBe("managed_agent_invoke");
  });

  it("serializes image parts without degrading them to text", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions({
      messages: [{
        role: "user",
        parts: [
          { type: "text", text: "Describe this image." },
          { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
        ],
      }],
    }));

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      ],
    });
  });

  it("fails closed instead of degrading unsupported audio parts", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await expect(adapter.createMessage(makeOptions({
      messages: [{
        role: "user",
        parts: [
          { type: "text", text: "Transcribe this audio." },
          { type: "audio", mimeType: "audio/wav", data: "UklGRg==", durationMs: 1000 },
        ],
      }],
    }))).rejects.toThrow("unsupported_modality");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails closed instead of dropping multimodal tool-result content parts", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await expect(adapter.createMessage(makeOptions({
      messages: [{
        role: "user",
        parts: [{
          type: "tool_result",
          toolUseId: "call_view_image",
          content: "Loaded image.",
          contentParts: [
            { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
          ],
        }],
      }],
    }))).rejects.toThrow("unsupported_modality");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("preserves malformed function-call arguments as invalid tool input", async () => {
    const body = makeOpenAIResponse({
      choices: [
        {
          message: {
            content: "Let me write.",
            tool_calls: [
              {
                id: "call_invalid",
                type: "function",
                function: {
                  name: "write",
                  arguments: "{bad-json}",
                },
              },
            ],
          },
        },
      ],
    });
    vi.stubGlobal("fetch", mockFetchResponse(body));

    const response = await adapter.createMessage(makeOptions());
    const invalidDetails = getInvalidToolInputDetails(response.toolCalls[0]!.input);

    expect(response.toolCalls[0]?.name).toBe("write");
    expect(invalidDetails).toEqual({
      reason: "Failed to parse tool arguments as JSON.",
      raw: "{bad-json}",
    });
  });

  it("retries on 429", async () => {
    const failResponse = {
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: "rate limited" }),
      text: () => Promise.resolve("rate limited"),
      body: null,
    };
    const successResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeOpenAIResponse()),
      text: () => Promise.resolve(JSON.stringify(makeOpenAIResponse())),
      body: null,
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(successResponse);
    vi.stubGlobal("fetch", mockFetch);

    const response = await adapter.createMessage(makeOptions());

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(extractText(response.parts)).toBe("Hello there!");
  });

  it("streamMessage yields text events", async () => {
    const chunk1 = JSON.stringify({
      choices: [{ delta: { content: "Hello" } }],
    });
    const chunk2 = JSON.stringify({
      choices: [{ delta: { content: " world" } }],
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: mockSSEStream([chunk1, chunk2]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const events: AgentStreamEvent[] = [];
    for await (const event of adapter.streamMessage(makeOptions())) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "text", content: "Hello" });
    expect(events).toContainEqual({ type: "text", content: " world" });
    expect(events).toContainEqual({ type: "done", content: "" });

    // Verify stream: true in request body
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.stream).toBe(true);
  });

  it("restores canonical tool names from streamed provider tool calls", async () => {
    const chunk = JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_managed",
            function: {
              name: "managed_agent_invoke",
              arguments: '{"agent":"scout"}',
            },
          }],
        },
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: mockSSEStream([chunk]),
    }));

    const events: AgentStreamEvent[] = [];
    for await (const event of adapter.streamMessage(makeOptions({
      tools: [makeToolDef("managed_agent.invoke")],
    }))) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "tool_use",
      content: JSON.stringify({
        id: "call_managed",
        name: "managed_agent.invoke",
        input: { agent: "scout" },
      }),
    });
  });

  describe("tool call identity", () => {
    it("synthesizes a streamed id from the chunk id + tc.index when the provider omits tc.id", async () => {
      const chunk = JSON.stringify({
        id: "chatcmpl-omitted-id-1",
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { name: "search", arguments: '{"query":"test"}' },
            }],
          },
        }],
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: mockSSEStream([chunk]),
      }));

      const events: AgentStreamEvent[] = [];
      for await (const event of adapter.streamMessage(makeOptions({ tools: [makeToolDef()] }))) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: "tool_use",
        content: JSON.stringify({
          id: "synth1:chatcmpl-omitted-id-1:0",
          name: "search",
          input: { query: "test" },
        }),
      });
    });

    it("rejects a streamed tool call when neither tc.id nor a chunk id is available", async () => {
      const chunk = JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { name: "search", arguments: '{"query":"test"}' },
            }],
          },
        }],
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: mockSSEStream([chunk]),
      }));

      await expect(async () => {
        for await (const _event of adapter.streamMessage(makeOptions({ tools: [makeToolDef()] }))) {
          // consume
        }
      }).rejects.toMatchObject({ code: "TOOL_CALL_IDENTITY_INVALID" });
    });

    it("rejects duplicate ids within one non-streaming response", async () => {
      const body = makeOpenAIResponse({
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: "call_dup", type: "function", function: { name: "search", arguments: '{"query":"a"}' } },
              { id: "call_dup", type: "function", function: { name: "search", arguments: '{"query":"b"}' } },
            ],
          },
        }],
      });
      vi.stubGlobal("fetch", mockFetchResponse(body));

      await expect(adapter.createMessage(makeOptions({ tools: [makeToolDef()] }))).rejects.toMatchObject({
        code: "TOOL_CALL_IDENTITY_INVALID",
      });
    });

    it("rejects a whitespace-only tool call id in a non-streaming response", async () => {
      const body = makeOpenAIResponse({
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: "   ", type: "function", function: { name: "search", arguments: '{"query":"a"}' } },
            ],
          },
        }],
      });
      vi.stubGlobal("fetch", mockFetchResponse(body));

      await expect(adapter.createMessage(makeOptions({ tools: [makeToolDef()] }))).rejects.toMatchObject({
        code: "TOOL_CALL_IDENTITY_INVALID",
      });
    });

    it("adopts a native id that arrives on a later delta instead of keeping the first-observed synthetic id", async () => {
      // First delta has no tc.id and no chunk id -> would previously buffer id "" and fail
      // at flush. A later delta for the same index supplies a native id; that must win.
      const chunk1 = JSON.stringify({
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { name: "search", arguments: '{"query":' } }] },
        }],
      });
      const chunk2 = JSON.stringify({
        choices: [{
          delta: { tool_calls: [{ index: 0, id: "call_native", function: { arguments: '"test"}' } }] },
        }],
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: mockSSEStream([chunk1, chunk2]),
      }));

      const events: AgentStreamEvent[] = [];
      for await (const event of adapter.streamMessage(makeOptions({ tools: [makeToolDef()] }))) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: "tool_use",
        content: JSON.stringify({ id: "call_native", name: "search", input: { query: "test" } }),
      });
    });

    it("rejects a stream that reuses one index for two conflicting native tool call ids", async () => {
      const chunk1 = JSON.stringify({
        choices: [{
          delta: { tool_calls: [{ index: 0, id: "call-A", function: { name: "search", arguments: "{}" } }] },
        }],
      });
      const chunk2 = JSON.stringify({
        choices: [{
          delta: { tool_calls: [{ index: 0, id: "call-B", function: { arguments: "{}" } }] },
        }],
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: mockSSEStream([chunk1, chunk2]),
      }));

      await expect(async () => {
        for await (const _event of adapter.streamMessage(makeOptions({ tools: [makeToolDef()] }))) {
          // consume
        }
      }).rejects.toMatchObject({ code: "TOOL_CALL_IDENTITY_INVALID" });
    });

    it("rejects a stream where the chunk id backing a synthetic id changes mid-buffer", async () => {
      const chunk1 = JSON.stringify({
        id: "chatcmpl-A",
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { name: "search", arguments: "{}" } }] },
        }],
      });
      const chunk2 = JSON.stringify({
        id: "chatcmpl-B",
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] },
        }],
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: mockSSEStream([chunk1, chunk2]),
      }));

      await expect(async () => {
        for await (const _event of adapter.streamMessage(makeOptions({ tools: [makeToolDef()] }))) {
          // consume
        }
      }).rejects.toMatchObject({ code: "TOOL_CALL_IDENTITY_INVALID" });
    });

    it("preserves a valid provider id unchanged (regression guard)", async () => {
      const body = makeOpenAIResponse({
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: "call_valid_1", type: "function", function: { name: "search", arguments: '{"query":"a"}' } },
            ],
          },
        }],
      });
      vi.stubGlobal("fetch", mockFetchResponse(body));

      const response = await adapter.createMessage(makeOptions({ tools: [makeToolDef()] }));
      expect(response.toolCalls).toEqual([
        { id: "call_valid_1", name: "search", input: { query: "a" } },
      ]);
    });
  });
});

describe("DeepSeekAdapter", () => {
  let adapter: DeepSeekAdapter;

  beforeEach(() => {
    adapter = new DeepSeekAdapter({ apiKey: "test-deepseek-key" });
    const originalRetryOptions = adapter.retryOptions.bind(adapter);
    vi.spyOn(adapter, "retryOptions").mockImplementation(() => ({
      ...originalRetryOptions(),
      sleep: () => Promise.resolve(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses DeepSeek base URL", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions());

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("createMessage sends correct model", async () => {
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions());

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.model).toBe("deepseek-chat");
  });

  it("maps response correctly", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(makeOpenAIResponse()));

    const response = await adapter.createMessage(makeOptions());

    expect(extractText(response.parts)).toBe("Hello there!");
    expect(response.inputTokens).toBe(100);
    expect(response.outputTokens).toBe(50);
    expect(response.toolCalls).toEqual([]);
  });
});

describe("shared behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cacheReadTokens and cacheWriteTokens are 0 for both adapters", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(makeOpenAIResponse()));

    const openai = new OpenAIAdapter({ apiKey: "k" });
    const openaiResponse = await openai.createMessage(makeOptions());
    expect(openaiResponse.cacheReadTokens).toBe(0);
    expect(openaiResponse.cacheWriteTokens).toBe(0);

    const deepseek = new DeepSeekAdapter({ apiKey: "k" });
    const deepseekResponse = await deepseek.createMessage(makeOptions());
    expect(deepseekResponse.cacheReadTokens).toBe(0);
    expect(deepseekResponse.cacheWriteTokens).toBe(0);
  });

  it("name property returns correct provider name", () => {
    const openai = new OpenAIAdapter({ apiKey: "k" });
    expect(openai.name).toBe("openai");

    const deepseek = new DeepSeekAdapter({ apiKey: "k" });
    expect(deepseek.name).toBe("deepseek");
  });
});

describe("model constants", () => {
  it("exports correct OpenAI model IDs", () => {
    expect(GPT4O).toBe("gpt-4o");
    expect(GPT4O_MINI).toBe("gpt-4o-mini");
    expect(O3).toBe("o3");
    expect(O3_MINI).toBe("o3-mini");
  });

  it("exports correct DeepSeek model IDs", () => {
    expect(DEEPSEEK_CHAT).toBe("deepseek-chat");
    expect(DEEPSEEK_REASONER).toBe("deepseek-reasoner");
  });
});

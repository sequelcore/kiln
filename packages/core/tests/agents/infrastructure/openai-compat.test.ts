import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CreateMessageOptions,
  ToolDefinition,
  AgentStreamEvent,
} from "../../../src/agents/index.js";
import { extractText, textParts } from "../../../src/agents/index.js";
import { OpenAIAdapter, GPT4O, GPT4O_MINI, O3, O3_MINI, CODEX } from "../../../src/agents/infrastructure/openai.js";
import { DeepSeekAdapter, DEEPSEEK_CHAT, DEEPSEEK_REASONER } from "../../../src/agents/infrastructure/deepseek.js";

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
    // Mock sleep to avoid real delays
    vi.spyOn(adapter as unknown as { sleep: (ms: number) => Promise<void> }, "sleep" as never).mockResolvedValue(
      undefined as never,
    );
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
});

describe("DeepSeekAdapter", () => {
  let adapter: DeepSeekAdapter;

  beforeEach(() => {
    adapter = new DeepSeekAdapter({ apiKey: "test-deepseek-key" });
    vi.spyOn(adapter as unknown as { sleep: (ms: number) => Promise<void> }, "sleep" as never).mockResolvedValue(
      undefined as never,
    );
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
    expect(CODEX).toBe("codex-mini-latest");
  });

  it("exports correct DeepSeek model IDs", () => {
    expect(DEEPSEEK_CHAT).toBe("deepseek-chat");
    expect(DEEPSEEK_REASONER).toBe("deepseek-reasoner");
  });
});

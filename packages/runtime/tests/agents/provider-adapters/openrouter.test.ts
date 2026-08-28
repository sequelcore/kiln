import { describe, it, expect, vi, afterEach } from "vitest";
import type {
  CreateMessageOptions,
  AgentStreamEvent,
} from "@kilnai/core/agents";
import { extractText, textParts } from "@kilnai/core/engine";
import {
  OpenRouterAdapter,
  NEMOTRON_NANO_FREE,
  STEP_FLASH_FREE,
  TRINITY_LARGE_FREE,
  LLAMA_33_70B_FREE,
  GEMMA_3_27B_FREE,
  QWEN3_CODER_FREE,
  MISTRAL_SMALL_FREE,
} from "../../../src/agents/provider-adapters/openrouter.js";

function makeOptions(
  overrides: Partial<CreateMessageOptions> = {},
): CreateMessageOptions {
  return {
    system: "You are a helpful assistant.",
    messages: [{ role: "user", parts: textParts("Hello") }],
    ...overrides,
  };
}

function makeOpenAIResponse() {
  return {
    choices: [
      {
        message: { content: "Hello there!", tool_calls: undefined },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
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

describe("OpenRouterAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses OpenRouter base URL and default model", async () => {
    const adapter = new OpenRouterAdapter({ apiKey: "test-key" });
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions());

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(body.model).toBe(NEMOTRON_NANO_FREE);
  });

  it("sends only standard headers when appUrl/appName not provided", async () => {
    const adapter = new OpenRouterAdapter({ apiKey: "test-key" });
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions());

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
  });

  it("includes HTTP-Referer and X-Title when configured", async () => {
    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      appUrl: "https://myapp.com",
      appName: "My App",
    });
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions());

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
      "HTTP-Referer": "https://myapp.com",
      "X-Title": "My App",
    });
  });

  it("includes attribution headers in streaming requests", async () => {
    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      appUrl: "https://myapp.com",
      appName: "My App",
    });
    const originalRetryOptions = adapter.retryOptions.bind(adapter);
    vi.spyOn(adapter, "retryOptions").mockImplementation(() => ({
      ...originalRetryOptions(),
      sleep: () => Promise.resolve(),
    }));

    const chunk = JSON.stringify({ choices: [{ delta: { content: "Hi" } }] });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: mockSSEStream([chunk]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const events: AgentStreamEvent[] = [];
    for await (const event of adapter.streamMessage(makeOptions())) {
      events.push(event);
    }

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers["HTTP-Referer"]).toBe("https://myapp.com");
    expect(init.headers["X-Title"]).toBe("My App");
    expect(events).toContainEqual({ type: "text", content: "Hi" });
  });

  it("uses custom model when provided", async () => {
    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      defaultModel: LLAMA_33_70B_FREE,
    });
    const mockFetch = mockFetchResponse(makeOpenAIResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.createMessage(makeOptions());

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });

  it("maps response correctly", async () => {
    const adapter = new OpenRouterAdapter({ apiKey: "test-key" });
    vi.stubGlobal("fetch", mockFetchResponse(makeOpenAIResponse()));

    const response = await adapter.createMessage(makeOptions());

    expect(extractText(response.parts)).toBe("Hello there!");
    expect(response.inputTokens).toBe(100);
    expect(response.outputTokens).toBe(50);
    expect(response.cacheReadTokens).toBe(0);
    expect(response.cacheWriteTokens).toBe(0);
    expect(response.toolCalls).toEqual([]);
  });

  it("has correct provider name", () => {
    const adapter = new OpenRouterAdapter({ apiKey: "test-key" });
    expect(adapter.name).toBe("openrouter");
  });
});

describe("model constants", () => {
  it("exports correct free model IDs", () => {
    expect(NEMOTRON_NANO_FREE).toBe("nvidia/nemotron-3-nano-30b-a3b:free");
    expect(STEP_FLASH_FREE).toBe("stepfun/step-3.5-flash:free");
    expect(TRINITY_LARGE_FREE).toBe("arcee-ai/trinity-large-preview:free");
    expect(LLAMA_33_70B_FREE).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(GEMMA_3_27B_FREE).toBe("google/gemma-3-27b-it:free");
    expect(QWEN3_CODER_FREE).toBe("qwen/qwen3-coder:free");
    expect(MISTRAL_SMALL_FREE).toBe("mistralai/mistral-small-3.1-24b:free");
  });
});

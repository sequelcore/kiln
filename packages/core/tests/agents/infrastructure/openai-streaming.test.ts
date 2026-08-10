import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CreateMessageOptions,
  AgentStreamEvent,
} from "../../../src/agents/index.js";
import { textParts } from "../../../src/engine/domain/content.js";
import { OpenAIAdapter } from "../../../src/agents/infrastructure/openai.js";
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

/**
 * Creates a ReadableStream that emits SSE-formatted chunks.
 * Each string in `events` is sent as `data: <event>\n\n`.
 * A final `data: [DONE]\n\n` is appended unless `omitDone` is true.
 */
function mockSSEStream(
  events: string[],
  options?: { omitDone?: boolean },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      if (!options?.omitDone) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
      controller.close();
    },
  });
}

/**
 * Creates a ReadableStream that delivers all SSE data in a single chunk
 * (simulating TCP coalescing / buffered delivery).
 */
function mockCoalescedSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let payload = "";
  for (const event of events) {
    payload += `data: ${event}\n\n`;
  }
  payload += "data: [DONE]\n\n";

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

/**
 * Creates a ReadableStream that fails after emitting N chunks.
 */
function mockFailingSSEStream(
  events: string[],
  failAfter: number,
  error: Error,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let emitted = 0;
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        if (emitted >= failAfter) {
          controller.error(error);
          return;
        }
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        emitted++;
      }
      if (emitted >= failAfter) {
        controller.error(error);
        return;
      }
      controller.close();
    },
  });
}

function makeChunk(delta: Record<string, unknown>): string {
  return JSON.stringify({ choices: [{ delta }] });
}

function makeToolCallChunk(
  index: number,
  tc: { id?: string; name?: string; arguments?: string },
): string {
  return JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              ...(tc.id ? { id: tc.id } : {}),
              ...(tc.name || tc.arguments
                ? {
                    function: {
                      ...(tc.name ? { name: tc.name } : {}),
                      ...(tc.arguments ? { arguments: tc.arguments } : {}),
                    },
                  }
                : {}),
            },
          ],
        },
      },
    ],
  });
}

function mockFetchStreamResponse(body: ReadableStream<Uint8Array>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body,
  });
}

async function collectEvents(
  gen: AsyncGenerator<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("OpenAIAdapter streaming", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    adapter = new OpenAIAdapter({ apiKey: "test-openai-key" });
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

  describe("text streaming", () => {
    it("yields text events from chunked SSE responses", async () => {
      const chunks = [
        makeChunk({ content: "Hello" }),
        makeChunk({ content: " world" }),
        makeChunk({ content: "!" }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(3);
      expect(textEvents[0]!.content).toBe("Hello");
      expect(textEvents[1]!.content).toBe(" world");
      expect(textEvents[2]!.content).toBe("!");
    });

    it("yields done event after [DONE] sentinel", async () => {
      const chunks = [makeChunk({ content: "Hi" })];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toEqual({ type: "done", content: "" });
    });

    it("skips deltas with null content", async () => {
      const chunks = [
        makeChunk({ content: null }),
        makeChunk({ content: "actual content" }),
        makeChunk({ content: null }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]!.content).toBe("actual content");
    });

    it("handles all data arriving in a single coalesced chunk", async () => {
      const chunks = [
        makeChunk({ content: "all" }),
        makeChunk({ content: " at once" }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockCoalescedSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(2);
      expect(textEvents[0]!.content).toBe("all");
      expect(textEvents[1]!.content).toBe(" at once");
      expect(events).toContainEqual({ type: "done", content: "" });
    });
  });

  describe("tool call streaming", () => {
    it("buffers tool call arguments across multiple chunks", async () => {
      const chunks = [
        makeToolCallChunk(0, { id: "call_1", name: "search", arguments: '{"que' }),
        makeToolCallChunk(0, { arguments: 'ry": "t' }),
        makeToolCallChunk(0, { arguments: 'est"}' }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvents = events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(1);
      const parsed = JSON.parse(toolEvents[0]!.content);
      expect(parsed).toEqual({
        id: "call_1",
        name: "search",
        input: { query: "test" },
      });
    });

    it("handles multiple concurrent tool calls at different indices", async () => {
      const chunks = [
        makeToolCallChunk(0, { id: "call_a", name: "search", arguments: '{"q":' }),
        makeToolCallChunk(1, { id: "call_b", name: "calc", arguments: '{"expr":' }),
        makeToolCallChunk(0, { arguments: ' "foo"}' }),
        makeToolCallChunk(1, { arguments: ' "2+2"}' }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvents = events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(2);

      const tool1 = JSON.parse(toolEvents[0]!.content);
      expect(tool1).toEqual({ id: "call_a", name: "search", input: { q: "foo" } });

      const tool2 = JSON.parse(toolEvents[1]!.content);
      expect(tool2).toEqual({ id: "call_b", name: "calc", input: { expr: "2+2" } });
    });

    it("emits tool_use with empty object when arguments are empty", async () => {
      const chunks = [
        makeToolCallChunk(0, { id: "call_empty", name: "ping" }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvents = events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(1);
      const parsed = JSON.parse(toolEvents[0]!.content);
      expect(parsed).toEqual({ id: "call_empty", name: "ping", input: {} });
    });

    it("handles tool with complex nested JSON arguments", async () => {
      const complexInput = {
        filters: [{ field: "status", value: "active" }],
        pagination: { page: 1, limit: 50 },
      };
      const argsStr = JSON.stringify(complexInput);

      // Split into 3 chunks
      const chunks = [
        makeToolCallChunk(0, { id: "call_cx", name: "query", arguments: argsStr.slice(0, 25) }),
        makeToolCallChunk(0, { arguments: argsStr.slice(25, 55) }),
        makeToolCallChunk(0, { arguments: argsStr.slice(55) }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvent = events.find((e) => e.type === "tool_use");
      expect(toolEvent).toBeDefined();
      const parsed = JSON.parse(toolEvent!.content);
      expect(parsed.input).toEqual(complexInput);
    });

    it("emits malformed streamed tool arguments as invalid tool input", async () => {
      const chunks = [
        makeToolCallChunk(0, { id: "call_bad", name: "write", arguments: "{bad" }),
        makeToolCallChunk(0, { arguments: "-json}" }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));
      const toolEvent = events.find((event) => event.type === "tool_use");
      expect(toolEvent).toBeDefined();
      const parsed = JSON.parse(toolEvent!.content);

      expect(parsed.name).toBe("write");
      expect(getInvalidToolInputDetails(parsed.input)).toEqual({
        reason: "Failed to parse tool arguments as JSON.",
        raw: "{bad-json}",
      });
      expect(events).toContainEqual({ type: "done", content: "" });
    });
  });

  describe("mixed content types", () => {
    it("handles interleaved text and tool call chunks", async () => {
      const chunks = [
        makeChunk({ content: "Let me search." }),
        makeToolCallChunk(0, { id: "call_mix", name: "search", arguments: '{"q": "test"}' }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      const toolEvents = events.filter((e) => e.type === "tool_use");

      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]!.content).toBe("Let me search.");

      expect(toolEvents).toHaveLength(1);
      const parsed = JSON.parse(toolEvents[0]!.content);
      expect(parsed.name).toBe("search");
    });
  });

  describe("empty and minimal streams", () => {
    it("rejects a successful response with no stream body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          body: null,
        }),
      );

      await expect(collectEvents(adapter.streamMessage(makeOptions())))
        .rejects.toThrow("streaming response has no body");
    });

    it("yields done when stream has only [DONE]", async () => {
      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream([])));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      expect(events).toEqual([{ type: "done", content: "" }]);
    });

    it("skips lines that are not SSE data lines", async () => {
      // Simulate a stream with comment lines and empty lines mixed in
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(": this is a comment\n\n"));
          controller.enqueue(encoder.encode("event: ping\n\n"));
          controller.enqueue(encoder.encode(`data: ${makeChunk({ content: "Hi" })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      vi.stubGlobal("fetch", mockFetchStreamResponse(stream));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]!.content).toBe("Hi");
    });

    it("skips chunks with empty choices array", async () => {
      const chunks = [
        JSON.stringify({ choices: [] }),
        makeChunk({ content: "ok" }),
      ];

      vi.stubGlobal("fetch", mockFetchStreamResponse(mockSSEStream(chunks)));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]!.content).toBe("ok");
    });
  });

  describe("error handling during stream", () => {
    it("throws on non-ok HTTP response before streaming starts", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: () => Promise.resolve("Bad request: invalid model"),
          body: null,
        }),
      );

      await expect(async () => {
        for await (const _event of adapter.streamMessage(makeOptions())) {
          // should not reach here
        }
      }).rejects.toThrow("openai API error 400: Bad request: invalid model");
    });

    it("throws on 500 server error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal server error"),
          body: null,
        }),
      );

      await expect(async () => {
        for await (const _event of adapter.streamMessage(makeOptions())) {
          // should not reach here
        }
      }).rejects.toThrow("openai API error 500");
    });

    it("propagates read error mid-stream", async () => {
      // Create a stream that errors after delivering one chunk.
      // The ReadableStream error propagates through reader.read() which
      // surfaces inside the for-await loop in streamMessage.
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${makeChunk({ content: "partial" })}\n\n`),
          );
          // Enqueue a second valid chunk so the loop reads again, then error
        },
        pull(controller) {
          controller.error(new Error("Connection dropped"));
        },
      });

      vi.stubGlobal("fetch", mockFetchStreamResponse(stream));

      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(makeOptions())) {
          events.push(event);
        }
      }).rejects.toThrow("Connection dropped");

      // Should have captured the partial text event before error
      expect(events).toContainEqual({ type: "text", content: "partial" });
    });

    it("retries fetch on network error before stream starts", async () => {
      // withRetry wraps the fetch() call itself. Since fetch only throws
      // on network-level failures (not HTTP status errors), the retry
      // mechanism catches actual fetch exceptions like connection errors.
      const networkError = new Error("fetch failed");

      const successChunks = [makeChunk({ content: "recovered" })];
      const successResponse = {
        ok: true,
        status: 200,
        body: mockSSEStream(successChunks),
      };

      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(successResponse);
      vi.stubGlobal("fetch", mockFetch);

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(events).toContainEqual({ type: "text", content: "recovered" });
    });
  });

  describe("stream ending without [DONE]", () => {
    it("rejects pending tool calls when stream ends without [DONE]", async () => {
      const chunks = [
        makeToolCallChunk(0, { id: "call_no_done", name: "search", arguments: '{"q": "test"}' }),
      ];

      vi.stubGlobal(
        "fetch",
        mockFetchStreamResponse(mockSSEStream(chunks, { omitDone: true })),
      );

      await expect(collectEvents(adapter.streamMessage(makeOptions())))
        .rejects.toThrow("ended without a terminal signal");
    });

    it("rejects text when stream ends without [DONE]", async () => {
      const chunks = [makeChunk({ content: "trailing" })];

      vi.stubGlobal(
        "fetch",
        mockFetchStreamResponse(mockSSEStream(chunks, { omitDone: true })),
      );

      await expect(collectEvents(adapter.streamMessage(makeOptions())))
        .rejects.toThrow("ended without a terminal signal");
    });
  });

  describe("request parameters", () => {
    it("sets stream: true in the request body", async () => {
      const mockFetch = mockFetchStreamResponse(mockSSEStream([]));
      vi.stubGlobal("fetch", mockFetch);

      await collectEvents(adapter.streamMessage(makeOptions()));

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.stream).toBe(true);
    });

    it("sends correct URL and auth headers", async () => {
      const mockFetch = mockFetchStreamResponse(mockSSEStream([]));
      vi.stubGlobal("fetch", mockFetch);

      await collectEvents(adapter.streamMessage(makeOptions()));

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init.headers).toEqual({
        Authorization: "Bearer test-openai-key",
        "Content-Type": "application/json",
      });
    });

    it("includes tools in streaming request body", async () => {
      const mockFetch = mockFetchStreamResponse(mockSSEStream([]));
      vi.stubGlobal("fetch", mockFetch);

      await collectEvents(
        adapter.streamMessage(
          makeOptions({
            tools: [
              {
                name: "search",
                description: "search tool",
                inputSchema: { type: "object", properties: { q: { type: "string" } } },
                tags: new Set(["test"]),
              },
            ],
          }),
        ),
      );

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.tools).toEqual([
        {
          type: "function",
          function: {
            name: "search",
            description: "search tool",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        },
      ]);
    });

    it("includes system message in streaming request", async () => {
      const mockFetch = mockFetchStreamResponse(mockSSEStream([]));
      vi.stubGlobal("fetch", mockFetch);

      await collectEvents(adapter.streamMessage(makeOptions({ system: "Custom system" })));

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "Custom system" });
    });
  });
});

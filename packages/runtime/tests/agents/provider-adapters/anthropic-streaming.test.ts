import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  CreateMessageOptions,
  AgentStreamEvent,
} from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { getInvalidToolInputDetails } from "@kilnai/core/agents";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAPIError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "APIError";
    }
  }

  class MockAnthropic {
    messages = { create: mockCreate };
    constructor(_opts: Record<string, unknown>) {}
    static APIError = MockAPIError;
  }

  return { default: MockAnthropic, APIError: MockAPIError };
});

import { AnthropicAdapter } from "../../../src/agents/provider-adapters/anthropic.js";

function makeOptions(
  overrides: Partial<CreateMessageOptions> = {},
): CreateMessageOptions {
  return {
    system: "You are a helpful assistant.",
    messages: [{ role: "user", parts: textParts("Hello") }],
    ...overrides,
  };
}

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<T>> {
          if (index < items.length) {
            return { value: items[index++]!, done: false };
          }
          return { value: undefined as unknown as T, done: true };
        },
      };
    },
  };
}

function createFailingAsyncIterable<T>(
  items: T[],
  failAfter: number,
  error: Error,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<T>> {
          if (index >= failAfter) {
            throw error;
          }
          if (index < items.length) {
            return { value: items[index++]!, done: false };
          }
          return { value: undefined as unknown as T, done: true };
        },
      };
    },
  };
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

describe("AnthropicAdapter streaming", () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AnthropicAdapter({ apiKey: "test-key" });
    // Override retryOptions to use instant sleep
    const originalRetryOptions = adapter.retryOptions.bind(adapter);
    vi.spyOn(adapter, "retryOptions").mockImplementation(() => ({
      ...originalRetryOptions(),
      sleep: () => Promise.resolve(),
    }));
  });

  describe("text streaming", () => {
    it("assembles multiple text deltas into ordered events", async () => {
      const streamEvents = [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "quick " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "brown fox" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(3);
      expect(textEvents[0]!.content).toBe("The ");
      expect(textEvents[1]!.content).toBe("quick ");
      expect(textEvents[2]!.content).toBe("brown fox");
    });

    it("yields done event at message_stop", async () => {
      const streamEvents = [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toEqual({ type: "done", content: "" });
    });

    it("handles empty text deltas gracefully", async () => {
      const streamEvents = [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "content" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(2);
      expect(textEvents[0]!.content).toBe("");
      expect(textEvents[1]!.content).toBe("content");
    });
  });

  describe("tool call streaming", () => {
    it("buffers tool input JSON across multiple deltas", async () => {
      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_abc", name: "get_weather", input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"ci' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: 'ty": "' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: 'Paris"}' },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvents = events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(1);
      const parsed = JSON.parse(toolEvents[0]!.content);
      expect(parsed).toEqual({
        id: "toolu_abc",
        name: "get_weather",
        input: { city: "Paris" },
      });
    });

    it("handles multiple concurrent tool calls at different indices", async () => {
      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "search", input: {} },
        },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_2", name: "calculate", input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"query": "test"}' },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"expr": "2+2"}' },
        },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_stop", index: 1 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvents = events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(2);

      const tool1 = JSON.parse(toolEvents[0]!.content);
      expect(tool1).toEqual({ id: "toolu_1", name: "search", input: { query: "test" } });

      const tool2 = JSON.parse(toolEvents[1]!.content);
      expect(tool2).toEqual({ id: "toolu_2", name: "calculate", input: { expr: "2+2" } });
    });

    it("emits malformed streamed tool input as invalid tool input", async () => {
      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_bad", name: "write", input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "{bad" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "-json}" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

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

    it("emits tool_use with empty object when no input JSON deltas arrive", async () => {
      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_empty", name: "no_args_tool", input: {} },
        },
        // No input_json_delta events -- tool takes no arguments
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvents = events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(1);
      const parsed = JSON.parse(toolEvents[0]!.content);
      expect(parsed.input).toEqual({});
    });

    it("cleans up tool buffer after emitting tool_use event", async () => {
      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_a", name: "first", input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"a": 1}' },
        },
        { type: "content_block_stop", index: 0 },
        // Second tool at same index 0 -- buffer should be fresh
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_b", name: "second", input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"b": 2}' },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvents = events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(2);

      const first = JSON.parse(toolEvents[0]!.content);
      expect(first).toEqual({ id: "toolu_a", name: "first", input: { a: 1 } });

      const second = JSON.parse(toolEvents[1]!.content);
      expect(second).toEqual({ id: "toolu_b", name: "second", input: { b: 2 } });
    });
  });

  describe("thinking events", () => {
    it("yields thinking from content_block_start", async () => {
      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "Initial thought", signature: "" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      expect(events).toContainEqual({ type: "thinking", content: "Initial thought" });
    });

    it("yields thinking from content_block_delta", async () => {
      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "step 1" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: " then step 2" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const thinkingEvents = events.filter((e) => e.type === "thinking");
      expect(thinkingEvents).toHaveLength(3); // 1 from start + 2 from deltas
      expect(thinkingEvents[1]!.content).toBe("step 1");
      expect(thinkingEvents[2]!.content).toBe(" then step 2");
    });
  });

  describe("mixed content types", () => {
    it("handles interleaved text and tool_use blocks", async () => {
      const streamEvents = [
        // Text block
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me search." } },
        { type: "content_block_stop", index: 0 },
        // Tool use block
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_mix", name: "search", input: {} },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"q": "weather"}' },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const textEvents = events.filter((e) => e.type === "text");
      const toolEvents = events.filter((e) => e.type === "tool_use");

      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]!.content).toBe("Let me search.");

      expect(toolEvents).toHaveLength(1);
      const toolParsed = JSON.parse(toolEvents[0]!.content);
      expect(toolParsed.name).toBe("search");
      expect(toolParsed.input).toEqual({ q: "weather" });
    });

    it("handles thinking followed by text followed by tool_use", async () => {
      const streamEvents = [
        // Thinking block
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "I need to search", signature: "" },
        },
        { type: "content_block_stop", index: 0 },
        // Text block
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Searching..." } },
        { type: "content_block_stop", index: 1 },
        // Tool use block
        {
          type: "content_block_start",
          index: 2,
          content_block: { type: "tool_use", id: "toolu_th", name: "lookup", input: {} },
        },
        {
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: '{}' },
        },
        { type: "content_block_stop", index: 2 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const types = events.map((e) => e.type);
      expect(types).toEqual(["thinking", "text", "tool_use", "done"]);
    });
  });

  describe("empty and minimal streams", () => {
    it("yields only done for a stream with just message_stop", async () => {
      mockCreate.mockResolvedValueOnce(createAsyncIterable([{ type: "message_stop" }]));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      expect(events).toEqual([{ type: "done", content: "" }]);
    });

    it("yields done when async iterable is immediately exhausted", async () => {
      mockCreate.mockResolvedValueOnce(createAsyncIterable([]));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      // No message_stop means no done event -- stream just ends
      expect(events).toEqual([]);
    });

    it("ignores unknown event types gracefully", async () => {
      const streamEvents = [
        { type: "ping" },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      expect(events).toContainEqual({ type: "text", content: "Hi" });
      expect(events).toContainEqual({ type: "done", content: "" });
    });
  });

  describe("error handling during stream", () => {
    it("propagates error thrown mid-stream by the async iterable", async () => {
      const streamEvents = [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
      ];

      const networkError = new Error("Connection reset");
      mockCreate.mockResolvedValueOnce(
        createFailingAsyncIterable(streamEvents, 2, networkError),
      );

      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(makeOptions())) {
          events.push(event);
        }
      }).rejects.toThrow("Connection reset");

      // Should have yielded events before the error
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events).toContainEqual({ type: "text", content: "partial" });
    });

    it("propagates error thrown at stream start", async () => {
      mockCreate.mockResolvedValueOnce(
        createFailingAsyncIterable([], 0, new Error("Stream initialization failed")),
      );

      await expect(async () => {
        for await (const _event of adapter.streamMessage(makeOptions())) {
          // should not reach here
        }
      }).rejects.toThrow("Stream initialization failed");
    });

    it("retries initial SDK call on retryable error before streaming begins", async () => {
      const { APIError } = await import("@anthropic-ai/sdk");
      const error = new (APIError as unknown as new (s: number, m: string) => Error)(
        429,
        "Rate limited",
      );

      const successStream = createAsyncIterable([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ]);

      mockCreate
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(successStream);

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(events).toContainEqual({ type: "text", content: "ok" });
      expect(events).toContainEqual({ type: "done", content: "" });
    });
  });

  describe("request parameters", () => {
    it("passes stream: true to the SDK", async () => {
      mockCreate.mockResolvedValueOnce(createAsyncIterable([{ type: "message_stop" }]));

      await collectEvents(adapter.streamMessage(makeOptions()));

      const params = mockCreate.mock.calls[0]![0];
      expect(params.stream).toBe(true);
    });

    it("includes anthropic-beta header for streaming", async () => {
      mockCreate.mockResolvedValueOnce(createAsyncIterable([{ type: "message_stop" }]));

      await collectEvents(adapter.streamMessage(makeOptions()));

      const requestOptions = mockCreate.mock.calls[0]![1];
      expect(requestOptions).toEqual({
        headers: { "anthropic-beta": "token-efficient-tools-2025-02-19" },
      });
    });

    it("includes cache_control on system prompt for streaming", async () => {
      mockCreate.mockResolvedValueOnce(createAsyncIterable([{ type: "message_stop" }]));

      await collectEvents(adapter.streamMessage(makeOptions()));

      const params = mockCreate.mock.calls[0]![0];
      expect(params.system).toEqual([
        {
          type: "text",
          text: "You are a helpful assistant.",
          cache_control: { type: "ephemeral" },
        },
      ]);
    });

    it("includes tools with cache_control on last tool for streaming", async () => {
      mockCreate.mockResolvedValueOnce(createAsyncIterable([{ type: "message_stop" }]));

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

      const params = mockCreate.mock.calls[0]![0];
      expect(params.tools).toEqual([
        {
          name: "search",
          description: "search tool",
          input_schema: { type: "object", properties: { q: { type: "string" } } },
          cache_control: { type: "ephemeral" },
        },
      ]);
    });
  });

  describe("edge cases", () => {
    it("handles content_block_stop for a non-tool index (no-op)", async () => {
      const streamEvents = [
        // content_block_stop without a preceding tool_use start at index 5
        { type: "content_block_stop", index: 5 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      // Should just yield done, no tool_use event
      const toolEvents = events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(0);
      expect(events).toContainEqual({ type: "done", content: "" });
    });

    it("handles input_json_delta for unknown index gracefully", async () => {
      const streamEvents = [
        {
          type: "content_block_delta",
          index: 99,
          delta: { type: "input_json_delta", partial_json: '{"orphan": true}' },
        },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      // Should not throw -- orphan delta is silently ignored
      const events = await collectEvents(adapter.streamMessage(makeOptions()));
      expect(events).toContainEqual({ type: "done", content: "" });
    });

    it("handles tool with complex nested JSON input", async () => {
      const complexInput = {
        filters: [
          { field: "status", op: "eq", value: "active" },
          { field: "age", op: "gt", value: 18 },
        ],
        sort: { field: "name", order: "asc" },
      };
      const jsonStr = JSON.stringify(complexInput);

      // Split the JSON into 3 chunks at arbitrary positions
      const chunk1 = jsonStr.slice(0, 20);
      const chunk2 = jsonStr.slice(20, 60);
      const chunk3 = jsonStr.slice(60);

      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_complex", name: "query", input: {} },
        },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: chunk1 } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: chunk2 } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: chunk3 } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      const toolEvent = events.find((e) => e.type === "tool_use");
      expect(toolEvent).toBeDefined();
      const parsed = JSON.parse(toolEvent!.content);
      expect(parsed.input).toEqual(complexInput);
    });

    it("handles message_start event without yielding anything", async () => {
      const streamEvents = [
        {
          type: "message_start",
          message: { id: "msg_1", type: "message", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(createAsyncIterable(streamEvents));

      const events = await collectEvents(adapter.streamMessage(makeOptions()));

      // message_start should not produce any event
      expect(events[0]).toEqual({ type: "text", content: "Hello" });
    });
  });
});

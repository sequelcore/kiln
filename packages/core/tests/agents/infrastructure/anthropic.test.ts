import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  CreateMessageOptions,
  ToolDefinition,
  AgentStreamEvent,
} from "../../../src/agents/index.js";
import { extractText, textParts } from "../../../src/agents/index.js";

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
    constructor(_opts: Record<string, unknown>) {
      // apiKey captured but not used in tests
    }
    static APIError = MockAPIError;
  }

  return { default: MockAnthropic, APIError: MockAPIError };
});

import {
  AnthropicAdapter,
  CLAUDE_OPUS,
  CLAUDE_SONNET,
  CLAUDE_HAIKU,
} from "../../../src/agents/infrastructure/anthropic.js";

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

function makeMessageResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_123",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello there!" }],
    model: CLAUDE_SONNET,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 20,
    },
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

function makeMockAPIError(status: number, message: string): Error {
  const err = new Error(message);
  (err as Record<string, unknown>).status = status;
  (err as Record<string, unknown>).name = "APIError";
  // Make it match the instanceof check by giving it the right prototype
  Object.setPrototypeOf(err, makeMockAPIError.prototype);
  return err;
}

describe("AnthropicAdapter", () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AnthropicAdapter({ apiKey: "test-key" });
  });

  describe("model constants", () => {
    it("exports correct model IDs", () => {
      expect(CLAUDE_OPUS).toBe("claude-opus-4-6");
      expect(CLAUDE_SONNET).toBe("claude-sonnet-4-6");
      expect(CLAUDE_HAIKU).toBe("claude-haiku-4-5-20251001");
    });
  });

  describe("constructor", () => {
    it("has name 'anthropic'", () => {
      expect(adapter.name).toBe("anthropic");
    });
  });

  describe("createMessage", () => {
    it("maps messages correctly", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      await adapter.createMessage(makeOptions());

      const params = mockCreate.mock.calls[0]![0];
      expect(params.messages).toEqual([
        { role: "user", content: "Hello" },
      ]);
    });

    it("passes system prompt with cache_control", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      await adapter.createMessage(makeOptions());

      const params = mockCreate.mock.calls[0]![0];
      expect(params.system).toEqual([
        {
          type: "text",
          text: "You are a helpful assistant.",
          cache_control: { type: "ephemeral" },
        },
      ]);
    });

    it("includes beta header", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      await adapter.createMessage(makeOptions());

      const requestOptions = mockCreate.mock.calls[0]![1];
      expect(requestOptions).toEqual({
        headers: {
          "anthropic-beta": "token-efficient-tools-2025-02-19",
        },
      });
    });

    it("maps tools to Anthropic format (inputSchema -> input_schema)", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      const tool = makeToolDef("search");
      await adapter.createMessage(makeOptions({ tools: [tool] }));

      const params = mockCreate.mock.calls[0]![0];
      expect(params.tools).toEqual([
        {
          name: "search",
          description: "search tool",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ]);
    });

    it("returns correct token counts", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      const response = await adapter.createMessage(makeOptions());

      expect(response.inputTokens).toBe(100);
      expect(response.outputTokens).toBe(50);
      expect(response.cacheReadTokens).toBe(20);
      expect(response.cacheWriteTokens).toBe(10);
    });

    it("returns text content from response", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      const response = await adapter.createMessage(makeOptions());

      expect(extractText(response.parts)).toBe("Hello there!");
    });

    it("maps tool_use blocks to toolCalls", async () => {
      mockCreate.mockResolvedValueOnce(
        makeMessageResponse({
          content: [
            { type: "text", text: "Let me search." },
            {
              type: "tool_use",
              id: "toolu_123",
              name: "search",
              input: { query: "test" },
            },
          ],
        }),
      );

      const response = await adapter.createMessage(makeOptions());

      expect(extractText(response.parts)).toBe("Let me search.");
      expect(response.toolCalls).toEqual([
        { id: "toolu_123", name: "search", input: { query: "test" } },
      ]);
    });

    it("handles null cache token counts", async () => {
      mockCreate.mockResolvedValueOnce(
        makeMessageResponse({
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
        }),
      );

      const response = await adapter.createMessage(makeOptions());

      expect(response.cacheReadTokens).toBe(0);
      expect(response.cacheWriteTokens).toBe(0);
    });

    it("uses default max_tokens when not specified", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      await adapter.createMessage(makeOptions());

      const params = mockCreate.mock.calls[0]![0];
      expect(params.max_tokens).toBe(4096);
    });

    it("uses provided maxTokens", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      await adapter.createMessage(makeOptions({ maxTokens: 8192 }));

      const params = mockCreate.mock.calls[0]![0];
      expect(params.max_tokens).toBe(8192);
    });

    it("does not include tools when none provided", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      await adapter.createMessage(makeOptions());

      const params = mockCreate.mock.calls[0]![0];
      expect(params.tools).toBeUndefined();
    });

    it("sets output_config when outputSchema is provided", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      const schema = {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      };
      await adapter.createMessage(makeOptions({ outputSchema: schema }));

      const params = mockCreate.mock.calls[0]![0];
      expect(params.output_config).toEqual({
        format: { type: "json_schema", schema },
      });
    });

    it("does not set output_config when no outputSchema", async () => {
      mockCreate.mockResolvedValueOnce(makeMessageResponse());

      await adapter.createMessage(makeOptions());

      const params = mockCreate.mock.calls[0]![0];
      expect(params.output_config).toBeUndefined();
    });

    it("throws when outputSchema object lacks additionalProperties: false", async () => {
      const schema = {
        type: "object",
        properties: { answer: { type: "string" } },
      };

      await expect(
        adapter.createMessage(makeOptions({ outputSchema: schema })),
      ).rejects.toThrow("additionalProperties: false");
    });

    it("throws when nested object lacks additionalProperties: false", async () => {
      const schema = {
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: { value: { type: "number" } },
          },
        },
        additionalProperties: false,
      };

      await expect(
        adapter.createMessage(makeOptions({ outputSchema: schema })),
      ).rejects.toThrow("$.nested");
    });

    it("validates additionalProperties in array items", async () => {
      const schema = {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" } },
            },
          },
        },
        additionalProperties: false,
      };

      await expect(
        adapter.createMessage(makeOptions({ outputSchema: schema })),
      ).rejects.toThrow("$.items[]");
    });
  });

  describe("retry logic", () => {
    // We need to mock the sleep to avoid real delays
    beforeEach(() => {
      vi.spyOn(
        AnthropicAdapter.prototype as unknown as { sleep: (ms: number) => Promise<void> },
        "sleep" as never,
      ).mockResolvedValue(undefined as never);
    });

    it("retries on 429 error", async () => {
      const { APIError } = await import("@anthropic-ai/sdk");
      const error = new (APIError as unknown as new (status: number, message: string) => Error)(
        429,
        "Rate limited",
      );

      mockCreate
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(makeMessageResponse());

      const response = await adapter.createMessage(makeOptions());

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(extractText(response.parts)).toBe("Hello there!");
    });

    it("retries on 500 error", async () => {
      const { APIError } = await import("@anthropic-ai/sdk");
      const error = new (APIError as unknown as new (status: number, message: string) => Error)(
        500,
        "Server error",
      );

      mockCreate
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(makeMessageResponse());

      const response = await adapter.createMessage(makeOptions());

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(extractText(response.parts)).toBe("Hello there!");
    });

    it("retries on 529 error", async () => {
      const { APIError } = await import("@anthropic-ai/sdk");
      const error = new (APIError as unknown as new (status: number, message: string) => Error)(
        529,
        "Overloaded",
      );

      mockCreate
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(makeMessageResponse());

      const response = await adapter.createMessage(makeOptions());

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(extractText(response.parts)).toBe("Hello there!");
    });

    it("throws on 400 error without retry", async () => {
      const { APIError } = await import("@anthropic-ai/sdk");
      const error = new (APIError as unknown as new (status: number, message: string) => Error)(
        400,
        "Bad request",
      );

      mockCreate.mockRejectedValueOnce(error);

      await expect(adapter.createMessage(makeOptions())).rejects.toThrow(
        "Bad request",
      );
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("throws on 401 error without retry", async () => {
      const { APIError } = await import("@anthropic-ai/sdk");
      const error = new (APIError as unknown as new (status: number, message: string) => Error)(
        401,
        "Unauthorized",
      );

      mockCreate.mockRejectedValueOnce(error);

      await expect(adapter.createMessage(makeOptions())).rejects.toThrow(
        "Unauthorized",
      );
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting retries", async () => {
      const { APIError } = await import("@anthropic-ai/sdk");
      const error = new (APIError as unknown as new (status: number, message: string) => Error)(
        429,
        "Rate limited",
      );

      mockCreate
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error);

      await expect(adapter.createMessage(makeOptions())).rejects.toThrow(
        "Rate limited",
      );
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe("streamMessage", () => {
    it("yields text events", async () => {
      const streamEvents = [
        {
          type: "message_start",
          message: makeMessageResponse(),
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " world" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(
        createAsyncIterable(streamEvents),
      );

      const events: AgentStreamEvent[] = [];
      for await (const event of adapter.streamMessage(makeOptions())) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: "text",
        content: "Hello",
      });
      expect(events).toContainEqual({
        type: "text",
        content: " world",
      });
      expect(events).toContainEqual({ type: "done", content: "" });
    });

    it("yields thinking events", async () => {
      const streamEvents = [
        {
          type: "message_start",
          message: makeMessageResponse(),
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "thinking",
            thinking: "Let me think...",
            signature: "",
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "more thinking" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(
        createAsyncIterable(streamEvents),
      );

      const events: AgentStreamEvent[] = [];
      for await (const event of adapter.streamMessage(makeOptions())) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: "thinking",
        content: "Let me think...",
      });
      expect(events).toContainEqual({
        type: "thinking",
        content: "more thinking",
      });
    });

    it("yields tool_use events with accumulated input", async () => {
      const streamEvents = [
        {
          type: "message_start",
          message: makeMessageResponse(),
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "search",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: '{"query"',
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: ': "test"}',
          },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];

      mockCreate.mockResolvedValueOnce(
        createAsyncIterable(streamEvents),
      );

      const events: AgentStreamEvent[] = [];
      for await (const event of adapter.streamMessage(makeOptions())) {
        events.push(event);
      }

      const toolEvent = events.find((e) => e.type === "tool_use");
      expect(toolEvent).toBeDefined();
      const parsed = JSON.parse(toolEvent!.content);
      expect(parsed).toEqual({
        id: "toolu_1",
        name: "search",
        input: { query: "test" },
      });
    });

    it("passes stream: true in params", async () => {
      mockCreate.mockResolvedValueOnce(
        createAsyncIterable([{ type: "message_stop" }]),
      );

      const events: AgentStreamEvent[] = [];
      for await (const event of adapter.streamMessage(makeOptions())) {
        events.push(event);
      }

      const params = mockCreate.mock.calls[0]![0];
      expect(params.stream).toBe(true);
    });
  });
});

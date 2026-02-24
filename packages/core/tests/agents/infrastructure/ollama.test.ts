import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CreateMessageOptions,
  AgentStreamEvent,
  ToolDefinition,
} from "../../../src/agents/index.js";
import { extractText, textParts } from "../../../src/engine/domain/content.js";
import {
  OllamaAdapter,
  LLAMA3,
  CODELLAMA,
  DEEPSEEK_CODER,
} from "../../../src/agents/infrastructure/ollama.js";

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

function makeStreamBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = lines.join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("OllamaAdapter", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("model constants", () => {
    it("exports correct model IDs", () => {
      expect(LLAMA3).toBe("llama3.1");
      expect(CODELLAMA).toBe("codellama");
      expect(DEEPSEEK_CODER).toBe("deepseek-coder-v2");
    });
  });

  describe("constructor", () => {
    it("has name 'ollama'", () => {
      const adapter = new OllamaAdapter();
      expect(adapter.name).toBe("ollama");
    });
  });

  describe("createMessage", () => {
    it("sends correct request to localhost:11434", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: "Hi there!" },
          done: true,
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      });

      const adapter = new OllamaAdapter();
      await adapter.createMessage(makeOptions());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe("http://localhost:11434/api/chat");
      expect(init.method).toBe("POST");

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("llama3.1");
      expect(body.stream).toBe(false);
      expect(body.messages).toEqual([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ]);
    });

    it("maps response correctly (content, tokens)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: "Hello there!" },
          done: true,
          prompt_eval_count: 100,
          eval_count: 50,
        }),
      });

      const adapter = new OllamaAdapter();
      const response = await adapter.createMessage(makeOptions());

      expect(extractText(response.parts)).toBe("Hello there!");
      expect(response.inputTokens).toBe(100);
      expect(response.outputTokens).toBe(50);
      expect(response.cacheReadTokens).toBe(0);
      expect(response.cacheWriteTokens).toBe(0);
      expect(response.toolCalls).toEqual([]);
    });

    it("handles tool calls", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "",
            tool_calls: [
              {
                function: {
                  name: "search",
                  arguments: { query: "test" },
                },
              },
            ],
          },
          done: true,
          prompt_eval_count: 20,
          eval_count: 10,
        }),
      });

      const adapter = new OllamaAdapter();
      const response = await adapter.createMessage(
        makeOptions({ tools: [makeToolDef()] }),
      );

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]!.name).toBe("search");
      expect(response.toolCalls[0]!.input).toEqual({ query: "test" });
    });

    it("maps tools to OpenAI-compatible format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: "OK" },
          done: true,
        }),
      });

      const adapter = new OllamaAdapter();
      await adapter.createMessage(makeOptions({ tools: [makeToolDef()] }));

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
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

    it("handles missing token counts", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: "Hi" },
          done: true,
        }),
      });

      const adapter = new OllamaAdapter();
      const response = await adapter.createMessage(makeOptions());

      expect(response.inputTokens).toBe(0);
      expect(response.outputTokens).toBe(0);
    });

    it("uses custom baseUrl when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: "Hi" },
          done: true,
        }),
      });

      const adapter = new OllamaAdapter({ baseUrl: "http://gpu-server:11434" });
      await adapter.createMessage(makeOptions());

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe("http://gpu-server:11434/api/chat");
    });

    it("throws on non-OK response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const adapter = new OllamaAdapter();
      await expect(adapter.createMessage(makeOptions())).rejects.toThrow(
        "Ollama request failed: 500 Internal Server Error",
      );
    });
  });

  describe("streamMessage", () => {
    it("yields text events from NDJSON", async () => {
      const body = makeStreamBody([
        '{"message":{"content":"Hello"},"done":false}',
        '{"message":{"content":" world"},"done":false}',
        '{"done":true,"eval_count":10,"prompt_eval_count":5,"message":{"content":""}}',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body,
      });

      const adapter = new OllamaAdapter();
      const events: AgentStreamEvent[] = [];
      for await (const event of adapter.streamMessage(makeOptions())) {
        events.push(event);
      }

      expect(events).toContainEqual({ type: "text", content: "Hello" });
      expect(events).toContainEqual({ type: "text", content: " world" });
      expect(events).toContainEqual({ type: "done", content: "" });
    });

    it("sends stream: true in request", async () => {
      const body = makeStreamBody([
        '{"done":true,"message":{"content":""}}',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body,
      });

      const adapter = new OllamaAdapter();
      const events: AgentStreamEvent[] = [];
      for await (const event of adapter.streamMessage(makeOptions())) {
        events.push(event);
      }

      const requestBody = JSON.parse(
        mockFetch.mock.calls[0]![1].body as string,
      );
      expect(requestBody.stream).toBe(true);
    });

    it("throws on non-OK response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const adapter = new OllamaAdapter();
      await expect(async () => {
        for await (const _event of adapter.streamMessage(makeOptions())) {
          // consume
        }
      }).rejects.toThrow("Ollama stream failed: 404 Not Found");
    });
  });
});

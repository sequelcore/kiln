import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CreateMessageOptions,
  AgentStreamEvent,
  ToolDefinition,
} from "@kilnai/core/agents";
import { extractText, textParts } from "@kilnai/core/engine";
import {
  OllamaAdapter,
  LLAMA3,
  CODELLAMA,
  DEEPSEEK_CODER,
} from "../../../src/agents/provider-adapters/ollama.js";

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
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    it("serializes base64 image parts without dropping text", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: "OK" },
          done: true,
        }),
      });

      const adapter = new OllamaAdapter();
      await adapter.createMessage(makeOptions({
        messages: [{
          role: "user",
          parts: [
            { type: "text", text: "Inspect this." },
            { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
          ],
        }],
      }));

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(body.messages.at(-1)).toEqual({
        role: "user",
        content: "Inspect this.",
        images: ["iVBORw0KGgo="],
      });
    });

    it("fails closed before request for image URL parts", async () => {
      const adapter = new OllamaAdapter();

      await expect(adapter.createMessage(makeOptions({
        messages: [{
          role: "user",
          parts: [
            { type: "text", text: "Inspect this." },
            { type: "image", mimeType: "image/png", url: "https://example.test/image.png" },
          ],
        }],
      }))).rejects.toThrow("unsupported_modality");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fails closed before request for audio and file parts", async () => {
      const adapter = new OllamaAdapter();

      await expect(adapter.createMessage(makeOptions({
        messages: [{
          role: "user",
          parts: [
            { type: "audio", mimeType: "audio/mp4", data: "AAAA" },
          ],
        }],
      }))).rejects.toThrow("unsupported_modality");

      await expect(adapter.createMessage(makeOptions({
        messages: [{
          role: "user",
          parts: [
            { type: "file", mimeType: "application/pdf", data: "JVBERi0=", filename: "doc.pdf" },
          ],
        }],
      }))).rejects.toThrow("unsupported_modality");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fails closed before request for multimodal tool-result content parts", async () => {
      const adapter = new OllamaAdapter();

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

  describe("tool call identity", () => {
    function toolCallResponse(names: string[]) {
      return {
        ok: true,
        json: async () => ({
          message: {
            content: "",
            tool_calls: names.map((name) => ({
              function: { name, arguments: { query: "test" } },
            })),
          },
          done: true,
          prompt_eval_count: 20,
          eval_count: 10,
        }),
      };
    }

    it("derives a deterministic id from the request body + tool-call ordinal", async () => {
      mockFetch.mockResolvedValueOnce(toolCallResponse(["search"]));
      const adapter = new OllamaAdapter();
      const options = makeOptions({ tools: [makeToolDef()] });
      const response = await adapter.createMessage(options);

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]!.id).toMatch(/^synth1:[0-9a-f]{64}:0:[0-9a-f]{64}$/);
    });

    it("produces the identical id across two independent normalizations of the same request", async () => {
      const options = makeOptions({ tools: [makeToolDef()] });

      mockFetch.mockResolvedValueOnce(toolCallResponse(["search"]));
      const first = await new OllamaAdapter().createMessage(options);

      mockFetch.mockResolvedValueOnce(toolCallResponse(["search"]));
      const second = await new OllamaAdapter().createMessage(options);

      expect(first.toolCalls[0]!.id).toBe(second.toolCalls[0]!.id);
    });

    it("produces distinct ids for distinct tool-call ordinals in the same response", async () => {
      mockFetch.mockResolvedValueOnce(toolCallResponse(["search", "search"]));
      const adapter = new OllamaAdapter();
      const response = await adapter.createMessage(makeOptions({ tools: [makeToolDef()] }));

      expect(response.toolCalls).toHaveLength(2);
      expect(response.toolCalls[0]!.id).not.toBe(response.toolCalls[1]!.id);
    });

    it("produces a different id for a fixed request when the generated response differs", async () => {
      // Ollama's generation is nondeterministic: the same request can return different
      // tool calls at the same ordinal on different attempts. Identity must distinguish
      // them -- otherwise two different calls collide on the same synthetic id.
      const options = makeOptions({ tools: [makeToolDef()] });

      mockFetch.mockResolvedValueOnce(toolCallResponse(["search"]));
      const first = await new OllamaAdapter().createMessage(options);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "",
            tool_calls: [{ function: { name: "delete", arguments: { path: "b" } } }],
          },
          done: true,
          prompt_eval_count: 20,
          eval_count: 10,
        }),
      });
      const second = await new OllamaAdapter().createMessage(options);

      expect(first.toolCalls[0]!.id).not.toBe(second.toolCalls[0]!.id);
    });

    it("re-normalizing the same persisted response for the same request yields the same id", async () => {
      // Replay-stability: the same *response* (not just the same request) must still
      // produce the same id on a second normalization.
      const options = makeOptions({ tools: [makeToolDef()] });

      mockFetch.mockResolvedValueOnce(toolCallResponse(["search"]));
      const first = await new OllamaAdapter().createMessage(options);

      mockFetch.mockResolvedValueOnce(toolCallResponse(["search"]));
      const second = await new OllamaAdapter().createMessage(options);

      expect(first.toolCalls[0]!.id).toBe(second.toolCalls[0]!.id);
    });

    it("produces a different id when the request body differs", async () => {
      mockFetch.mockResolvedValueOnce(toolCallResponse(["search"]));
      const first = await new OllamaAdapter().createMessage(makeOptions({ tools: [makeToolDef()] }));

      mockFetch.mockResolvedValueOnce(toolCallResponse(["search"]));
      const second = await new OllamaAdapter().createMessage(makeOptions({
        messages: [{ role: "user", parts: textParts("A different prompt") }],
        tools: [makeToolDef()],
      }));

      expect(first.toolCalls[0]!.id).not.toBe(second.toolCalls[0]!.id);
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

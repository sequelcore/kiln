import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeAdapter } from "../../../src/agents/provider-adapters/opencode.js";

type FetchCall = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe("OpenCodeAdapter", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("tier 'go' uses providerName 'opencode-go' and the selected model", async () => {

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "minimax-m2.5",
      });

      expect(adapter.name).toBe("opencode-go");
      expect(adapter.tier).toBe("go");
      expect(adapter.defaultModel).toBe("minimax-m2.5");
      expect(adapter.deliberationTransport).toBe("none");
    });

    it("tier 'zen' uses providerName 'opencode-zen' and the selected model", async () => {

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "zen",
        defaultModel: "anthropic/claude-sonnet-4-6",
      });

      expect(adapter.name).toBe("opencode-zen");
      expect(adapter.tier).toBe("zen");
      expect(adapter.defaultModel).toBe("anthropic/claude-sonnet-4-6");
    });

    it("fails fast when the selected model is blank", async () => {

      expect(() => new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "   ",
      })).toThrow("OpenCode adapter requires a selected model");
    });

    it("explicit defaultModel override is honored for tier 'go'", async () => {

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "qwen3.6-plus",
      });

      expect(adapter.name).toBe("opencode-go");
      expect(adapter.tier).toBe("go");
      expect(adapter.defaultModel).toBe("qwen3.6-plus");
    });

    it("explicit defaultModel override is honored for tier 'zen'", async () => {

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "zen",
        defaultModel: "openai/gpt-5.4",
      });

      expect(adapter.name).toBe("opencode-zen");
      expect(adapter.tier).toBe("zen");
      expect(adapter.defaultModel).toBe("openai/gpt-5.4");
    });

    it("routes tier 'go' chat calls through the OpenCode Go subscription endpoint", async () => {
      const fetchMock = vi.fn<FetchCall>(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "minimax-m2.5",
      });

      await adapter.createMessage({
        sessionId: "session-123",
        requestIdentity: { projectId: "project-456", requestId: "request-789" },
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://opencode.ai/zen/go/v1/chat/completions",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-opencode-client": "kiln",
          }),
        }),
      );
      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(request.headers);
      expect(headers.get("x-opencode-session")).toBe("session-123");
      expect(headers.get("x-opencode-project")).toBe("project-456");
      expect(headers.get("x-opencode-request")).toBe("request-789");
      expect(headers.get("x-opencode-client")).toBe("kiln");
      expect(headers.get("user-agent")).toBe("kiln/3.0.0-beta.1");
    });

    it.each([undefined, "", "   "])(
      "rejects an OpenCode Go request with session ID %j before provider I/O",
      async (sessionId) => {
        const fetchMock = vi.fn<FetchCall>(async () => new Response(JSON.stringify({
          choices: [{ message: { content: "unexpected" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })));
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        const admit = vi.fn();
        const transportEvents: unknown[] = [];
        const adapter = new OpenCodeAdapter({
          apiKey: "sk-test",
          tier: "go",
          defaultModel: "glm-5.2",
        });

        await expect(adapter.createMessage({
          ...(sessionId === undefined ? {} : { sessionId }),
          system: "test",
          messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
          transportAdmission: { admit },
          transportObserver: { onEvent: (event) => transportEvents.push(event) },
        })).rejects.toThrow("OpenCode Go requests require a non-empty session ID");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(admit).not.toHaveBeenCalled();
        expect(transportEvents).toEqual([]);
      },
    );

    it("rejects a public OpenCode Go streaming request without a session ID before provider I/O", async () => {
      const fetchMock = vi.fn<FetchCall>(async () => new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      }));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "glm-5.2",
      });

      const consume = async (): Promise<void> => {
        for await (const _event of adapter.streamMessage({
          system: "test",
          messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        })) {
          // Consume the public stream so provider I/O would occur without the guard.
        }
      };

      await expect(consume()).rejects.toThrow("OpenCode Go requests require a non-empty session ID");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses the official streaming chat path for tool-capable OpenCode Go turns", async () => {
      const stream = [
        `data: ${JSON.stringify({ id: "chat-1", choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "write", arguments: '{"filePath":"proof.txt",' } }] }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ id: "chat-1", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"after"}' } }] }, finish_reason: "tool_calls" }] })}`,
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 3 } } })}`,
        "data: [DONE]",
        "",
      ].join("\n");
      const fetchMock = vi.fn<FetchCall>(async () => new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      }));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "glm-5.2",
      });

      const result = await adapter.createMessage({
        sessionId: "session-tools",
        system: "Use the admitted tool.",
        messages: [{ role: "user", parts: [{ type: "text", text: "Write the fixture." }] }],
        tools: [{
          name: "write",
          description: "Write one admitted file.",
          inputSchema: { type: "object", properties: { filePath: { type: "string" }, content: { type: "string" } }, required: ["filePath", "content"] },
          tags: new Set(["write"]),
        }],
        toolChoice: { type: "any" },
      });

      expect(result).toMatchObject({
        inputTokens: 12,
        outputTokens: 7,
        cacheReadTokens: 3,
        stopReason: "tool_calls",
        toolCalls: [{ id: "call-1", name: "write", input: { filePath: "proof.txt", content: "after" } }],
      });
      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(request.body))).toMatchObject({
        stream: true,
        stream_options: { include_usage: true },
        tool_choice: "required",
      });
      expect(new Headers(request.headers).get("x-opencode-session")).toBe("session-tools");
    });

    it("does not wait for transport cancellation after the provider sends DONE", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            `data: ${JSON.stringify({ id: "chat-1", choices: [{ delta: { content: "complete" }, finish_reason: "stop" }] })}`,
            `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 1 } })}`,
            "data: [DONE]",
            "",
          ].join("\n")));
        },
        cancel() {
          return new Promise<void>(() => undefined);
        },
      });
      globalThis.fetch = vi.fn(async () => new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      })) as unknown as typeof globalThis.fetch;
      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "kimi-k2.7-code",
      });
      const events: unknown[] = [];

      await expect(adapter.createMessage({
        sessionId: "session-completed-stream",
        system: "Use the admitted tool.",
        messages: [{ role: "user", parts: [{ type: "text", text: "Finish." }] }],
        tools: [{
          name: "write",
          description: "Write one admitted file.",
          inputSchema: { type: "object", properties: {} },
          tags: new Set(["write"]),
        }],
        transportObserver: { onEvent: (event) => events.push(event) },
      })).resolves.toMatchObject({
        inputTokens: 4,
        outputTokens: 1,
        stopReason: "stop",
      });
      expect(events).toContainEqual(expect.objectContaining({ type: "request_completed" }));
    });

    it("lowers Moonshot tool schemas and caps Kimi output tokens to the official catalog limit", async () => {
      const fetchMock = vi.fn<FetchCall>(async () => new Response([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}`,
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}`,
        "data: [DONE]",
        "",
      ].join("\n")));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      const adapter = new OpenCodeAdapter({ apiKey: "sk-test", tier: "go", defaultModel: "kimi-k2.7-code" });

      await adapter.createMessage({
        sessionId: "session-moonshot-schema",
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        maxTokens: 999_999,
        tools: [{
          name: "tuple",
          description: "Test Moonshot schema lowering.",
          inputSchema: {
            type: "object",
            properties: {
              values: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }], unevaluatedItems: false },
              mixed: { type: "array", prefixItems: [{ type: "string" }], items: { type: "number" } },
              reusable: { $ref: "#/$defs/value", description: "Must be removed beside ref." },
            },
          },
          tags: new Set(),
        }],
      });

      const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
      expect(body.max_tokens).toBe(32_000);
      expect(body.tools[0].function.parameters.properties.values).toEqual({ type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } });
      expect(body.tools[0].function.parameters.properties.mixed).toEqual({ type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } });
      expect(body.tools[0].function.parameters.properties.reusable).toEqual({ $ref: "#/$defs/value" });
    });

    it("bounds non-2xx tool-stream bodies and records a safe failure phase", async () => {
      globalThis.fetch = vi.fn(async () => new Response("provider failure", { status: 503 })) as unknown as typeof globalThis.fetch;
      const events: unknown[] = [];
      const adapter = new OpenCodeAdapter({ apiKey: "sk-test", tier: "go", defaultModel: "glm-5.2", internalRetry: false });

      await expect(adapter.createMessage({
        sessionId: "session-provider-error",
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        tools: [{ name: "write", description: "write", inputSchema: { type: "object" }, tags: new Set() }],
        transportWatchdog: { firstByteTimeoutMs: 100 },
        transportObserver: { onEvent: (event) => events.push(event) },
      })).rejects.toThrow("opencode-go API error 503");

      expect(events).toContainEqual(expect.objectContaining({ type: "response_first_byte" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "request_failed", phase: "headers" }));
    });

    it("omits unsafe identity values from both OpenCode headers and transport observations", async () => {
      const fetchMock = vi.fn<FetchCall>(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      const events: unknown[] = [];
      const adapter = new OpenCodeAdapter({ apiKey: "sk-test", tier: "go", defaultModel: "glm-5.2" });

      await adapter.createMessage({
        sessionId: "session-unsafe-identity",
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        requestIdentity: { projectId: "../private-project", requestId: "secret value" },
        transportObserver: { onEvent: (event) => events.push(event) },
      });

      const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
      expect(headers.has("x-opencode-project")).toBe(false);
      expect(headers.has("x-opencode-request")).toBe(false);
      expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ identity: undefined })]));
    });

    it("cancels the response body when the first-byte watchdog expires", async () => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        cancel() { cancelled = true; },
      });
      globalThis.fetch = vi.fn(async () => new Response(stream)) as unknown as typeof globalThis.fetch;
      const events: unknown[] = [];
      const adapter = new OpenCodeAdapter({ apiKey: "sk-test", tier: "go", defaultModel: "glm-5.2", internalRetry: false });

      await expect(adapter.createMessage({
        sessionId: "session-first-byte-timeout",
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        tools: [{ name: "write", description: "write", inputSchema: { type: "object" }, tags: new Set() }],
        transportWatchdog: { firstByteTimeoutMs: 5 },
        transportObserver: { onEvent: (event) => events.push(event) },
      })).rejects.toThrow("first_byte");

      expect(cancelled).toBe(true);
      expect(events).toContainEqual(expect.objectContaining({ type: "request_failed", phase: "first_byte" }));
    });

    it("reports first-byte phase when the caller aborts an open response body", async () => {
      const stream = new ReadableStream<Uint8Array>({});
      globalThis.fetch = vi.fn(async () => new Response(stream)) as unknown as typeof globalThis.fetch;
      const controller = new AbortController();
      const events: unknown[] = [];
      const adapter = new OpenCodeAdapter({ apiKey: "sk-test", tier: "go", defaultModel: "glm-5.2", internalRetry: false });
      const request = adapter.createMessage({
        sessionId: "session-caller-abort",
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        tools: [{ name: "write", description: "write", inputSchema: { type: "object" }, tags: new Set() }],
        signal: controller.signal,
        transportObserver: { onEvent: (event) => events.push(event) },
      });
      controller.abort();

      await expect(request).rejects.toBeDefined();
      expect(events).toContainEqual(expect.objectContaining({ type: "request_failed", phase: "first_byte" }));
    });

    it("routes tier 'zen' chat calls through the OpenCode Zen endpoint", async () => {
      const fetchMock = vi.fn<FetchCall>(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "zen",
        defaultModel: "anthropic/claude-sonnet-4-6",
      });

      await adapter.createMessage({
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://opencode.ai/zen/v1/chat/completions",
        expect.any(Object),
      );
    });

    it("passes caller abort signals to OpenCode chat requests", async () => {
      const fetchMock = vi.fn<FetchCall>(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      const controller = new AbortController();

      const adapter = new OpenCodeAdapter({
        apiKey: "sk-test",
        tier: "go",
        defaultModel: "qwen3.6-plus",
      });

      await adapter.createMessage({
        sessionId: "session-abort-signal",
        system: "test",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        signal: controller.signal,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://opencode.ai/zen/go/v1/chat/completions",
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

});

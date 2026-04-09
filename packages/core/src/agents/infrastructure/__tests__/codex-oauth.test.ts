import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KilnError } from "../../../engine/errors.js";
import type {
  AgentResponse,
  AgentStreamEvent,
  CreateMessageOptions,
} from "../../index.js";

const mockFetch = vi.fn();
const mockGetValidAccessToken = vi.fn();

vi.mock("../codex-oauth-auth.js", () => ({
  CodexOAuthAuth: vi.fn(function MockCodexOAuthAuth() {
    return {
      getValidAccessToken: mockGetValidAccessToken,
    };
  }).mockImplementation(function MockCodexOAuthAuth() {
    return {
      getValidAccessToken: mockGetValidAccessToken,
    };
  }),
}));

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function sseResponse(
  events: ReadonlyArray<{ event: string; data: unknown }>,
  status = 200,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const entry of events) {
        controller.enqueue(
          encoder.encode(`event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`),
        );
      }
      controller.close();
    },
  });

  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function createOptions(overrides: Partial<CreateMessageOptions> = {}): CreateMessageOptions {
  return {
    system: "You are a Codex agent.",
    messages: [
      { role: "user", parts: [{ type: "text", text: "Hello there" }] },
      { role: "assistant", parts: [{ type: "text", text: "Previous reply" }] },
    ],
    maxTokens: 512,
    ...overrides,
  };
}

async function collectEvents(stream: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function createAdapter(defaultModel?: string) {
  const { CodexOAuthAdapter } = await import("../codex-oauth.js");
  const { CodexOAuthAuth } = await import("../codex-oauth-auth.js");
  const auth = new CodexOAuthAuth() as unknown as {
    getValidAccessToken: typeof mockGetValidAccessToken;
  };
  const adapter = new CodexOAuthAdapter({
    auth,
    ...(defaultModel ? { defaultModel } : {}),
  });
  return { adapter, auth };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockGetValidAccessToken.mockReset();
  mockGetValidAccessToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("CodexOAuthAdapter", () => {
  describe("constructor", () => {
    it("name property returns codex-oauth and defaultModel defaults to gpt-5.4", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        id: "resp_1",
        status: "completed",
        output: [],
        usage: { input_tokens: 1, output_tokens: 0 },
      }));

      const { adapter } = await createAdapter();
      await adapter.createMessage(createOptions());

      expect(adapter.name).toBe("codex-oauth");
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as { model: string };
      expect(body.model).toBe("gpt-5.4");
    });
  });

  describe("createMessage", () => {
    it("sends POST to https://chatgpt.com/backend-api/codex/responses with Authorization Bearer token", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        id: "resp_1",
        status: "completed",
        output: [],
        usage: { input_tokens: 4, output_tokens: 2 },
      }));

      const { adapter } = await createAdapter("gpt-5.4");
      await adapter.createMessage(createOptions());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      });
    });

    it("calls auth.getValidAccessToken() before each request", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        id: "resp_2",
        status: "completed",
        output: [],
        usage: { input_tokens: 2, output_tokens: 1 },
      }));

      const { adapter, auth } = await createAdapter();
      await adapter.createMessage(createOptions());

      expect(auth.getValidAccessToken).toHaveBeenCalledTimes(1);
      expect(auth.getValidAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
        mockFetch.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    });

    it("maps Kiln system+messages to Responses API input format", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        id: "resp_3",
        status: "completed",
        output: [],
        usage: { input_tokens: 3, output_tokens: 1 },
      }));

      const { adapter } = await createAdapter("gpt-5.4");
      await adapter.createMessage(createOptions({
        system: "System instruction",
        messages: [
          { role: "user", parts: [{ type: "text", text: "User prompt" }] },
          { role: "assistant", parts: [{ type: "text", text: "Assistant reply" }] },
        ],
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as {
        model: string;
        input: Array<{ role: string; content: string }>;
        max_output_tokens: number;
      };

      expect(body).toMatchObject({
        model: "gpt-5.4",
        max_output_tokens: 512,
        input: [
          { role: "system", content: "System instruction" },
          { role: "user", content: "User prompt" },
          { role: "assistant", content: "Assistant reply" },
        ],
      });
    });

    it("maps tools from Kiln ToolDefinition[] to Responses API tools format", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        id: "resp_4",
        status: "completed",
        output: [],
        usage: { input_tokens: 5, output_tokens: 1 },
      }));

      const { adapter } = await createAdapter();
      await adapter.createMessage(createOptions({
        tools: [
          {
            name: "lookup_weather",
            description: "Looks up weather for a city",
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
            tags: new Set(["weather"]),
          },
        ],
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as {
        tools?: Array<{
          type: string;
          function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
        }>;
      };

      expect(body.tools).toEqual([
        {
          type: "function",
          function: {
            name: "lookup_weather",
            description: "Looks up weather for a city",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        },
      ]);
    });

    it("maps response output back to AgentResponse (parts, toolCalls, token counts)", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        id: "resp_5",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "Adapter response text" },
            ],
          },
          {
            type: "function_call",
            id: "call_1",
            name: "lookup_weather",
            arguments: "{\"city\":\"Tijuana\"}",
          },
        ],
        usage: {
          input_tokens: 123,
          output_tokens: 45,
          cached_tokens: 7,
        },
      }));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions()) as AgentResponse & {
        cost?: { inputPer1M: number; outputPer1M: number };
      };

      expect(response).toMatchObject({
        parts: [{ type: "text", text: "Adapter response text" }],
        inputTokens: 123,
        outputTokens: 45,
        cacheReadTokens: 7,
        cacheWriteTokens: 0,
        toolCalls: [
          {
            id: "call_1",
            name: "lookup_weather",
            input: { city: "Tijuana" },
          },
        ],
        stopReason: "completed",
      });
      expect(response.cost).toEqual({
        inputPer1M: 0,
        outputPer1M: 0,
      });
    });

    it("sets inputPer1M=0, outputPer1M=0 in cost (subscription = zero marginal)", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        id: "resp_6",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 9,
          output_tokens: 3,
        },
      }));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions()) as AgentResponse & {
        cost?: { inputPer1M: number; outputPer1M: number };
      };

      expect(response.cost).toEqual({
        inputPer1M: 0,
        outputPer1M: 0,
      });
    });

    it("retries once on 401 (refreshes token, retries request)", async () => {
      mockGetValidAccessToken
        .mockResolvedValueOnce("expired-token")
        .mockResolvedValueOnce("fresh-token");
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
        .mockResolvedValueOnce(jsonResponse(200, {
          id: "resp_7",
          status: "completed",
          output: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }));

      const { adapter, auth } = await createAdapter();
      await adapter.createMessage(createOptions());

      expect(auth.getValidAccessToken).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const firstHeaders = (mockFetch.mock.calls[0]?.[1] as RequestInit).headers;
      const secondHeaders = (mockFetch.mock.calls[1]?.[1] as RequestInit).headers;
      expect(firstHeaders).toEqual({
        Authorization: "Bearer expired-token",
        "Content-Type": "application/json",
      });
      expect(secondHeaders).toEqual({
        Authorization: "Bearer fresh-token",
        "Content-Type": "application/json",
      });
    });

    it("throws KilnError on 401 after retry", async () => {
      mockGetValidAccessToken
        .mockResolvedValueOnce("token-1")
        .mockResolvedValueOnce("token-2");
      mockFetch
        .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
        .mockResolvedValueOnce(jsonResponse(401, { error: "still-unauthorized" }));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions())).rejects.toBeInstanceOf(KilnError);
    });

    it("throws KilnError on non-200 non-401 responses", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: "server_error" }));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions())).rejects.toBeInstanceOf(KilnError);
    });
  });

  describe("streamMessage", () => {
    it("sends POST with stream:true, returns async generator", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 4, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const stream = adapter.streamMessage(createOptions());
      const events = await collectEvents(stream);

      expect(Symbol.asyncIterator in stream).toBe(true);
      expect(events.at(-1)?.type).toBe("done");

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as { stream: boolean };
      expect(body.stream).toBe(true);
    });

    it("yields text delta events from response.output_text.delta SSE", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        { event: "response.output_text.delta", data: { delta: "Hello " } },
        { event: "response.output_text.delta", data: { delta: "world" } },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_2",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "Hello world" }],
                },
              ],
              usage: { input_tokens: 10, output_tokens: 3 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions()));

      expect(events.filter((event) => event.type === "text")).toEqual([
        { type: "text", content: "Hello " },
        { type: "text", content: "world" },
      ]);
    });

    it("yields tool call events from response.function_call SSE", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.function_call.delta",
          data: {
            delta: "{\"id\":\"call_stream_1\",\"name\":\"lookup_weather\",\"arguments\":\"{\\\"city\\\":\\\"Tijuana\\\"}\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_3",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "call_stream_1",
                  name: "lookup_weather",
                  arguments: "{\"city\":\"Tijuana\"}",
                },
              ],
              usage: { input_tokens: 5, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions()));
      const toolEvent = events.find((event) => event.type === "tool_use");

      expect(toolEvent).toBeDefined();
      expect(JSON.parse(toolEvent!.content)).toEqual({
        id: "call_stream_1",
        name: "lookup_weather",
        input: { city: "Tijuana" },
      });
    });

    it("yields final done event with full AgentResponse on response.completed", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        { event: "response.output_text.delta", data: { delta: "Final " } },
        { event: "response.output_text.delta", data: { delta: "answer" } },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_4",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "Final answer" }],
                },
                {
                  type: "function_call",
                  id: "call_stream_2",
                  name: "lookup_weather",
                  arguments: "{\"city\":\"Mexico City\"}",
                },
              ],
              usage: {
                input_tokens: 22,
                output_tokens: 6,
                cached_tokens: 3,
              },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions()));
      const doneEvent = events.at(-1) as AgentStreamEvent & {
        inputTokens?: number;
        outputTokens?: number;
        response?: AgentResponse & {
          cost?: { inputPer1M: number; outputPer1M: number };
        };
      };

      expect(doneEvent.type).toBe("done");
      expect(doneEvent.inputTokens).toBe(22);
      expect(doneEvent.outputTokens).toBe(6);
      expect(doneEvent.response).toMatchObject({
        parts: [{ type: "text", text: "Final answer" }],
        inputTokens: 22,
        outputTokens: 6,
        cacheReadTokens: 3,
        cacheWriteTokens: 0,
        toolCalls: [
          {
            id: "call_stream_2",
            name: "lookup_weather",
            input: { city: "Mexico City" },
          },
        ],
        stopReason: "completed",
        cost: {
          inputPer1M: 0,
          outputPer1M: 0,
        },
      });
    });

    it("calls getValidAccessToken() before streaming", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_5",
              status: "completed",
              output: [],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter, auth } = await createAdapter();
      await collectEvents(adapter.streamMessage(createOptions()));

      expect(auth.getValidAccessToken).toHaveBeenCalledTimes(1);
      expect(auth.getValidAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
        mockFetch.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    });
  });
});

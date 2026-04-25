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

function sseResponseWithCrLf(
  events: ReadonlyArray<{ event: string; data: unknown }>,
  status = 200,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const entry of events) {
        controller.enqueue(
          encoder.encode(`event: ${entry.event}\r\ndata: ${JSON.stringify(entry.data)}\r\n\r\n`),
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
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
        },
      ]));

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
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 4, output_tokens: 2 },
            },
          },
        },
      ]));

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
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_2",
              status: "completed",
              output: [],
              usage: { input_tokens: 2, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter, auth } = await createAdapter();
      await adapter.createMessage(createOptions());

      expect(auth.getValidAccessToken).toHaveBeenCalledTimes(1);
      expect(auth.getValidAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
        mockFetch.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    });

    it("maps Kiln system+messages to Responses API input format", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_3",
              status: "completed",
              output: [],
              usage: { input_tokens: 3, output_tokens: 1 },
            },
          },
        },
      ]));

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
        instructions: string;
        store: boolean;
        stream: boolean;
        input: Array<{ role: string; content: string }>;
        max_output_tokens: number;
      };

      expect(body).toMatchObject({
        model: "gpt-5.4",
        instructions: "System instruction",
        store: false,
        stream: true,
        max_output_tokens: 512,
        input: [
          { role: "user", content: "User prompt" },
          { role: "assistant", content: "Assistant reply" },
        ],
      });
    });

    it("maps tools from Kiln ToolDefinition[] to Responses API tools format", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_4",
              status: "completed",
              output: [],
              usage: { input_tokens: 5, output_tokens: 1 },
            },
          },
        },
      ]));

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
              additionalProperties: false,
            },
            tags: new Set(["weather"]),
          },
        ],
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as {
        tools?: Array<{
          type: string;
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        }>;
      };

      expect(body.tools).toEqual([
        {
          type: "function",
          name: "lookup_weather",
          description: "Looks up weather for a city",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
            additionalProperties: false,
          },
          strict: true,
        },
      ]);
    });

    it("converts optional object properties into Codex strict-mode compatible nullable required fields", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_4b",
              status: "completed",
              output: [],
              usage: { input_tokens: 5, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      await adapter.createMessage(createOptions({
        tools: [
          {
            name: "glob",
            description: "Match files by glob pattern.",
            inputSchema: {
              type: "object",
              properties: {
                pattern: { type: "string" },
                path: { type: "string" },
              },
              required: ["pattern"],
              additionalProperties: false,
            },
            tags: new Set(["search"]),
          },
        ],
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as {
        tools?: Array<{
          name: string;
          strict: boolean;
          parameters: {
            type: string;
            required: string[];
            additionalProperties: boolean;
            properties: {
              pattern: { type: string };
              path: { type: string[] };
            };
          };
        }>;
      };

      expect(body.tools).toEqual([
        {
          type: "function",
          name: "glob",
          description: "Match files by glob pattern.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              pattern: { type: "string" },
              path: { type: ["string", "null"] },
            },
            required: ["pattern", "path"],
            additionalProperties: false,
          },
        },
      ]);
    });

    it("serializes tool_result parts as function_call_output input items", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_tool_result_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 6, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      await adapter.createMessage(createOptions({
        messages: [
          {
            role: "assistant",
            parts: [
              { type: "text", text: "Let me check that." },
              { type: "tool_use", id: "call_123", name: "read", input: { filePath: "docs/changelog.md" } },
            ],
          },
          {
            role: "user",
            parts: [
              { type: "tool_result", toolUseId: "call_123", content: "hotfix content" },
            ],
          },
        ],
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as {
        input: Array<
          | { role: string; content: string }
          | { type: string; call_id?: string; output?: string }
        >;
      };

      expect(body.input).toEqual([
        { role: "assistant", content: "Let me check that." },
        {
          type: "function_call",
          call_id: "call_123",
          name: "read",
          arguments: "{\"filePath\":\"docs/changelog.md\"}",
        },
        { type: "function_call_output", call_id: "call_123", output: "hotfix content" },
      ]);
    });

    it("serializes assistant tool_use parts as function_call input items", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_tool_use_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 7, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      await adapter.createMessage(createOptions({
        messages: [
          {
            role: "assistant",
            parts: [
              { type: "tool_use", id: "call_456", name: "read", input: { filePath: "docs/changelog.md" } },
            ],
          },
        ],
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as {
        input: Array<
          | { role: string; content: string }
          | { type: string; call_id?: string; name?: string; arguments?: string }
        >;
      };

      expect(body.input).toEqual([
        {
          type: "function_call",
          call_id: "call_456",
          name: "read",
          arguments: "{\"filePath\":\"docs/changelog.md\"}",
        },
      ]);
    });

    it("maps response output back to AgentResponse (parts, toolCalls, token counts)", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        { event: "response.output_text.delta", data: { delta: "Adapter " } },
        { event: "response.output_text.delta", data: { delta: "response text" } },
        {
          event: "response.completed",
          data: {
            response: {
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
                input_tokens_details: {
                  cached_tokens: 7,
                },
              },
            },
          },
        },
      ]));

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

    it("repairs invalid tool calls from leading JSON objects emitted as text", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_repair_1",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: "{\"pattern\":\"**/*kiln-context*\",\"path\":\".\",\"outputMode\":\"content\"}I found the right search parameters.",
                    },
                  ],
                },
                {
                  type: "function_call",
                  id: "call_repair_1",
                  name: "glob",
                  arguments: "",
                },
              ],
              usage: {
                input_tokens: 15,
                output_tokens: 5,
              },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toEqual([
        {
          id: "call_repair_1",
          name: "glob",
          input: {
            pattern: "**/*kiln-context*",
            path: ".",
            outputMode: "content",
          },
        },
      ]);
      expect(response.parts).toEqual([
        {
          type: "text",
          text: "I found the right search parameters.",
        },
      ]);
    });

    it("normalizes builtin tool aliases in function-call arguments", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_alias_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "call_alias_1",
                  name: "write",
                  arguments: "{\"path\":\"docs/changelog.md\",\"text\":\"hello\"}",
                },
              ],
              usage: {
                input_tokens: 5,
                output_tokens: 2,
              },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toEqual([
        {
          id: "call_alias_1",
          name: "write",
          input: {
            filePath: "docs/changelog.md",
            content: "hello",
          },
        },
      ]);
    });

    it("does not throw when function-call arguments are malformed JSON", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_invalid_args_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "call_invalid_args_1",
                  name: "write",
                  arguments: "{bad-json}",
                },
              ],
              usage: {
                input_tokens: 5,
                output_tokens: 2,
              },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());
      const { getInvalidToolInputDetails } = await import("../../tool-call-input.js");
      const invalidDetails = getInvalidToolInputDetails(response.toolCalls[0]!.input);

      expect(response.toolCalls[0]?.name).toBe("write");
      expect(invalidDetails).toEqual({
        reason: "Failed to parse tool arguments as JSON.",
        raw: "{bad-json}",
      });
    });

    it("falls back to collected text deltas when response.completed omits message output", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        { event: "response.output_text.delta", data: { delta: "Hello " } },
        { event: "response.output_text.delta", data: { delta: "world" } },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_delta_fallback_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.parts).toEqual([{ type: "text", text: "Hello world" }]);
      expect(response.inputTokens).toBe(8);
      expect(response.outputTokens).toBe(2);
    });

    it("preserves function calls from response.output_item.added when response.completed omits them", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "call_added_1",
              name: "read",
              arguments: "{\"filePath\":\"docs/changelog.md\"}",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_tool_call_fallback_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 12, output_tokens: 3 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toEqual([
        {
          id: "call_added_1",
          name: "read",
          input: { filePath: "docs/changelog.md" },
        },
      ]);
      expect(response.parts).toEqual([]);
    });

    it("restores call_id from streamed function-call items when response.completed only returns the item id", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_added_1",
              call_id: "call_added_1",
              name: "read",
              arguments: "{\"filePath\":\"kiln-context.md\"}",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_tool_call_call_id_fallback_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_added_1",
                },
              ],
              usage: { input_tokens: 13, output_tokens: 4 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toEqual([
        {
          id: "call_added_1",
          name: "read",
          input: { filePath: "kiln-context.md" },
        },
      ]);
    });

    it("restores call_id from response.function_call_arguments.done when output_item.added omits it", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_done_1",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_done_1",
            call_id: "call_done_1",
            name: "read",
            arguments: "{\"filePath\":\"kiln-context.md\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_tool_call_arguments_done_fallback_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_done_1",
                },
              ],
              usage: { input_tokens: 14, output_tokens: 5 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toEqual([
        {
          id: "call_done_1",
          name: "read",
          input: { filePath: "kiln-context.md" },
        },
      ]);
    });

    it("recovers completed function-call arguments from response.output_item.done", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_done_evt_1",
              call_id: "call_done_evt_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.output_item.done",
          data: {
            item: {
              type: "function_call",
              id: "fc_done_evt_1",
              call_id: "call_done_evt_1",
              name: "read",
              arguments: "{\"filePath\":\"kiln-context.md\",\"offset\":0,\"limit\":200}",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_output_item_done_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 10, output_tokens: 3 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toEqual([
        {
          id: "call_done_evt_1",
          name: "read",
          input: {
            filePath: "kiln-context.md",
            offset: 0,
            limit: 200,
          },
        },
      ]);
    });

    it("parses SSE streams that use CRLF separators", async () => {
      mockFetch.mockResolvedValueOnce(sseResponseWithCrLf([
        { event: "response.output_text.delta", data: { delta: "Hello from " } },
        { event: "response.output_text.delta", data: { delta: "CRLF" } },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_crlf_1",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "Hello from CRLF" }],
                },
              ],
              usage: { input_tokens: 11, output_tokens: 4 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.parts).toEqual([{ type: "text", text: "Hello from CRLF" }]);
      expect(response.inputTokens).toBe(11);
      expect(response.outputTokens).toBe(4);
    });

    it("sets inputPer1M=0, outputPer1M=0 in cost (subscription = zero marginal)", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_6",
              status: "completed",
              output: [],
              usage: {
                input_tokens: 9,
                output_tokens: 3,
              },
            },
          },
        },
      ]));

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
        .mockResolvedValueOnce(sseResponse([
          {
            event: "response.completed",
            data: {
              response: {
                id: "resp_7",
                status: "completed",
                output: [],
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            },
          },
        ]));

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
    it("sends POST with store:false and stream:true, returns async generator", async () => {
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
      const body = JSON.parse(String(init.body)) as { store: boolean; stream: boolean };
      expect(body.store).toBe(false);
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

    it("yields tool call events from response.output_item.added SSE", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "call_stream_1",
              name: "lookup_weather",
              arguments: "{\"city\":\"Tijuana\"}",
              call_id: "call_stream_1",
            },
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
                input_tokens_details: {
                  cached_tokens: 3,
                },
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentResponse,
  AgentStreamEvent,
  CreateMessageOptions,
  ProviderTransportEvent,
} from "@kilnai/core/agents";
import {
  KNOWN_DELIBERATION_LEVEL_IDS,
  getInvalidToolInputDetails,
  resolveCommunicationIntent,
  resolveCommunicationProfile,
} from "@kilnai/core/agents";
import { CodexOAuthAdapter } from "../../../src/agents/provider-adapters/codex-oauth.js";

const mockFetch = vi.fn();
const mockGetValidAccessToken = vi.fn();

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

function rawSseResponse(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function stalledSseResponse(
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
    },
  });

  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function delayedSseResponse(
  immediateEvents: ReadonlyArray<{ event: string; data: unknown }>,
  delayedEvents: ReadonlyArray<{ event: string; data: unknown }>,
  delayMs: number,
  status = 200,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const entry of immediateEvents) {
        controller.enqueue(
          encoder.encode(`event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`),
        );
      }
      setTimeout(() => {
        for (const entry of delayedEvents) {
          controller.enqueue(
            encoder.encode(`event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`),
          );
        }
        controller.close();
      }, delayMs);
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

function readToolDefinition(): NonNullable<CreateMessageOptions["tools"]>[number] {
  return {
    name: "read",
    description: "Read a file.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"],
      additionalProperties: false,
    },
    tags: new Set(["read"]),
  };
}

async function expectProviderUnavailableAfterIncompleteIdle(
  action: () => Promise<unknown>,
): Promise<void> {
  vi.useFakeTimers();
  try {
    const promise = action();
    promise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30001);
    await expect(promise).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "Codex OAuth stream completed without response.completed event",
    });
  } finally {
    vi.useRealTimers();
  }
}

async function resolveAfterIncompleteIdle<T>(
  action: () => Promise<T>,
): Promise<T> {
  vi.useFakeTimers();
  try {
    const promise = action();
    promise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30001);
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

async function createAdapter(defaultModel = "gpt-5.4", internalRetry?: boolean) {
  const auth = { getValidAccessToken: mockGetValidAccessToken };
  const adapter = new CodexOAuthAdapter({
    auth,
    defaultModel,
    ...(internalRetry !== undefined ? { internalRetry } : {}),
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
    it("name property returns codex-oauth and sends the selected model", async () => {
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

    it("fails fast when the selected model is blank", async () => {
      expect(() => new CodexOAuthAdapter({
        auth: { getValidAccessToken: mockGetValidAccessToken },
        defaultModel: "   ",
      })).toThrow("Codex OAuth adapter requires a selected model");
    });
  });

  describe("createMessage", () => {
    it("checks physical transport admission before fetch", async () => {
      const { adapter } = await createAdapter();
      const denied = new Error("physical request budget exhausted");

      await expect(adapter.createMessage(createOptions({
        transportAdmission: { admit: () => { throw denied; } },
      }))).rejects.toBe(denied);

      expect(mockFetch).not.toHaveBeenCalled();
    });

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

    it("sends an admitted exact deliberation level to the Codex Responses endpoint", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_reasoning",
              status: "completed",
              output: [],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter("gpt-5.4");
      await adapter.createMessage(createOptions({
        deliberationResolution: {
          status: "exact",
          requested: {
            mode: "fixed",
            preferredLevel: KNOWN_DELIBERATION_LEVEL_IDS.high,
            onUnsupported: "deny",
          },
          selectedLevel: KNOWN_DELIBERATION_LEVEL_IDS.high,
          source: "operator",
          capabilityEvidence: {
            sourceIdentity: "codex-model-catalog",
            sourceRevision: "7",
            observedAt: "2026-08-02T00:00:00.000Z",
          },
        },
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as { reasoning?: { effort?: string } };
      expect(body.reasoning).toEqual({ effort: "high" });
    });

    it("does not send an override for provider-default deliberation", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([{
        event: "response.completed",
        data: {
          response: {
            id: "resp_default",
            status: "completed",
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      }]));

      const { adapter } = await createAdapter("gpt-5.4");
      await adapter.createMessage(createOptions({
        deliberationResolution: {
          status: "defaulted",
          requested: { mode: "provider-default", onUnsupported: "omit" },
          selectedLevel: KNOWN_DELIBERATION_LEVEL_IDS.medium,
          source: "provider-default",
          capabilityEvidence: {
            sourceIdentity: "codex-model-catalog",
            sourceRevision: "7",
            observedAt: "2026-08-02T00:00:00.000Z",
          },
        },
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as { reasoning?: unknown };
      expect(body.reasoning).toBeUndefined();
    });

    it("sends revisioned response detail through the Responses text control", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([{
        event: "response.completed",
        data: {
          response: {
            id: "resp_detail",
            status: "completed",
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      }]));

      const { adapter } = await createAdapter("gpt-5.4");
      const communicationResolution = resolveCommunicationProfile({
        intent: resolveCommunicationIntent([{
          source: "user",
          intent: { responseDetail: "detailed", onUnsupported: "deny" },
        }]),
        execution: {
          provider: "codex-oauth",
          model: "gpt-5.4",
          surface: "runtime",
        },
        capabilities: {
          provider: "codex-oauth",
          model: "gpt-5.4",
          responseDetail: {
            mechanism: "native",
            supported: ["concise", "standard", "detailed"],
            nativeValues: { concise: "low", standard: "medium", detailed: "high" },
          },
          evidence: {
            sourceIdentity: "codex-model-catalog",
            sourceRevision: "9",
            observedAt: "2026-08-13T00:00:00.000Z",
          },
        },
      });
      await adapter.createMessage(createOptions({ communicationResolution }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as { text?: { verbosity?: string } };
      expect(body.text).toEqual({ verbosity: "high" });
    });

    it("rejects unsupported communication before provider I/O", async () => {
      const { adapter } = await createAdapter("gpt-5.4");
      const communicationResolution = resolveCommunicationProfile({
        intent: resolveCommunicationIntent([{
          source: "user",
          intent: { responseDetail: "concise", onUnsupported: "deny" },
        }]),
        execution: {
          provider: "codex-oauth",
          model: "gpt-5.4",
          surface: "runtime",
        },
      });
      await expect(adapter.createMessage(createOptions({ communicationResolution })))
        .rejects.toThrow("Unsupported communication intent");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects denied deliberation before provider I/O", async () => {
      const { adapter } = await createAdapter("gpt-5.4");
      await expect(adapter.createMessage(createOptions({
        deliberationResolution: {
          status: "denied",
          requested: {
            mode: "fixed",
            preferredLevel: KNOWN_DELIBERATION_LEVEL_IDS.max,
            onUnsupported: "deny",
          },
          source: "operator",
          reason: "preferred-level-unsupported",
        },
      }))).rejects.toThrow("Denied deliberation cannot execute");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("maps provider-safe tool names back to canonical tool names", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_tools",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  call_id: "call_1",
                  name: "mcp_memory_store",
                  arguments: JSON.stringify({ key: "answer" }),
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter("gpt-5.4");
      const response = await adapter.createMessage(createOptions({
        tools: [
          {
            name: "mcp.memory.store",
            description: "Store memory.",
            inputSchema: {
              type: "object",
              properties: {
                key: { type: "string" },
              },
              required: ["key"],
            },
            tags: new Set(["memory"]),
          },
        ],
      }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as { tools?: Array<{ name: string }> };
      expect(body.tools?.[0]?.name).toBe("mcp_memory_store");
      expect(response.toolCalls).toEqual([
        {
          id: "call_1",
          name: "mcp.memory.store",
          input: { key: "answer" },
        },
      ]);
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
        max_output_tokens?: number;
      };

      expect(body).toMatchObject({
        model: "gpt-5.4",
        instructions: "System instruction",
        store: false,
        stream: true,
        input: [
          { role: "user", content: "User prompt" },
          { role: "assistant", content: "Assistant reply" },
        ],
      });
      expect(body).not.toHaveProperty("max_output_tokens");
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

    it("restores optional fields omitted through Codex strict-mode nullable arguments", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([{
        event: "response.completed",
        data: {
          response: {
            id: "resp_strict_optional_1",
            status: "completed",
            output: [{
              type: "function_call",
              id: "call_strict_optional_1",
              name: "finish_work",
              arguments: JSON.stringify({
                id: "work-1",
                handoff: {
                  summary: "Local evidence collected.",
                  resourceUris: ["kiln://artifacts/work-1"],
                  structuredResult: null,
                  verificationUsage: null,
                },
                adoption: null,
                closeoutSummary: null,
              }),
            }],
            usage: { input_tokens: 20, output_tokens: 8 },
          },
        },
      }]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions({
        tools: [{
          name: "finish_work",
          description: "Finish governed work.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              handoff: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                  resourceUris: { type: "array", items: { type: "string" } },
                  structuredResult: { type: "object" },
                  verificationUsage: { type: "object" },
                },
                required: ["summary", "resourceUris"],
              },
              adoption: { type: "object" },
              closeoutSummary: { type: "string" },
            },
            required: ["id"],
          },
          tags: new Set(["governance"]),
        }],
      }));

      expect(response.toolCalls).toEqual([{
        id: "call_strict_optional_1",
        name: "finish_work",
        input: {
          id: "work-1",
          handoff: {
            summary: "Local evidence collected.",
            resourceUris: ["kiln://artifacts/work-1"],
          },
        },
      }]);
    });

    it("preserves invalid tool calls even when leading text contains JSON", async () => {
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
      const invalidDetails = getInvalidToolInputDetails(response.toolCalls[0]!.input);

      expect(response.toolCalls[0]?.id).toBe("call_repair_1");
      expect(response.toolCalls[0]?.name).toBe("glob");
      expect(invalidDetails).toEqual({
        reason: "Failed to parse tool arguments as JSON.",
        raw: "",
      });
      expect(response.parts).toEqual([
        {
          type: "text",
          text: "{\"pattern\":\"**/*kiln-context*\",\"path\":\".\",\"outputMode\":\"content\"}I found the right search parameters.",
        },
      ]);
    });

    it("strips leaked function-call arguments from assistant text", async () => {
      const leakedArguments = "{\"id\":\"mon_2\",\"sinceSequence\":0,\"limit\":10,\"verbosity\":\"raw\"}";
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_leaked_args_1",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: `${leakedArguments}${leakedArguments}to=functions.monitor_readListo. Deje el reporte en temp_test/reporte_tools.md`,
                    },
                  ],
                },
                {
                  type: "function_call",
                  id: "call_leaked_args_1",
                  call_id: "call_leaked_args_1",
                  name: "monitor_read",
                  arguments: leakedArguments,
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

      expect(response.parts).toEqual([
        {
          type: "text",
          text: "Listo. Deje el reporte en temp_test/reporte_tools.md",
        },
      ]);
      expect(response.toolCalls).toEqual([
        {
          id: "call_leaked_args_1",
          name: "monitor_read",
          input: {
            id: "mon_2",
            sinceSequence: 0,
            limit: 10,
            verbosity: "raw",
          },
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

    it("retries once when the stream ends empty without response.completed", async () => {
      mockFetch
        .mockResolvedValueOnce(sseResponse([]))
        .mockResolvedValueOnce(sseResponse([
          {
            event: "response.completed",
            data: {
              response: {
                id: "resp_empty_retry_1",
                status: "completed",
                output: [{
                  type: "message",
                  content: [{ type: "output_text", text: "Recovered answer" }],
                }],
                usage: { input_tokens: 9, output_tokens: 3 },
              },
            },
          },
        ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(response.parts).toEqual([{ type: "text", text: "Recovered answer" }]);
      expect(response.inputTokens).toBe(9);
      expect(response.outputTokens).toBe(3);
    });

    it("does not replay an effect when direct one-round mode disables automatic retries", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([]));

      const { adapter } = await createAdapter("gpt-5.4", false);

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not refresh and replay a 401 when direct one-round mode disables automatic retries", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));

      const { adapter } = await createAdapter("gpt-5.4", false);

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({
        code: "PROVIDER_AUTH_FAILED",
      });
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockGetValidAccessToken).toHaveBeenCalledOnce();
    });

    it("returns streamed text when a stream stalls after output_text.done", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        { event: "response.output_text.delta", data: { delta: "DIRECT_CODEX_" } },
        { event: "response.output_text.delta", data: { delta: "OAUTH_LIVE_PROOF:alpha" } },
        {
          event: "response.output_text.done",
          data: { text: "DIRECT_CODEX_OAUTH_LIVE_PROOF:alpha" },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.parts).toEqual([
        { type: "text", text: "DIRECT_CODEX_OAUTH_LIVE_PROOF:alpha" },
      ]);
      expect(response.stopReason).toBe("text_streamed");
    });

    it("does not arm idle fallback before first streamed content", async () => {
      mockFetch.mockImplementationOnce(async () => delayedSseResponse([], [
        { event: "response.output_text.delta", data: { delta: "Delayed answer" } },
        {
          event: "response.output_text.done",
          data: { text: "Delayed answer" },
        },
      ], 2500));

      const { adapter } = await createAdapter();
      const response = await resolveAfterIncompleteIdle(() => adapter.createMessage(createOptions()));

      expect(response.parts).toEqual([{ type: "text", text: "Delayed answer" }]);
      expect(response.stopReason).toBe("text_streamed");
    });

    it("preserves completed streamed function calls when response.completed omits them", async () => {
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
          event: "response.function_call_arguments.done",
          data: {
            item_id: "call_added_1",
            name: "read",
            arguments: "{\"filePath\":\"docs/changelog.md\"}",
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

    it("restores call_id from streamed function-call items when response.completed returns item id and final args", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_added_1",
              call_id: "call_added_1",
              name: "read",
              arguments: "{\"filePath\":\"docs/changelog.md\"}",
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
                  arguments: "{\"filePath\":\"docs/changelog.md\"}",
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
          input: { filePath: "docs/changelog.md" },
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
            arguments: "{\"filePath\":\"docs/changelog.md\"}",
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
          input: { filePath: "docs/changelog.md" },
        },
      ]);
    });

    it("preserves added call_id when final function-call arguments omit it", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_args_done_call_id_omitted_1",
              call_id: "call_args_done_call_id_omitted_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_args_done_call_id_omitted_1",
            name: "read",
            arguments: "{\"filePath\":\"docs/changelog.md\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_args_done_call_id_omitted_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 14, output_tokens: 5 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toEqual([
        {
          id: "call_args_done_call_id_omitted_1",
          name: "read",
          input: { filePath: "docs/changelog.md" },
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
              arguments: "{\"filePath\":\"docs/changelog.md\",\"offset\":0,\"limit\":200}",
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
            filePath: "docs/changelog.md",
            offset: 0,
            limit: 200,
          },
        },
      ]);
    });

    it("preserves added call_id when output_item.done omits it", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_output_done_call_id_omitted_1",
              call_id: "call_output_done_call_id_omitted_1",
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
              id: "fc_output_done_call_id_omitted_1",
              name: "read",
              arguments: "{\"filePath\":\"docs/changelog.md\",\"offset\":0,\"limit\":200}",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_output_done_call_id_omitted_1",
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
          id: "call_output_done_call_id_omitted_1",
          name: "read",
          input: { filePath: "docs/changelog.md", offset: 0, limit: 200 },
        },
      ]);
    });

    it("returns executable tool calls when a stream stalls after response.output_item.done", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.done",
          data: {
            item: {
              type: "function_call",
              id: "fc_done_stalled_1",
              call_id: "call_done_stalled_1",
              name: "read",
              arguments: "{\"filePath\":\"docs/changelog.md\"}",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await resolveAfterIncompleteIdle(() => adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      })));

      expect(response.toolCalls).toEqual([
        {
          id: "call_done_stalled_1",
          name: "read",
          input: { filePath: "docs/changelog.md" },
        },
      ]);
      expect(response.stopReason).toBe("tool_calls_streamed");
    });

    it("returns executable tool calls when a stream stalls after a complete function-call item", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_write_evt_1",
              call_id: "call_write_evt_1",
              name: "write",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_write_evt_1",
            call_id: "call_write_evt_1",
            name: "write",
            arguments: "{\"filePath\":\"proof.txt\",\"content\":\"after\\n\"}",
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await resolveAfterIncompleteIdle(() => adapter.createMessage(createOptions({
        tools: [
          {
            name: "write",
            description: "Write full content to a file.",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                content: { type: "string" },
              },
              required: ["filePath", "content"],
              additionalProperties: false,
            },
            tags: new Set(["write"]),
          },
        ],
      })));

      expect(response.toolCalls).toEqual([
        {
          id: "call_write_evt_1",
          name: "write",
          input: {
            filePath: "proof.txt",
            content: "after\n",
          },
        },
      ]);
      expect(response.stopReason).toBe("tool_calls_streamed");
    });

    it("waits longer than the completed-content idle window for delayed function-call arguments", async () => {
      mockFetch.mockResolvedValueOnce(delayedSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_delayed_args_1",
              call_id: "call_delayed_args_1",
              name: "read",
              arguments: "",
            },
          },
        },
      ], [
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_delayed_args_1",
            call_id: "call_delayed_args_1",
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_delayed_args_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_delayed_args_1",
                  call_id: "call_delayed_args_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 3 },
            },
          },
        },
      ], 2500));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }));

      expect(response.toolCalls).toEqual([
        {
          id: "call_delayed_args_1",
          name: "read",
          input: { filePath: "proof.txt" },
        },
      ]);
      expect(response.stopReason).toBe("completed");
    });

    it("waits longer than the completed-content idle window for delayed tool items after text", async () => {
      mockFetch.mockResolvedValueOnce(delayedSseResponse([
        { event: "response.output_text.delta", data: { delta: "Preparing " } },
        { event: "response.output_text.done", data: { text: "Preparing tool call" } },
      ], [
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_delayed_after_text_1",
              call_id: "call_delayed_after_text_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_delayed_after_text_1",
            call_id: "call_delayed_after_text_1",
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_delayed_after_text_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_delayed_after_text_1",
                  call_id: "call_delayed_after_text_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 3 },
            },
          },
        },
      ], 2500));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }));

      expect(response.toolCalls).toEqual([
        {
          id: "call_delayed_after_text_1",
          name: "read",
          input: { filePath: "proof.txt" },
        },
      ]);
      expect(response.stopReason).toBe("completed");
    });

    it("keeps response.completed authoritative when it arrives after a complete function-call item", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_read_evt_1",
              call_id: "call_read_evt_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_read_evt_1",
            call_id: "call_read_evt_1",
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_completed_after_tool_call_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_read_evt_1",
                  call_id: "call_read_evt_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 12, output_tokens: 3 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.stopReason).toBe("completed");
      expect(response.toolCalls).toEqual([
        {
          id: "call_read_evt_1",
          name: "read",
          input: { filePath: "proof.txt" },
        },
      ]);
    });

    it("waits for a delayed response.completed before using streamed tool-call fallback", async () => {
      mockFetch.mockResolvedValueOnce(delayedSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_delayed_evt_1",
              call_id: "call_delayed_evt_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_delayed_evt_1",
            call_id: "call_delayed_evt_1",
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        },
      ], [
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_delayed_after_tool_call_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_delayed_evt_1",
                  call_id: "call_delayed_evt_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 12, output_tokens: 3 },
            },
          },
        },
      ], 100));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.stopReason).toBe("completed");
      expect(response.toolCalls).toEqual([
        {
          id: "call_delayed_evt_1",
          name: "read",
          input: { filePath: "proof.txt" },
        },
      ]);
    });

    it("does not fall back to a complete tool-call prefix before delayed additional tool items", async () => {
      mockFetch.mockResolvedValueOnce(delayedSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_complete_prefix_1",
              call_id: "call_complete_prefix_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_complete_prefix_1",
            call_id: "call_complete_prefix_1",
            name: "read",
            arguments: "{\"filePath\":\"first.txt\"}",
          },
        },
      ], [
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_delayed_incomplete_1",
              call_id: "call_delayed_incomplete_1",
              name: "read",
              arguments: "{\"filePath\":\"second.txt\"",
            },
          },
        },
      ], 2500));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth stream completed without response.completed event",
      });
    });

    it("uses completed function-call arguments instead of partial streamed arguments", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_1",
              call_id: "call_partial_1",
              name: "write",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_partial_1",
            call_id: "call_partial_1",
            name: "write",
            arguments: "{\"filePath\":\"proof.txt\",\"content\":\"after\\n\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_completed_partial_args_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_partial_1",
                  call_id: "call_partial_1",
                  name: "write",
                  arguments: "{\"filePath\":\"proof.txt\"",
                },
              ],
              usage: { input_tokens: 12, output_tokens: 3 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toEqual([
        {
          id: "call_partial_1",
          name: "write",
          input: {
            filePath: "proof.txt",
            content: "after\n",
          },
        },
      ]);
    });

    it("fails closed when the stream ends without completed function-call arguments", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_incomplete_1",
              call_id: "call_incomplete_1",
              name: "write",
              arguments: "",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth stream completed without response.completed event",
      });
    });

    it("fails closed when response.completed omits an incomplete streamed function call", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_incomplete_completed_omitted_1",
              call_id: "call_incomplete_completed_omitted_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_incomplete_completed_omitted_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed omitted incomplete streamed function-call arguments",
      });
    });

    it("fails closed when final function-call arguments are empty after partial streamed args", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_empty_done_1",
              call_id: "call_partial_empty_done_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_partial_empty_done_1",
            call_id: "call_partial_empty_done_1",
            name: "read",
            arguments: "",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_partial_empty_done_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed omitted incomplete streamed function-call arguments",
      });
    });

    it("does not promote parseable stale streamed args when empty final args are echoed by response.completed", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_parseable_partial_empty_done_1",
              call_id: "call_parseable_partial_empty_done_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"}",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_parseable_partial_empty_done_1",
            call_id: "call_parseable_partial_empty_done_1",
            name: "read",
            arguments: "",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_parseable_partial_empty_done_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_parseable_partial_empty_done_1",
                  call_id: "call_parseable_partial_empty_done_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed included incomplete streamed function-call arguments",
      });
    });

    it("does not promote parseable stale streamed args when output_item.done omits args echoed by response.completed", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_parseable_partial_omitted_done_1",
              call_id: "call_parseable_partial_omitted_done_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"}",
            },
          },
        },
        {
          event: "response.output_item.done",
          data: {
            item: {
              type: "function_call",
              id: "fc_parseable_partial_omitted_done_1",
              call_id: "call_parseable_partial_omitted_done_1",
              name: "read",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_parseable_partial_omitted_done_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_parseable_partial_omitted_done_1",
                  call_id: "call_parseable_partial_omitted_done_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed included incomplete streamed function-call arguments",
      });
    });

    it("fails closed when output_item.done omits arguments after partial streamed args", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_omitted_done_1",
              call_id: "call_partial_omitted_done_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.output_item.done",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_omitted_done_1",
              call_id: "call_partial_omitted_done_1",
              name: "read",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_partial_omitted_done_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed omitted incomplete streamed function-call arguments",
      });
    });

    it("fails closed when response.completed includes the same incomplete streamed function call", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_completed_echo_1",
              call_id: "call_partial_completed_echo_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_partial_completed_echo_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_partial_completed_echo_1",
                  call_id: "call_partial_completed_echo_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      }))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed included incomplete streamed function-call arguments",
      });
    });

    it("fails closed when a stream stalls after an incomplete function-call item", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_incomplete_stalled_1",
              call_id: "call_incomplete_stalled_1",
              name: "read",
              arguments: "",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expectProviderUnavailableAfterIncompleteIdle(() => adapter.createMessage(createOptions({
        tools: [
          {
            name: "read",
            description: "Read a file.",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
              additionalProperties: false,
            },
            tags: new Set(["read"]),
          },
        ],
      })));
    });

    it("fails closed when a stream stalls after non-empty partial function-call arguments", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_stalled_1",
              call_id: "call_partial_stalled_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expectProviderUnavailableAfterIncompleteIdle(() => adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      })));
    });

    it("fails closed when a stream stalls after mixed complete and incomplete function calls", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_complete_mixed_1",
              call_id: "call_complete_mixed_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_complete_mixed_1",
            call_id: "call_complete_mixed_1",
            name: "read",
            arguments: "{\"filePath\":\"first.txt\"}",
          },
        },
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_incomplete_mixed_1",
              call_id: "call_incomplete_mixed_1",
              name: "read",
              arguments: "{\"filePath\":\"second.txt\"",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expectProviderUnavailableAfterIncompleteIdle(() => adapter.createMessage(createOptions({
        tools: [readToolDefinition()],
      })));
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
      const transportEvents: ProviderTransportEvent[] = [];
      await adapter.createMessage(createOptions({
        transportObserver: { onEvent: (event) => transportEvents.push(event) },
      }));

      expect(auth.getValidAccessToken).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(transportEvents.map((event) => event.type)).toEqual([
        "request_started",
        "response_headers",
        "request_started",
        "response_headers",
        "request_completed",
      ]);

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

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({
        code: "PROVIDER_AUTH_FAILED",
      });
    });

    it.each([
      [403, "PROVIDER_AUTH_FAILED"],
      [429, "PROVIDER_RATE_LIMITED"],
      [402, "PROVIDER_QUOTA_EXCEEDED"],
    ])("throws %s provider errors with code %s", async (status, code) => {
      mockFetch.mockResolvedValueOnce(jsonResponse(status, { error: "provider_error" }));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({ code });
    });

    it("retries a transient 520 response before streaming starts", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(520, { error: "unknown_origin_response" }))
        .mockResolvedValueOnce(sseResponse([{
          event: "response.completed",
          data: {
            response: {
              id: "resp_after_520",
              status: "completed",
              output: [{ type: "message", content: [{ type: "output_text", text: "Recovered" }] }],
              usage: { input_tokens: 2, output_tokens: 1 },
            },
          },
        }]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.parts).toEqual([{ type: "text", text: "Recovered" }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("bounds retries when transient 5xx responses persist", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(500, { error: "provider_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { error: "provider_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { error: "provider_error" }));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        retryable: true,
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("classifies malformed SSE JSON as provider unavailable", async () => {
      mockFetch.mockResolvedValueOnce(rawSseResponse([
        "event: response.completed\ndata: {not-json}\n\n",
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
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

    it("yields tool call events from completed response function calls", async () => {
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

    it("does not yield executable tool calls from incomplete output_item.added events", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_stream_event_1",
              call_id: "call_partial_stream_event_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      await expectProviderUnavailableAfterIncompleteIdle(async () => {
        for await (const event of adapter.streamMessage(createOptions({
          tools: [readToolDefinition()],
        }))) {
          events.push(event);
        }
      });

      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    });

    it("buffers tool-enabled stream text so leaked function-call arguments never render as deltas", async () => {
      const leakedArguments = "{\"id\":\"mon_2\",\"sinceSequence\":0,\"limit\":10,\"verbosity\":\"raw\"}";
      mockFetch.mockResolvedValueOnce(sseResponse([
        { event: "response.output_text.delta", data: { delta: leakedArguments } },
        { event: "response.output_text.delta", data: { delta: "to=functions.monitor_read" } },
        { event: "response.output_text.delta", data: { delta: "Listo. Deje el reporte en temp_test/reporte_tools.md" } },
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "call_stream_leaked_1",
              call_id: "call_stream_leaked_1",
              name: "monitor_read",
              arguments: leakedArguments,
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_leaked_1",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: `${leakedArguments}to=functions.monitor_readListo. Deje el reporte en temp_test/reporte_tools.md`,
                    },
                  ],
                },
                {
                  type: "function_call",
                  id: "call_stream_leaked_1",
                  call_id: "call_stream_leaked_1",
                  name: "monitor_read",
                  arguments: leakedArguments,
                },
              ],
              usage: { input_tokens: 10, output_tokens: 3 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions({
        tools: [
          {
            name: "monitor_read",
            description: "Read monitor output.",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string" },
                sinceSequence: { type: "number" },
                limit: { type: "number" },
                verbosity: { type: "string" },
              },
              required: ["id"],
              additionalProperties: false,
            },
            tags: new Set(["runtime"]),
          },
        ],
      })));

      expect(events.filter((event) => event.type === "text")).toEqual([
        {
          type: "text",
          content: "Listo. Deje el reporte en temp_test/reporte_tools.md",
        },
      ]);
      expect(events.some((event) => event.type === "text" && event.content.includes("\"id\":\"mon_2\""))).toBe(false);
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

    it("retries streamed messages once when the stream ends empty without response.completed", async () => {
      mockFetch
        .mockResolvedValueOnce(sseResponse([]))
        .mockResolvedValueOnce(sseResponse([
          { event: "response.output_text.delta", data: { delta: "Recovered " } },
          { event: "response.output_text.delta", data: { delta: "stream" } },
          {
            event: "response.completed",
            data: {
              response: {
                id: "resp_stream_empty_retry_1",
                status: "completed",
                output: [{
                  type: "message",
                  content: [{ type: "output_text", text: "Recovered stream" }],
                }],
                usage: { input_tokens: 11, output_tokens: 4 },
              },
            },
          },
        ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions()));
      const doneEvent = events.at(-1) as AgentStreamEvent & {
        response?: AgentResponse;
        inputTokens?: number;
        outputTokens?: number;
      };

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(events.filter((event) => event.type === "text")).toEqual([
        { type: "text", content: "Recovered " },
        { type: "text", content: "stream" },
      ]);
      expect(doneEvent.type).toBe("done");
      expect(doneEvent.inputTokens).toBe(11);
      expect(doneEvent.outputTokens).toBe(4);
      expect(doneEvent.response?.parts).toEqual([{ type: "text", text: "Recovered stream" }]);
    });

    it("treats response.completed as terminal after output_text.done", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        { event: "response.output_text.delta", data: { delta: "Final " } },
        { event: "response.output_text.done", data: { text: "Final answer" } },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_terminal_text_1",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "Final answer" }],
                },
              ],
              usage: { input_tokens: 9, output_tokens: 3 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions()));

      expect(events.filter((event) => event.type === "done")).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({
        type: "done",
        inputTokens: 9,
        outputTokens: 3,
        response: {
          parts: [{ type: "text", text: "Final answer" }],
          stopReason: "completed",
        },
      });
    });

    it("treats response.completed as terminal after complete streamed function-call args", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_stream_terminal_1",
              call_id: "call_stream_terminal_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_stream_terminal_1",
            call_id: "call_stream_terminal_1",
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_terminal_tool_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_stream_terminal_1",
                  call_id: "call_stream_terminal_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 11, output_tokens: 4 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions({
        tools: [
          {
            name: "read",
            description: "Read a file.",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
              additionalProperties: false,
            },
            tags: new Set(["read"]),
          },
        ],
      })));

      expect(events.filter((event) => event.type === "done")).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({
        type: "done",
        inputTokens: 11,
        outputTokens: 4,
        response: {
          toolCalls: [
            {
              id: "call_stream_terminal_1",
              name: "read",
              input: { filePath: "proof.txt" },
            },
          ],
          stopReason: "completed",
        },
      });
    });

    it("preserves added call_id in stream mode when final function-call arguments omit it", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_stream_args_done_call_id_omitted_1",
              call_id: "call_stream_args_done_call_id_omitted_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_stream_args_done_call_id_omitted_1",
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_args_done_call_id_omitted_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 11, output_tokens: 4 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions({
        tools: [readToolDefinition()],
      })));

      expect(events.filter((event) => event.type === "tool_use").map((event) => JSON.parse(event.content))).toEqual([
        {
          id: "call_stream_args_done_call_id_omitted_1",
          name: "read",
          input: { filePath: "proof.txt" },
        },
      ]);
      expect(events.at(-1)).toMatchObject({
        type: "done",
        response: {
          toolCalls: [
            {
              id: "call_stream_args_done_call_id_omitted_1",
              name: "read",
              input: { filePath: "proof.txt" },
            },
          ],
          stopReason: "completed",
        },
      });
    });

    it("yields a done event when a stream stalls after a complete function-call item", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "call_stream_stalled_1",
              call_id: "call_stream_stalled_1",
              name: "write",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "call_stream_stalled_1",
            call_id: "call_stream_stalled_1",
            name: "write",
            arguments: "{\"filePath\":\"proof.txt\",\"content\":\"after\\n\"}",
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await resolveAfterIncompleteIdle(() => collectEvents(adapter.streamMessage(createOptions({
        tools: [
          {
            name: "write",
            description: "Write full content to a file.",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                content: { type: "string" },
              },
              required: ["filePath", "content"],
              additionalProperties: false,
            },
            tags: new Set(["write"]),
          },
        ],
      }))));
      const doneEvent = events.at(-1) as AgentStreamEvent & {
        response?: AgentResponse;
      };

      expect(doneEvent.type).toBe("done");
      expect(doneEvent.response?.stopReason).toBe("tool_calls_streamed");
      expect(doneEvent.response?.toolCalls).toEqual([
        {
          id: "call_stream_stalled_1",
          name: "write",
          input: {
            filePath: "proof.txt",
            content: "after\n",
          },
        },
      ]);
    });

    it("yields a done event when a stream stalls after response.output_item.done", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.done",
          data: {
            item: {
              type: "function_call",
              id: "fc_done_stream_stalled_1",
              call_id: "call_done_stream_stalled_1",
              name: "read",
              arguments: "{\"filePath\":\"docs/changelog.md\"}",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await resolveAfterIncompleteIdle(() => collectEvents(adapter.streamMessage(createOptions({
        tools: [readToolDefinition()],
      }))));
      const doneEvent = events.at(-1) as AgentStreamEvent & {
        response?: AgentResponse;
      };

      expect(doneEvent.type).toBe("done");
      expect(doneEvent.response?.stopReason).toBe("tool_calls_streamed");
      expect(doneEvent.response?.toolCalls).toEqual([
        {
          id: "call_done_stream_stalled_1",
          name: "read",
          input: { filePath: "docs/changelog.md" },
        },
      ]);
    });

    it("preserves added call_id in stream mode when output_item.done omits it", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_stream_output_done_call_id_omitted_1",
              call_id: "call_stream_output_done_call_id_omitted_1",
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
              id: "fc_stream_output_done_call_id_omitted_1",
              name: "read",
              arguments: "{\"filePath\":\"docs/changelog.md\"}",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_output_done_call_id_omitted_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 10, output_tokens: 3 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions({
        tools: [readToolDefinition()],
      })));

      expect(events.filter((event) => event.type === "tool_use").map((event) => JSON.parse(event.content))).toEqual([
        {
          id: "call_stream_output_done_call_id_omitted_1",
          name: "read",
          input: { filePath: "docs/changelog.md" },
        },
      ]);
      expect(events.at(-1)).toMatchObject({
        type: "done",
        response: {
          toolCalls: [
            {
              id: "call_stream_output_done_call_id_omitted_1",
              name: "read",
              input: { filePath: "docs/changelog.md" },
            },
          ],
          stopReason: "completed",
        },
      });
    });

    it("waits longer than the completed-content idle window for delayed stream function-call arguments", async () => {
      mockFetch.mockResolvedValueOnce(delayedSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_stream_delayed_args_1",
              call_id: "call_stream_delayed_args_1",
              name: "read",
              arguments: "",
            },
          },
        },
      ], [
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_stream_delayed_args_1",
            call_id: "call_stream_delayed_args_1",
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_delayed_args_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_stream_delayed_args_1",
                  call_id: "call_stream_delayed_args_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 3 },
            },
          },
        },
      ], 2500));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions({
        tools: [readToolDefinition()],
      })));

      expect(events.at(-1)).toMatchObject({
        type: "done",
        response: {
          toolCalls: [
            {
              id: "call_stream_delayed_args_1",
              name: "read",
              input: { filePath: "proof.txt" },
            },
          ],
          stopReason: "completed",
        },
      });
    });

    it("waits longer than the completed-content idle window for delayed stream tool items after text", async () => {
      mockFetch.mockResolvedValueOnce(delayedSseResponse([
        { event: "response.output_text.delta", data: { delta: "Preparing " } },
        { event: "response.output_text.done", data: { text: "Preparing tool call" } },
      ], [
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_stream_delayed_after_text_1",
              call_id: "call_stream_delayed_after_text_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_stream_delayed_after_text_1",
            call_id: "call_stream_delayed_after_text_1",
            name: "read",
            arguments: "{\"filePath\":\"proof.txt\"}",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_delayed_after_text_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_stream_delayed_after_text_1",
                  call_id: "call_stream_delayed_after_text_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 3 },
            },
          },
        },
      ], 2500));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions({
        tools: [readToolDefinition()],
      })));

      expect(events.filter((event) => event.type === "tool_use").map((event) => JSON.parse(event.content))).toEqual([
        {
          id: "call_stream_delayed_after_text_1",
          name: "read",
          input: { filePath: "proof.txt" },
        },
      ]);
      expect(events.at(-1)).toMatchObject({
        type: "done",
        response: {
          stopReason: "completed",
        },
      });
    });

    it("does not yield a complete tool-call prefix before delayed additional tool items", async () => {
      mockFetch.mockResolvedValueOnce(delayedSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_stream_complete_prefix_1",
              call_id: "call_stream_complete_prefix_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_stream_complete_prefix_1",
            call_id: "call_stream_complete_prefix_1",
            name: "read",
            arguments: "{\"filePath\":\"first.txt\"}",
          },
        },
      ], [
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_stream_delayed_incomplete_1",
              call_id: "call_stream_delayed_incomplete_1",
              name: "read",
              arguments: "{\"filePath\":\"second.txt\"",
            },
          },
        },
      ], 2500));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(createOptions({
          tools: [readToolDefinition()],
        }))) {
          events.push(event);
        }
      }).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth stream completed without response.completed event",
      });
      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    });

    it("yields a done event when a stream stalls after output_text.done", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        { event: "response.output_text.delta", data: { delta: "Final " } },
        { event: "response.output_text.delta", data: { delta: "answer" } },
        {
          event: "response.output_text.done",
          data: { text: "Final answer" },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await collectEvents(adapter.streamMessage(createOptions()));
      const doneEvent = events.at(-1) as AgentStreamEvent & {
        response?: AgentResponse;
      };

      expect(events.filter((event) => event.type === "text")).toEqual([
        { type: "text", content: "Final " },
        { type: "text", content: "answer" },
      ]);
      expect(doneEvent.type).toBe("done");
      expect(doneEvent.response?.parts).toEqual([
        { type: "text", text: "Final answer" },
      ]);
      expect(doneEvent.response?.stopReason).toBe("text_streamed");
    });

    it("does not arm stream idle fallback before first streamed content", async () => {
      mockFetch.mockImplementationOnce(async () => delayedSseResponse([], [
        { event: "response.output_text.delta", data: { delta: "Delayed stream answer" } },
        {
          event: "response.output_text.done",
          data: { text: "Delayed stream answer" },
        },
      ], 2500));

      const { adapter } = await createAdapter();
      const events = await resolveAfterIncompleteIdle(() => collectEvents(adapter.streamMessage(createOptions())));
      const doneEvent = events.at(-1) as AgentStreamEvent & {
        response?: AgentResponse;
      };

      expect(events.filter((event) => event.type === "text")).toEqual([
        { type: "text", content: "Delayed stream answer" },
      ]);
      expect(doneEvent.type).toBe("done");
      expect(doneEvent.response?.parts).toEqual([
        { type: "text", text: "Delayed stream answer" },
      ]);
      expect(doneEvent.response?.stopReason).toBe("text_streamed");
    });

    it("flushes buffered tool-enabled text when a stream stalls after output_text.done", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        { event: "response.output_text.delta", data: { delta: "Final " } },
        { event: "response.output_text.delta", data: { delta: "answer" } },
        {
          event: "response.output_text.done",
          data: { text: "Final answer" },
        },
      ]));

      const { adapter } = await createAdapter();
      const events = await resolveAfterIncompleteIdle(() => collectEvents(adapter.streamMessage(createOptions({
        tools: [
          {
            name: "read",
            description: "Read a file.",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
              additionalProperties: false,
            },
            tags: new Set(["read"]),
          },
        ],
      }))));
      const doneEvent = events.at(-1) as AgentStreamEvent & {
        response?: AgentResponse;
      };

      expect(events.filter((event) => event.type === "text")).toEqual([
        { type: "text", content: "Final answer" },
      ]);
      expect(doneEvent.type).toBe("done");
      expect(doneEvent.response?.parts).toEqual([
        { type: "text", text: "Final answer" },
      ]);
      expect(doneEvent.response?.stopReason).toBe("text_streamed");
    });

    it("fails closed when a stream ends without completed function-call args", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_incomplete_stream_1",
              call_id: "call_incomplete_stream_1",
              name: "read",
              arguments: "",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      await expectProviderUnavailableAfterIncompleteIdle(() => collectEvents(adapter.streamMessage(createOptions({
        tools: [
          {
            name: "read",
            description: "Read a file.",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
              additionalProperties: false,
            },
            tags: new Set(["read"]),
          },
        ],
      }))));
    });

    it("fails closed when a stream stalls after an incomplete function-call item", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_incomplete_stream_stalled_1",
              call_id: "call_incomplete_stream_stalled_1",
              name: "read",
              arguments: "",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      await expectProviderUnavailableAfterIncompleteIdle(() => collectEvents(adapter.streamMessage(createOptions({
        tools: [
          {
            name: "read",
            description: "Read a file.",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
              additionalProperties: false,
            },
            tags: new Set(["read"]),
          },
        ],
      }))));
    });

    it("fails closed when a stream stalls after non-empty partial function-call arguments", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_stream_stalled_1",
              call_id: "call_partial_stream_stalled_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      vi.useFakeTimers();
      try {
        const promise = (async () => {
          for await (const event of adapter.streamMessage(createOptions({
            tools: [readToolDefinition()],
          }))) {
            events.push(event);
          }
        })();
        promise.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30001);
        await expect(promise).rejects.toMatchObject({
          code: "PROVIDER_UNAVAILABLE",
          message: "Codex OAuth stream completed without response.completed event",
        });
      } finally {
        vi.useRealTimers();
      }
      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    });

    it("fails closed when a stream stalls after mixed complete and incomplete function calls", async () => {
      mockFetch.mockResolvedValueOnce(stalledSseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_complete_stream_mixed_1",
              call_id: "call_complete_stream_mixed_1",
              name: "read",
              arguments: "",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_complete_stream_mixed_1",
            call_id: "call_complete_stream_mixed_1",
            name: "read",
            arguments: "{\"filePath\":\"first.txt\"}",
          },
        },
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_incomplete_stream_mixed_1",
              call_id: "call_incomplete_stream_mixed_1",
              name: "read",
              arguments: "{\"filePath\":\"second.txt\"",
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      await expectProviderUnavailableAfterIncompleteIdle(() => collectEvents(adapter.streamMessage(createOptions({
        tools: [readToolDefinition()],
      }))));
    });

    it("fails closed without tool_use when response.completed omits an incomplete streamed function call", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_incomplete_stream_completed_omitted_1",
              call_id: "call_incomplete_stream_completed_omitted_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_stream_incomplete_completed_omitted_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(createOptions({
          tools: [readToolDefinition()],
        }))) {
          events.push(event);
        }
      }).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed omitted incomplete streamed function-call arguments",
      });
      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    });

    it("fails closed without tool_use when final function-call arguments are empty after partial streamed args", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_empty_stream_done_1",
              call_id: "call_partial_empty_stream_done_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_partial_empty_stream_done_1",
            call_id: "call_partial_empty_stream_done_1",
            name: "read",
            arguments: "",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_partial_empty_stream_done_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(createOptions({
          tools: [readToolDefinition()],
        }))) {
          events.push(event);
        }
      }).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed omitted incomplete streamed function-call arguments",
      });
      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    });

    it("does not yield tool_use from parseable stale streamed args when empty final args are echoed by response.completed", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_parseable_partial_empty_stream_done_1",
              call_id: "call_parseable_partial_empty_stream_done_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"}",
            },
          },
        },
        {
          event: "response.function_call_arguments.done",
          data: {
            item_id: "fc_parseable_partial_empty_stream_done_1",
            call_id: "call_parseable_partial_empty_stream_done_1",
            name: "read",
            arguments: "",
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_parseable_partial_empty_stream_done_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_parseable_partial_empty_stream_done_1",
                  call_id: "call_parseable_partial_empty_stream_done_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(createOptions({
          tools: [readToolDefinition()],
        }))) {
          events.push(event);
        }
      }).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed included incomplete streamed function-call arguments",
      });
      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    });

    it("does not yield tool_use from parseable stale streamed args when output_item.done omits args echoed by response.completed", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_parseable_partial_omitted_stream_done_1",
              call_id: "call_parseable_partial_omitted_stream_done_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"}",
            },
          },
        },
        {
          event: "response.output_item.done",
          data: {
            item: {
              type: "function_call",
              id: "fc_parseable_partial_omitted_stream_done_1",
              call_id: "call_parseable_partial_omitted_stream_done_1",
              name: "read",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_parseable_partial_omitted_stream_done_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_parseable_partial_omitted_stream_done_1",
                  call_id: "call_parseable_partial_omitted_stream_done_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"}",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(createOptions({
          tools: [readToolDefinition()],
        }))) {
          events.push(event);
        }
      }).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed included incomplete streamed function-call arguments",
      });
      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    });

    it("fails closed without tool_use when output_item.done omits arguments after partial streamed args", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_omitted_stream_done_1",
              call_id: "call_partial_omitted_stream_done_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.output_item.done",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_omitted_stream_done_1",
              call_id: "call_partial_omitted_stream_done_1",
              name: "read",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_partial_omitted_stream_done_1",
              status: "completed",
              output: [],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(createOptions({
          tools: [readToolDefinition()],
        }))) {
          events.push(event);
        }
      }).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed omitted incomplete streamed function-call arguments",
      });
      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
    });

    it("fails closed without tool_use when response.completed includes the same incomplete streamed function call", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.output_item.added",
          data: {
            item: {
              type: "function_call",
              id: "fc_partial_stream_completed_echo_1",
              call_id: "call_partial_stream_completed_echo_1",
              name: "read",
              arguments: "{\"filePath\":\"proof.txt\"",
            },
          },
        },
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_partial_stream_completed_echo_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  id: "fc_partial_stream_completed_echo_1",
                  call_id: "call_partial_stream_completed_echo_1",
                  name: "read",
                  arguments: "{\"filePath\":\"proof.txt\"",
                },
              ],
              usage: { input_tokens: 8, output_tokens: 2 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const events: AgentStreamEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.streamMessage(createOptions({
          tools: [readToolDefinition()],
        }))) {
          events.push(event);
        }
      }).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Codex OAuth response.completed included incomplete streamed function-call arguments",
      });
      expect(events.filter((event) => event.type === "tool_use")).toHaveLength(0);
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

  describe("tool call identity", () => {
    it("synthesizes an id from response.id + output index when call_id and id are both absent", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_no_native_id_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  name: "read",
                  arguments: "{\"filePath\":\"a.txt\"}",
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]?.id).toBe("synth1:resp_no_native_id_1:0");
    });

    it("re-normalizing the same response yields the identical synthesized id", async () => {
      const sseFor = () => sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_replay_stable_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  name: "read",
                  arguments: "{\"filePath\":\"a.txt\"}",
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]);

      mockFetch.mockResolvedValueOnce(sseFor());
      const { adapter: firstAdapter } = await createAdapter();
      const first = await firstAdapter.createMessage(createOptions());

      mockFetch.mockResolvedValueOnce(sseFor());
      const { adapter: secondAdapter } = await createAdapter();
      const second = await secondAdapter.createMessage(createOptions());

      expect(first.toolCalls[0]?.id).toBe(second.toolCalls[0]?.id);
    });

    it("assigns distinct synthesized ids to distinct function calls in one response", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_distinct_calls_1",
              status: "completed",
              output: [
                { type: "function_call", name: "read", arguments: "{\"filePath\":\"a.txt\"}" },
                { type: "function_call", name: "read", arguments: "{\"filePath\":\"b.txt\"}" },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      expect(response.toolCalls.map((call) => call.id)).toEqual([
        "synth1:resp_distinct_calls_1:0",
        "synth1:resp_distinct_calls_1:1",
      ]);
    });

    it("rejects when call_id, id, and response.id are all absent -- nothing stable to synthesize from", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              status: "completed",
              output: [
                { type: "function_call", name: "read", arguments: "{\"filePath\":\"a.txt\"}" },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({
        code: "TOOL_CALL_IDENTITY_INVALID",
      });
    });

    it("rejects two missing-id calls in one Codex stream instead of silently collapsing them", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              status: "completed",
              output: [
                { type: "function_call", name: "read", arguments: "{\"filePath\":\"a.txt\"}" },
                { type: "function_call", name: "read", arguments: "{\"filePath\":\"b.txt\"}" },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(adapter.createMessage(createOptions())).rejects.toMatchObject({
        code: "TOOL_CALL_IDENTITY_INVALID",
      });
    });

    it("streaming: two missing-id function calls do not collapse into a single tool_use event", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              status: "completed",
              output: [
                { type: "function_call", name: "read", arguments: "{\"filePath\":\"a.txt\"}" },
                { type: "function_call", name: "read", arguments: "{\"filePath\":\"b.txt\"}" },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();

      await expect(async () => {
        for await (const _event of adapter.streamMessage(createOptions())) {
          // consume
        }
      }).rejects.toMatchObject({ code: "TOOL_CALL_IDENTITY_INVALID" });
    });

    it("rejects a whitespace-only call_id rather than treating it as present", async () => {
      mockFetch.mockResolvedValueOnce(sseResponse([
        {
          event: "response.completed",
          data: {
            response: {
              id: "resp_whitespace_id_1",
              status: "completed",
              output: [
                {
                  type: "function_call",
                  call_id: "   ",
                  name: "read",
                  arguments: "{\"filePath\":\"a.txt\"}",
                },
              ],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        },
      ]));

      const { adapter } = await createAdapter();
      const response = await adapter.createMessage(createOptions());

      // Falls through to id/response.id + index synthesis rather than the blank call_id.
      expect(response.toolCalls[0]?.id).toBe("synth1:resp_whitespace_id_1:0");
    });
  });
});

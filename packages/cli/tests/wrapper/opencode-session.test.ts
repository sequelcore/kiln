import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  OpenCodeSession,
  buildOpenCodeRuntimeConfigContent,
  buildOpenCodeRuntimeConfigEnv,
} from "../../src/wrapper/opencode-session.js";
import type { OpenCodeSessionConfig } from "../../src/wrapper/opencode-session.js";
import type { IKilnSession } from "../../src/wrapper/session.js";

const createOpencodeClient = vi.fn();
const viRuntime = vi as typeof vi & { mocked?: <T>(item: T) => T };
if (typeof viRuntime.mocked !== "function") {
  viRuntime.mocked = <T>(item: T): T => item;
}

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient,
}));

function baseConfig(overrides: Partial<OpenCodeSessionConfig> = {}): OpenCodeSessionConfig {
  return {
    cwd: process.cwd(),
    baseUrl: "http://127.0.0.1:9999",
    ...overrides,
  };
}

describe("OpenCodeSession implements IKilnSession", () => {
  it("declares implements IKilnSession", () => {
    const session: IKilnSession = new OpenCodeSession(baseConfig());
    expect(session).toBeDefined();
  });

  it("sessionId is a non-empty UUID string", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("sessionId is unique per instance", () => {
    const a = new OpenCodeSession(baseConfig());
    const b = new OpenCodeSession(baseConfig());
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("uses configured runtime session identity", () => {
    const session = new OpenCodeSession(baseConfig({ runtimeSessionId: "kiln-tui:opencode:session-1" }));
    expect(session.sessionId).toBe("kiln-tui:opencode:session-1");
  });

  it("capabilities.mcp is true", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.mcp).toBe(true);
  });

  it("capabilities.streaming is true", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.streaming).toBe(true);
  });

  it("capabilities.resume is false", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.resume).toBe(false);
  });

  it("capabilities.costTrackingMode is native", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.costTrackingMode).toBe("native");
  });

  it("capabilities.maxContextTokens is null", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.maxContextTokens).toBeNull();
  });

  it("capabilities.priority is 2", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.priority).toBe(2);
  });

  it("capabilities.fallbackTo is null", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.fallbackTo).toBeNull();
  });

  it("emits explicit runtime warning when sandboxMode is non-read-only", () => {
    const previousEnv = process.env.NODE_ENV;
    const previousDebug = process.env.KILN_DEBUG;
    process.env.NODE_ENV = "development";
    process.env.KILN_DEBUG = "1";
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      new OpenCodeSession(baseConfig({ sandboxMode: "workspace-write" }));

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "OpenCode sandbox mode 'workspace-write' is not natively enforced; using permission prompting semantics only.",
        ),
      );
    } finally {
      debugSpy.mockRestore();
      process.env.NODE_ENV = previousEnv;
      process.env.KILN_DEBUG = previousDebug;
    }
  });

  it("emits translation warnings when provided", () => {
    const previousEnv = process.env.NODE_ENV;
    const previousDebug = process.env.KILN_DEBUG;
    process.env.NODE_ENV = "development";
    process.env.KILN_DEBUG = "1";
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      new OpenCodeSession(baseConfig({
        translationWarnings: ["opencode warning from translation"],
      }));

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("opencode warning from translation"),
      );
    } finally {
      debugSpy.mockRestore();
      process.env.NODE_ENV = previousEnv;
      process.env.KILN_DEBUG = previousDebug;
    }
  });

  it("dispose resolves without error", async () => {
    const session = new OpenCodeSession(baseConfig());
    await expect(session.dispose()).resolves.toBeUndefined();
  });

  it("dispose can be called multiple times without error", async () => {
    const session = new OpenCodeSession(baseConfig());
    await session.dispose();
    await expect(session.dispose()).resolves.toBeUndefined();
  });
});

describe("OpenCode runtime config injection", () => {
  it("builds process-scoped OPENCODE_CONFIG_CONTENT from Kiln session config", () => {
    const content = buildOpenCodeRuntimeConfigContent(baseConfig({
      model: "openai/gpt-4o:free",
      permissionDefault: "ask",
      nativeRules: {
        tools: [{ tool: "Edit", action: "deny" }],
        commands: [{ pattern: "*", shell: "bash", action: "allow" }],
        fileGovernance: { denyGlobs: [], askGlobs: [], allowGlobs: [] },
      },
    }));

    expect(JSON.parse(content)).toEqual({
      model: "openai/gpt-4o:free",
      permission: {
        edit: "deny",
        bash: "allow",
        webfetch: "ask",
      },
      experimental: { batch_tool: true },
    });
  });

  it("omits non-native model ids from process-scoped OpenCode config", () => {
    const content = buildOpenCodeRuntimeConfigContent(baseConfig({
      model: "gpt-5.5",
      permissionDefault: "allow",
    }));

    expect(JSON.parse(content)).toEqual({
      permission: {
        edit: "allow",
        bash: "allow",
        webfetch: "allow",
      },
      experimental: { batch_tool: true },
    });
  });

  it("merges existing OPENCODE_CONFIG_CONTENT while letting Kiln-owned fields win", () => {
    const env = buildOpenCodeRuntimeConfigEnv(
      {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          theme: "system",
          permission: { edit: "allow" },
          experimental: { unrelated: true },
        }),
      },
      baseConfig({ permissionDefault: "deny" }),
    );

    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toEqual({
      theme: "system",
      permission: {
        edit: "deny",
        bash: "deny",
        webfetch: "deny",
      },
      experimental: {
        unrelated: true,
        batch_tool: true,
      },
    });
  });

  it("fails fast when existing OPENCODE_CONFIG_CONTENT is not a JSON object", () => {
    expect(() =>
      buildOpenCodeRuntimeConfigEnv(
        { OPENCODE_CONFIG_CONTENT: "[]" },
        baseConfig(),
      )
    ).toThrow("OPENCODE_CONFIG_CONTENT must be a JSON object when provided");
  });
});

type MockEvent = { directory: string; payload: { type: string; properties?: Record<string, unknown> } };

function makeStream(...events: MockEvent[]) {
  return {
    stream: (function* () {
      for (const e of events) {
        yield e;
      }
    })(),
  };
}

describe("OpenCodeSession.run() integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMockClient(sessionId: string, events: MockEvent[], cost = 0, stopReason?: string) {
    return {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: { info: { cost, stopReason } } }),
        messages: vi.fn().mockResolvedValue({ data: [] }),
        abort: vi.fn().mockResolvedValue(undefined),
      },
      global: {
        event: vi.fn().mockResolvedValue({ stream: makeStream(...events).stream }),
      },
      config: {
        update: vi.fn().mockResolvedValue({ data: undefined }),
      },
    };
  }

  it("run() shapes config.update permission payload from translated native tool/command rules", async () => {
    const mock = makeMockClient("ses_perm", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_perm", status: { type: "idle" } } },
      },
    ], 0.001);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig({
      permissionDefault: "ask",
      nativeRules: {
        tools: [
          { tool: "Edit", action: "deny" },
          { tool: "WebFetch", action: "allow" },
        ],
        commands: [{ pattern: "*", shell: "any", action: "allow" }],
        fileGovernance: { denyGlobs: [], askGlobs: [], allowGlobs: [] },
      },
    }));

    for await (const _event of await session.run({ prompt: "test" })) {
      // consume
    }

    const firstUpdateCall = mock.config.update.mock.calls[0]?.[0] as {
      config?: {
        permission?: { edit?: string; bash?: string; webfetch?: string };
      };
    } | undefined;
    expect(firstUpdateCall?.config?.permission).toEqual({
      edit: "deny",
      bash: "allow",
      webfetch: "allow",
    });
  });

  it("run() appends deterministic translated constraint instructions into prompt payload", async () => {
    const mock = makeMockClient("ses_prompt", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_prompt", status: { type: "idle" } } },
      },
    ], 0.001);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig({
      constraintInstructions: [
        "Kiln policy constraints for opencode:",
        "[data-firewall] DENY logs",
      ],
      nativeRules: {
        tools: [],
        commands: [],
        fileGovernance: {
          denyGlobs: ["**/.env"],
          askGlobs: ["**/*.pem"],
          allowGlobs: ["src/**"],
        },
      },
    }));

    for await (const _event of await session.run({ prompt: "run task" })) {
      // consume
    }

    const promptCall = mock.session.prompt.mock.calls[0]?.[0] as {
      parts?: Array<{ type: string; text?: string }>;
    } | undefined;
    const promptText = promptCall?.parts?.[0]?.text;
    expect(promptText).toContain("run task");
    expect(promptText).toContain("[KILN EXECUTION IDENTITY]");
    expect(promptText).toContain("provider: opencode");
    expect(promptText).toContain("Kiln policy constraints for opencode:");
    expect(promptText).toContain("[data-firewall] DENY logs");
    expect(promptText).toContain("Kiln file governance constraints for opencode:");
    expect(promptText).toContain("[file-governance] DENY **/.env");
    expect(promptText).toContain("[file-governance] ASK **/*.pem");
    expect(promptText).toContain("[file-governance] ALLOW src/**");
  });

  it("run() appends prepared system context after the governed turn prompt", async () => {
    const mock = makeMockClient("ses_system", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_system", status: { type: "idle" } } },
      },
    ], 0.001);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    for await (const _event of await session.run({
      prompt: "<kiln-preamble><task>inspect</task></kiln-preamble>",
      system: "## Operator Identity\n- Operator name: Alex",
    })) {
      // consume
    }

    const promptCall = mock.session.prompt.mock.calls[0]?.[0] as {
      parts?: Array<{ type: string; text?: string }>;
    } | undefined;
    const promptText = promptCall?.parts?.[0]?.text;
    expect(promptText?.indexOf("<kiln-preamble>")).toBeLessThan(promptText?.indexOf("## Operator Identity") ?? 0);
    expect(promptText).toContain("## Operator Identity");
    expect(promptText).toContain("- Operator name: Alex");
    expect(promptText).toContain("--- Kiln Prepared System Context ---");
    expect(promptText).toContain("<kiln-preamble>");
    expect(promptText).toContain("--- Kiln Task To Execute Now ---");
    expect(promptText).toContain("inspect");
    expect(promptText).toContain("Execute the task above in this turn.");
  });

  it("run() does not write non-native model ids into OpenCode config", async () => {
    const mock = makeMockClient("ses_model_skip", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_model_skip", status: { type: "idle" } } },
      },
    ], 0.001);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig({ model: "gpt-5.5" }));
    for await (const _event of await session.run({ prompt: "test" })) {
      // consume
    }

    expect(mock.config.update.mock.calls.some(([call]) =>
      Boolean((call as { config?: { model?: string } } | undefined)?.config?.model),
    )).toBe(false);
    expect(mock.session.prompt.mock.calls[0]?.[0]).not.toEqual(expect.objectContaining({
      model: expect.anything(),
    }));
  });

  it("run() sends provider/model ids as prompt-scoped OpenCode model selection", async () => {
    const mock = makeMockClient("ses_model_native", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_model_native", status: { type: "idle" } } },
      },
    ], 0.001);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig({ model: "kilo/openai/gpt-5.4-mini" }));
    for await (const _event of await session.run({ prompt: "test" })) {
      // consume
    }

    expect(mock.config.update.mock.calls.some(([call]) =>
      Boolean((call as { config?: { model?: string } } | undefined)?.config?.model),
    )).toBe(false);
    expect(mock.session.prompt.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      model: { providerID: "kilo", modelID: "openai/gpt-5.4-mini" },
    }));
  });

  it("run() yields text_delta for message.part.delta via SSE", async () => {
    const mock = makeMockClient("ses_123", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_123",
            part: { id: "part_text_1", type: "text", text: "" },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "message.part.delta", properties: { sessionID: "ses_123", partID: "part_text_1", field: "text", delta: "Hello, world!" } },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_123", status: { type: "idle" } } },
      },
    ], 0.001);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "text_delta", content: "Hello, world!" });
  });

  it("run() yields text_delta for message.part.updated text snapshots", async () => {
    const mock = makeMockClient("ses_text_updated", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_text_updated",
            part: {
              id: "part_text_1",
              type: "text",
              text: "Hello from updated text",
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_text_updated", status: { type: "idle" } } },
      },
    ]);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "text_delta", content: "Hello from updated text" });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", outcome: "completed" }));
  });

  it("run() does not duplicate text when delta and updated snapshot cover the same part", async () => {
    const mock = makeMockClient("ses_text_dedupe", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.delta",
          properties: { sessionID: "ses_text_dedupe", partID: "part_text_1", field: "text", delta: "Hello" },
        },
      },
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_text_dedupe",
            part: { id: "part_text_1", type: "text", text: "Hello" },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_text_dedupe", status: { type: "idle" } } },
      },
    ]);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events.filter((event) =>
      "type" in event && event.type === "text_delta" && (event as { content?: string }).content === "Hello",
    )).toHaveLength(1);
  });

  it("run() buffers untyped deltas until part type is known", async () => {
    const mock = makeMockClient("ses_pending_reasoning", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.delta",
          properties: {
            sessionID: "ses_pending_reasoning",
            partID: "part_reasoning_1",
            field: "text",
            delta: "internal reasoning",
          },
        },
      },
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_pending_reasoning",
            part: {
              id: "part_reasoning_1",
              type: "reasoning",
              text: "internal reasoning",
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_pending_reasoning", status: { type: "idle" } } },
      },
    ]);
    mock.session.prompt.mockResolvedValueOnce({
      data: {
        info: { cost: 0, stopReason: "end_turn" },
        parts: [{ id: "part_text_1", type: "text", text: "visible answer" }],
      },
    });
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).not.toContainEqual({ type: "text_delta", content: "internal reasoning" });
    expect(events).toContainEqual({ type: "text_delta", content: "internal reasoning", isThinking: true });
    expect(events).toContainEqual({ type: "text_delta", content: "visible answer" });
  });

  it("run() ignores user text snapshots and recovers assistant text", async () => {
    const mock = makeMockClient("ses_user_snapshot", [
      {
        directory: "/tmp",
        payload: {
          type: "message.updated",
          properties: {
            sessionID: "ses_user_snapshot",
            info: { id: "msg_user_1", role: "user" },
          },
        },
      },
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_user_snapshot",
            part: {
              id: "part_user_1",
              messageID: "msg_user_1",
              type: "text",
              text: "Do not output this prompt text",
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_user_snapshot", status: { type: "idle" } } },
      },
    ]);
    mock.session.messages.mockResolvedValueOnce({
      data: [
        {
          info: { role: "assistant", time: { created: 2, completed: 3 } },
          parts: [{ type: "text", text: "Assistant final text" }],
        },
      ],
    });
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).not.toContainEqual({ type: "text_delta", content: "Do not output this prompt text" });
    expect(events).toContainEqual({ type: "text_delta", content: "Assistant final text" });
  });

  it("run() falls back to prompt response parts when SSE omits text", async () => {
    const mock = makeMockClient("ses_prompt_parts", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_prompt_parts", status: { type: "idle" } } },
      },
    ]);
    mock.session.prompt.mockResolvedValueOnce({
      data: {
        info: { cost: 0, stopReason: "end_turn" },
        parts: [{ id: "part_text_1", type: "text", text: "Recovered from prompt result" }],
      },
    });
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "text_delta", content: "Recovered from prompt result" });
    expect(mock.session.messages).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", outcome: "completed" }));
  });

  it("run() falls back to final assistant messages when SSE and prompt response omit text", async () => {
    const mock = makeMockClient("ses_messages", [
      {
        directory: "/tmp",
        payload: { type: "session.idle", properties: { sessionID: "ses_messages" } },
      },
    ]);
    mock.session.messages.mockResolvedValueOnce({
      data: [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text", text: "user prompt" }],
        },
        {
          info: { role: "assistant", time: { created: 2, completed: 3 } },
          parts: [{ type: "text", text: "Recovered from session messages" }],
        },
      ],
    });
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(mock.session.messages).toHaveBeenCalledWith(
      { sessionID: "ses_messages", directory: expect.any(String), limit: 20 },
      { throwOnError: false },
    );
    expect(events).toContainEqual({ type: "text_delta", content: "Recovered from session messages" });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", outcome: "completed" }));
  });

  it("run() reports an empty OpenCode response as a harness error", async () => {
    const mock = makeMockClient("ses_empty", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_empty", status: { type: "idle" } } },
      },
    ]);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "error",
      code: "OPENCODE_EMPTY_RESPONSE",
      message: "OpenCode session reached idle without assistant text, usage, tool, or file-change evidence.",
      isRetryable: true,
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", outcome: "failed" }));
  });

  it("run() yields tool_use for pending/running tool via message.part.updated", async () => {
    const mock = makeMockClient("ses_456", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_456",
            part: {
              type: "tool",
              tool: "read",
              callID: "call_read_1",
              state: { status: "running", input: { filePath: "/tmp/test.txt" } },
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_456", status: { type: "idle" } } },
      },
    ], 0.002);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "tool_use", toolName: "read", input: { filePath: "/tmp/test.txt" } });
  });

  it("run() marks tool_use source as mcp when tool name was registered by mcp.tools.changed", async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const mock = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "ses_mcp_source" } }),
        prompt: vi.fn().mockResolvedValue({ data: { info: { cost: 0.002 } } }),
        abort: vi.fn().mockResolvedValue(undefined),
      },
      global: {
        event: vi.fn().mockResolvedValue({
          stream: (async function* () {
            await tick();
            yield {
              directory: "/tmp",
              payload: {
                type: "mcp.tools.changed",
                properties: {
                  sessionID: "ses_mcp_source",
                  tools: [{ name: "memory_store" }],
                },
              },
            };
            await tick();
            yield {
              directory: "/tmp",
              payload: {
                type: "message.part.updated",
                properties: {
                  sessionID: "ses_mcp_source",
                  part: {
                    type: "tool",
                    tool: "memory_store",
                    callID: "call_mcp_1",
                    state: { status: "running", input: { key: "k", value: "v" } },
                  },
                },
              },
            };
            await tick();
            yield {
              directory: "/tmp",
              payload: { type: "session.status", properties: { sessionID: "ses_mcp_source", status: { type: "idle" } } },
            };
          })(),
        }),
      },
      config: {
        update: vi.fn().mockResolvedValue({ data: undefined }),
      },
    };
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "tool_use",
      toolName: "memory_store",
      input: { key: "k", value: "v" },
      source: "mcp",
      mcpSelector: "memory_store",
    });
  });

  it("run() keeps normal tool_use unmarked when tool is not in MCP registry", async () => {
    const mock = makeMockClient("ses_native_tool", [
      {
        directory: "/tmp",
        payload: {
          type: "sessionUpdate",
          properties: {
            sessionID: "ses_native_tool",
            type: "usage_update",
            cost: { amount: 0.002 },
          },
        },
      },
      {
        directory: "/tmp",
        payload: {
          type: "mcp.tools.changed",
          properties: {
            sessionID: "ses_native_tool",
            tools: [{ name: "memory_store" }],
          },
        },
      },
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_native_tool",
            part: {
              type: "tool",
              tool: "bash",
              callID: "call_bash_2",
              state: { status: "running", input: { command: "pwd" } },
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_native_tool", status: { type: "idle" } } },
      },
    ], 0.002);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "tool_use",
      toolName: "bash",
      input: { command: "pwd" },
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "tool_use",
        toolName: "bash",
        source: "mcp",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "tool_use",
        toolName: "bash",
        mcpSelector: expect.any(String),
      }),
    );
  });

  it("run() yields tool_result for completed tool via message.part.updated", async () => {
    const mock = makeMockClient("ses_789", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_789",
            part: {
              type: "tool",
              tool: "bash",
              callID: "call_bash_1",
              state: { status: "completed", input: { command: "echo hi" }, output: "hi\n", title: "bash" },
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_789", status: { type: "idle" } } },
      },
    ], 0.003);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "tool_result", toolName: "bash", output: "hi\n" });
  });

  it("run() maps session.diff events to provider-neutral file_changed events", async () => {
    const mock = makeMockClient("ses_diff", [
      {
        directory: "/tmp",
        payload: {
          type: "session.diff",
          properties: {
            sessionID: "ses_diff",
            diff: [{
              file: "proof.txt",
              patch: "diff --git a/proof.txt b/proof.txt",
              additions: 1,
              deletions: 1,
              status: "modified",
            }],
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_diff", status: { type: "idle" } } },
      },
    ], 0.003);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig({ cwd: "/tmp/kiln-opencode-live" }));
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test", cwd: "/tmp/kiln-opencode-live" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "file_changed",
      path: expect.stringContaining("proof.txt"),
      changeType: "modified",
      linesAdded: 1,
      linesRemoved: 1,
      diffTruncated: true,
    });
    expect(JSON.stringify(events)).not.toContain("diff --git");
  });

  it("run() maps denied write tool errors to provider-neutral write decisions", async () => {
    const mock = makeMockClient("ses_denied", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_denied",
            part: {
              type: "tool",
              tool: "edit",
              callID: "call_edit_denied",
              state: {
                status: "error",
                input: { filePath: "/tmp/proof.txt" },
                error: "Permission denied for edit",
              },
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_denied", status: { type: "idle" } } },
      },
    ], 0.003);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "write_decision",
      status: "denied",
      providerRequestId: "call_edit_denied",
      actor: "opencode-policy",
      reason: "Permission denied for edit",
    });
  });

  it("run() yields completed with cost from session prompt response", async () => {
    const mock = makeMockClient("ses_cost", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_cost", status: { type: "idle" } } },
      },
    ], 0.0042);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { totalUsd: number }).totalUsd).toBe(0.0042);
  });

  it("run() yields completed with isPreflightCrash false", async () => {
    const mock = makeMockClient("ses_done", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_done", status: { type: "idle" } } },
      },
    ], 0.005);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { isPreflightCrash: boolean }).isPreflightCrash).toBe(false);
  });

  it("run() yields error event on SDK session.create throw", async () => {
    vi.mocked(createOpencodeClient).mockReturnValueOnce({
      session: {
        create: vi.fn().mockRejectedValue(new Error("SDK connection failed")),
        prompt: vi.fn().mockResolvedValue({ data: { info: { cost: 0 } } }),
        abort: vi.fn().mockResolvedValue(undefined),
      },
      global: {
        event: vi.fn().mockResolvedValue({ stream: (function* () {})() }),
      },
      config: {
        update: vi.fn().mockResolvedValue({ data: undefined }),
      },
    } as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "error",
      code: "OPENCODE_ERROR",
      message: "SDK connection failed",
      isRetryable: false,
    });
  });

  it("run() does not yield any events after dispose", async () => {
    const session = new OpenCodeSession(baseConfig());
    await session.dispose();

    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
  });

  it("run() yields cost_update for usage_update sessionUpdate", async () => {
    const mock = makeMockClient("ses_cost", [
      {
        directory: "/tmp",
        payload: {
          type: "sessionUpdate",
          properties: {
            sessionID: "ses_cost",
            type: "usage_update",
            cost: { amount: 0.05 },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_cost", status: { type: "idle" } } },
      },
    ], 0.05);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual(expect.objectContaining({
      type: "cost_update",
      usd: 0.05,
      mode: "native",
      provider: "opencode",
    }));
    const costUpdateIndex = events.findIndex((e) => "type" in e && (e as { type: string }).type === "cost_update");
    const completedIndex = events.findIndex((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(costUpdateIndex).toBeLessThan(completedIndex);
  });

  it("run() yields a completed outcome for end_turn", async () => {
    const mock = makeMockClient("ses_ok", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_ok", status: { type: "idle" } } },
      },
    ], 0.01, "end_turn");
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { outcome: string }).outcome).toBe("completed");
  });

  it("run() yields a cancelled outcome for cancelled", async () => {
    const mock = makeMockClient("ses_cancel", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_cancel", status: { type: "idle" } } },
      },
    ], 0.01, "cancelled");
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { outcome: string }).outcome).toBe("cancelled");
  });

  it("run() respects abortSignal and kills subprocess", async () => {
    const mock = makeMockClient("ses_abort", [
      {
        directory: "/tmp",
        payload: { type: "message.part.delta", properties: { sessionID: "ses_abort", field: "text", delta: "hello" } },
      },
    ]);
    let resolveEvent: (value: unknown) => void;
    const eventPromise = new Promise((resolve) => {
      resolveEvent = resolve;
    });
    mock.global.event = vi.fn().mockImplementation(() => ({
      stream: (async function* () {
        await eventPromise;
      })(),
    }));
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig({ baseUrl: undefined }));
    const killFn = vi.fn();
    vi.spyOn(session, "spawnAndWaitForServe").mockImplementation(async () => {
      session.serveProcess = { kill: killFn, killed: false } as unknown as ReturnType<typeof import("node:child_process").spawn>;
      return 9876;
    });
    const abortController = new AbortController();

    const runPromise = (async () => {
      for await (const _ of await session.run({ prompt: "test", abortSignal: abortController.signal })) {
        abortController.abort();
      }
    })();

    await new Promise((r) => setTimeout(r, 10));
    resolveEvent!(undefined);

    await runPromise;
    expect(killFn).toHaveBeenCalledWith("SIGTERM");
  });

  it("dispose() calls kill() on subprocess", async () => {
    const session = new OpenCodeSession(baseConfig({ baseUrl: undefined }));
    vi.spyOn(session, "spawnAndWaitForServe").mockImplementation(async () => {
      session.serveProcess = { kill: vi.fn(), killed: false } as unknown as ReturnType<typeof import("node:child_process").spawn>;
      return 9876;
    });
    vi.mocked(createOpencodeClient).mockReturnValueOnce(makeMockClient("ses_disp2", [
      { directory: "/tmp", payload: { type: "session.status", properties: { sessionID: "ses_disp2", status: { type: "idle" } } } },
    ]) as any);

    const runPromise = (async () => {
      for await (const _ of await session.run({ prompt: "test" })) {
        // consume events
      }
    })();

    while (!session.serveProcess) {
      await new Promise((r) => setTimeout(r, 5));
    }

    const killFn = vi.spyOn(session.serveProcess!, "kill");
    await session.dispose();
    await runPromise;

    expect(killFn).toHaveBeenCalledWith("SIGTERM");
  });

  describe("resume path", () => {
    it("calls session.get when provider thread metadata exists in store", async () => {
      const mock = {
        session: {
          create: vi.fn().mockResolvedValue({ data: { id: "should-not-be-used" } }),
          get: vi.fn().mockResolvedValue({ data: { id: "oc-abc", time: { created: 1234567890 } } }),
          prompt: vi.fn().mockResolvedValue({ data: { info: { cost: 0, stopReason: "end_turn" } } }),
          abort: vi.fn().mockResolvedValue(undefined),
        },
        global: {
          event: vi.fn().mockResolvedValue({
            stream: makeStream({
              directory: "/tmp",
              payload: { type: "session.status", properties: { sessionID: "oc-abc", status: { type: "idle" } } },
            }).stream,
          }),
        },
        config: {
          update: vi.fn().mockResolvedValue({ data: undefined }),
        },
      };
      vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

      const { SessionStore } = await import("../../src/wrapper/session-store.js");
      vi.spyOn(SessionStore.prototype, "findProviderThread")
        .mockResolvedValueOnce({ provider: "opencode", nativeSessionId: "oc-abc" });
      vi.spyOn(SessionStore.prototype, "append").mockResolvedValueOnce(undefined);

      const session = new OpenCodeSession(baseConfig({ continuationSessionId: "k-123" }));
      const events: object[] = [];
      for await (const event of await session.run({ prompt: "resume me" })) {
        events.push(event);
      }

      expect(mock.session.get).toHaveBeenCalledWith(
        { sessionID: "oc-abc", directory: expect.any(String) },
        { throwOnError: true },
      );
      expect(mock.session.create).not.toHaveBeenCalled();
    });

    it("calls session.create when no continuationSessionId configured", async () => {
      const mock = makeMockClient("oc-fresh", [
        {
          directory: "/tmp",
          payload: { type: "session.status", properties: { sessionID: "oc-fresh", status: { type: "idle" } } },
        },
      ]);
      vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

      const { SessionStore } = await import("../../src/wrapper/session-store.js");
      const getFn = vi.spyOn(SessionStore.prototype, "find").mockResolvedValueOnce(null);
      vi.spyOn(SessionStore.prototype, "append").mockResolvedValueOnce(undefined);

      const session = new OpenCodeSession(baseConfig());
      for await (const _ of await session.run({ prompt: "fresh start" })) {
        // consume
      }

      expect(mock.session.create).toHaveBeenCalled();
      expect(getFn).not.toHaveBeenCalled();
    });

    it("falls back to session.create when no provider thread exists", async () => {
      const mock = makeMockClient("oc-fallback", [
        {
          directory: "/tmp",
          payload: { type: "session.status", properties: { sessionID: "oc-fallback", status: { type: "idle" } } },
        },
      ]);
      vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

      const { SessionStore } = await import("../../src/wrapper/session-store.js");
      vi.spyOn(SessionStore.prototype, "findProviderThread").mockResolvedValueOnce(undefined);
      vi.spyOn(SessionStore.prototype, "append").mockResolvedValueOnce(undefined);

      const session = new OpenCodeSession(baseConfig({ continuationSessionId: "k-missing" }));
      for await (const _ of await session.run({ prompt: "no prior session" })) {
        // consume
      }

      expect(mock.session.create).toHaveBeenCalled();
    });
  });

  it("run() yields error event when spawnAndWaitForServe rejects", async () => {
    vi.mocked(createOpencodeClient).mockReturnValueOnce({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "ses_err" } }),
        prompt: vi.fn().mockResolvedValue({ data: { info: { cost: 0 } } }),
        abort: vi.fn().mockResolvedValue(undefined),
      },
      global: {
        event: vi.fn().mockResolvedValue({ stream: (function* () {})() }),
      },
    } as any);

    const session = new OpenCodeSession(baseConfig({ baseUrl: undefined }));
    vi.spyOn(session, "spawnAndWaitForServe").mockRejectedValue(new Error("opencode serve failed to start within 10 seconds"));

    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "error",
      code: "OPENCODE_ERROR",
      message: "opencode serve failed to start within 10 seconds",
      isRetryable: false,
    });
  });
});

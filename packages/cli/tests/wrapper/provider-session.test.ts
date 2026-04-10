import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { IKilnSession, SessionEvent } from "../../src/wrapper/session.js";
import { ProviderSession } from "../../src/wrapper/provider-session.js";
import type { ProviderSessionConfig } from "../../src/wrapper/provider-session.js";

type MockAdapter = {
  readonly ctor: ReturnType<typeof vi.fn>;
  readonly stream: ReturnType<typeof vi.fn>;
};

const adapterMocks = vi.hoisted(
  (): Record<"anthropic" | "openai" | "deepseek" | "openrouter" | "ollama", MockAdapter> => ({
    anthropic: { ctor: vi.fn(), stream: vi.fn() },
    openai: { ctor: vi.fn(), stream: vi.fn() },
    deepseek: { ctor: vi.fn(), stream: vi.fn() },
    openrouter: { ctor: vi.fn(), stream: vi.fn() },
    ollama: { ctor: vi.fn(), stream: vi.fn() },
  }),
);

function makeAdapter(name: keyof typeof adapterMocks) {
  return class {
    constructor(config: unknown) {
      adapterMocks[name].ctor(config);
    }

    streamMessage(
      options: unknown,
    ): AsyncGenerator<{ type: string; content: string; inputTokens?: number; outputTokens?: number }> {
      return adapterMocks[name].stream(options);
    }
  };
}

vi.mock("@kilnai/core", () => ({
  AnthropicAdapter: makeAdapter("anthropic"),
  OpenAIAdapter: makeAdapter("openai"),
  DeepSeekAdapter: makeAdapter("deepseek"),
  OpenRouterAdapter: makeAdapter("openrouter"),
  OllamaAdapter: makeAdapter("ollama"),
  resolveExecutionIdentity: ({
    configuredProvider,
    configuredModel,
    routedProvider,
    routedModel,
  }: {
    configuredProvider?: string;
    configuredModel?: string;
    routedProvider?: string;
    routedModel?: string;
  }) => {
    const provider = routedProvider ?? configuredProvider;
    const model = routedModel ?? configuredModel;
    if (!provider && !model) return undefined;
    return {
      source: routedProvider || routedModel ? "runtime-routed" : "configured",
      provider,
      model,
    };
  },
  appendExecutionIdentity: (
    basePrompt: string,
    identity?: { source: string; provider?: string; model?: string },
  ) => {
    if (!identity) return basePrompt;
    const lines = ["[KILN EXECUTION IDENTITY]"];
    if (identity.provider) lines.push(`provider: ${identity.provider}`);
    if (identity.model) lines.push(`model: ${identity.model}`);
    lines.push(`source: ${identity.source}`);
    lines.push("If asked about provider/model, use this identity for this turn.");
    const section = lines.join("\n");
    return basePrompt.trim().length > 0 ? `${basePrompt}\n\n${section}` : section;
  },
  textPart: (text: string) => ({ type: "text", text }),
}));

async function* streamEvents(
  events: readonly { type: string; content: string; inputTokens?: number; outputTokens?: number }[],
) {
  for (const event of events) {
    yield event;
  }
}

async function collectEvents(iter: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const event of iter) {
    events.push(event);
  }
  return events;
}

function baseConfig(overrides: Partial<ProviderSessionConfig> = {}): ProviderSessionConfig {
  return {
    provider: "openai",
    task: "Implement provider session",
    permissionPolicy: { approval: "on-request", sandbox: "read-only" },
    ...overrides,
  };
}

describe("ProviderSession implements IKilnSession", () => {
  it("declares implements IKilnSession", () => {
    const session: IKilnSession = new ProviderSession(baseConfig());
    expect(session).toBeDefined();
  });

  it("sessionId is a non-empty UUID string", () => {
    const session = new ProviderSession(baseConfig());
    expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("providerSessionId is undefined", () => {
    const session = new ProviderSession(baseConfig());
    expect(session.providerSessionId).toBeUndefined();
  });

  it("capabilities match Phase 10a requirements", () => {
    const session = new ProviderSession(baseConfig());
    expect(session.capabilities).toMatchObject({
      mcp: false,
      streaming: true,
      resumable: false,
      resume: false,
      costTrackingMode: "computed",
      priority: 5,
      fallbackTo: null,
    });
  });

  it("assigns provider-specific priorities", () => {
    expect(new ProviderSession(baseConfig({ provider: "anthropic" })).capabilities.priority).toBe(4);
    expect(new ProviderSession(baseConfig({ provider: "openai" })).capabilities.priority).toBe(5);
    expect(new ProviderSession(baseConfig({ provider: "openrouter" })).capabilities.priority).toBe(6);
    expect(new ProviderSession(baseConfig({ provider: "deepseek" })).capabilities.priority).toBe(7);
    expect(new ProviderSession(baseConfig({ provider: "ollama" })).capabilities.priority).toBe(8);
  });

  it("dispose resolves and is a no-op", async () => {
    const session = new ProviderSession(baseConfig());
    await expect(session.dispose()).resolves.toBeUndefined();
    await expect(session.dispose()).resolves.toBeUndefined();
  });
});

describe("ProviderSession.run()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const mock of Object.values(adapterMocks)) {
      mock.ctor.mockReset();
      mock.stream.mockReset();
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("maps provider stream events into SessionEvent shape", async () => {
    adapterMocks.openai.stream.mockReturnValue(
      streamEvents([
        { type: "thinking", content: "thinking..." },
        { type: "text", content: "hello" },
        { type: "tool_use", content: JSON.stringify({ name: "memory_store", input: { key: "k", value: "v" } }) },
        { type: "tool_result", content: "stored" },
        { type: "done", content: "" },
      ]),
    );

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
    }));
    const events = await collectEvents(session.run({ prompt: "test prompt" }));

    expect(events).toContainEqual({ type: "text_delta", content: "thinking...", isThinking: true });
    expect(events).toContainEqual({ type: "text_delta", content: "hello" });
    expect(events).toContainEqual({
      type: "text_delta",
      content: JSON.stringify({ name: "memory_store", input: { key: "k", value: "v" } }),
    });
    expect(events).toContainEqual({ type: "text_delta", content: "stored" });
    expect(events).toContainEqual({ type: "cost_update", usd: 0, mode: "computed" });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: false }));
  });

  it("does not emit executable tool events for direct-provider tool frames", async () => {
    adapterMocks.openai.stream.mockReturnValue(
      streamEvents([
        { type: "tool_use", content: "{bad-json}" },
        { type: "tool_result", content: "tool output" },
        { type: "done", content: "" },
      ]),
    );

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
    }));
    const events = await collectEvents(session.run({ prompt: "parse test" }));

    expect(events.some((event) => event.type === "tool_use" || event.type === "tool_result")).toBe(false);
    expect(events).toContainEqual({ type: "text_delta", content: "{bad-json}" });
    expect(events).toContainEqual({ type: "text_delta", content: "tool output" });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: false }));
  });

  it("yields error and completed when adapter streaming throws", async () => {
    const errStream = (async function* () {
      throw new Error("provider stream exploded");
    })();
    adapterMocks.openai.stream.mockReturnValue(errStream);

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
    }));
    const events = await collectEvents(session.run({ prompt: "error test" }));

    expect(events).toContainEqual({
      type: "error",
      code: "PROVIDER_SESSION_ERROR",
      message: "provider stream exploded",
      isRetryable: false,
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: true }));
  });

  it("respects abortSignal before start", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
    }));

    const events = await collectEvents(session.run({
      prompt: "aborted",
      abortSignal: abortController.signal,
    }));

    expect(events).toContainEqual({
      type: "error",
      code: "ABORTED",
      message: "Aborted before start",
      isRetryable: false,
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: true }));
  });

  it("resolves API key from options.env before config.env and process.env", async () => {
    process.env.OPENAI_API_KEY = "process-key";
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "config-key" },
    }));

    await collectEvents(session.run({
      prompt: "key precedence",
      env: { OPENAI_API_KEY: "options-key" },
    }));

    expect(adapterMocks.openai.ctor).toHaveBeenCalledWith({
      apiKey: "options-key",
      defaultModel: undefined,
    });
  });

  it("resolves API key from config.env when options.env is not set", async () => {
    delete process.env.OPENAI_API_KEY;
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "config-key" },
    }));

    await collectEvents(session.run({ prompt: "config key" }));

    expect(adapterMocks.openai.ctor).toHaveBeenCalledWith({
      apiKey: "config-key",
      defaultModel: undefined,
    });
  });

  it("resolves API key from process.env when options and config env are missing", async () => {
    process.env.OPENAI_API_KEY = "process-key";
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));

    const session = new ProviderSession(baseConfig({
      provider: "openai",
    }));

    await collectEvents(session.run({ prompt: "process key" }));

    expect(adapterMocks.openai.ctor).toHaveBeenCalledWith({
      apiKey: "process-key",
      defaultModel: undefined,
    });
  });

  it("does not require API key for ollama and uses OLLAMA_BASE_URL from env", async () => {
    delete process.env.OLLAMA_API_KEY;
    adapterMocks.ollama.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));

    const session = new ProviderSession(baseConfig({
      provider: "ollama",
      model: "llama3.2",
    }));

    await collectEvents(session.run({
      prompt: "ollama",
      env: { OLLAMA_BASE_URL: "http://127.0.0.1:11435" },
    }));

    expect(adapterMocks.ollama.ctor).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:11435",
      defaultModel: "llama3.2",
    });
  });

  it("appends [KILN POLICY CONSTRAINTS] section into system prompt", async () => {
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));
    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
      systemPrompt: "Base prompt",
      constraintInstructions: [
        "[file-governance] DENY **/.env",
        "[data-firewall] REDACT logs",
      ],
    }));

    await collectEvents(session.run({ prompt: "constraint prompt" }));

    const streamCall = adapterMocks.openai.stream.mock.calls[0]?.[0] as {
      system: string;
      messages: unknown[];
    };
    expect(streamCall.system).toContain("Base prompt");
    expect(streamCall.system).toContain("[KILN POLICY CONSTRAINTS]");
    expect(streamCall.system).toContain("[KILN EXECUTION IDENTITY]");
    expect(streamCall.system).toContain("provider: openai");
    expect(streamCall.system).toContain("[file-governance] DENY **/.env");
    expect(streamCall.system).toContain("[data-firewall] REDACT logs");
    expect(Array.isArray(streamCall.messages)).toBe(true);
    expect(streamCall.messages).toEqual([{
      role: "user",
      parts: [{ type: "text", text: "constraint prompt" }],
    }]);
  });

  it("uses structured preamble prompt as system and task as user message", async () => {
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));
    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
      task: "Ship provider session implementation",
      systemPrompt: "legacy system prompt should not be used in preamble mode",
      constraintInstructions: ["[file-governance] DENY **/.env"],
    }));

    await collectEvents(session.run({
      prompt: "<kiln-preamble><task>governed prompt context</task></kiln-preamble>",
    }));

    const streamCall = adapterMocks.openai.stream.mock.calls[0]?.[0] as {
      system: string;
      messages: unknown[];
    };
    expect(streamCall.system).toContain("<kiln-preamble><task>governed prompt context</task></kiln-preamble>");
    expect(streamCall.system).toContain("[KILN POLICY CONSTRAINTS]");
    expect(streamCall.system).toContain("[KILN EXECUTION IDENTITY]");
    expect(streamCall.system).toContain("provider: openai");
    expect(streamCall.system).not.toContain("legacy system prompt should not be used in preamble mode");
    expect(streamCall.messages).toEqual([{
      role: "user",
      parts: [{ type: "text", text: "Ship provider session implementation" }],
    }]);
  });

  it("updates context tracker on done event token totals", async () => {
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{
      type: "done",
      content: "",
      inputTokens: 123,
      outputTokens: 77,
    }]));
    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
    }));

    await collectEvents(session.run({ prompt: "token tracking" }));

    const tracker = (session as unknown as {
      contextTracker: { totalTokens: number };
    }).contextTracker;
    expect(tracker.totalTokens).toBe(200);
  });
});

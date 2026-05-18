import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { IKilnSession, SessionEvent } from "../../src/wrapper/session.js";
import { ProviderSession } from "../../src/wrapper/provider-session.js";
import type { ProviderSessionConfig } from "../../src/wrapper/provider-session.js";
import { AllCredentialsExhaustedError } from "@kilnai/core";

type MockAdapter = {
  readonly ctor: ReturnType<typeof vi.fn>;
  readonly stream: ReturnType<typeof vi.fn>;
};

const adapterMocks = vi.hoisted(
  (): Record<"codex-oauth" | "anthropic" | "openai" | "deepseek" | "openrouter" | "ollama" | "lmstudio", MockAdapter> => ({
    "codex-oauth": { ctor: vi.fn(), stream: vi.fn() },
    anthropic: { ctor: vi.fn(), stream: vi.fn() },
    openai: { ctor: vi.fn(), stream: vi.fn() },
    deepseek: { ctor: vi.fn(), stream: vi.fn() },
    openrouter: { ctor: vi.fn(), stream: vi.fn() },
    ollama: { ctor: vi.fn(), stream: vi.fn() },
    lmstudio: { ctor: vi.fn(), stream: vi.fn() },
  }),
);

const runtimeMocks = vi.hoisted(() => ({
  processMessage: vi.fn(),
  orchestratorConstructor: vi.fn(),
  addUserMessage: vi.fn(),
  addAssistantMessage: vi.fn(),
}));

const coreSurfaceMocks = vi.hoisted(() => ({
  createDefaultBuiltinToolSurface: vi.fn(),
  bridgeExecute: vi.fn(),
}));

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

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  const mockToolDefinitions = [{
    name: "mock_builtin",
    description: "Mock builtin tool",
    inputSchema: { type: "object", properties: {}, required: [] },
    tags: new Set<string>(),
  }];
  const mockCapabilities = new Map([[
    "mock_builtin",
    {
      name: "mock_builtin",
      description: "Mock builtin tool",
      schema: { type: "object", properties: {}, required: [] },
      tags: [],
      annotations: { readOnly: true },
    },
  ]]);

  return {
    ...actual,
    CodexOAuthAdapter: makeAdapter("codex-oauth"),
    CodexOAuthAuth: vi.fn(function MockCodexOAuthAuth() {
      return {
        getValidAccessToken: vi.fn(),
      };
    }),
    AnthropicAdapter: makeAdapter("anthropic"),
    OpenAIAdapter: makeAdapter("openai"),
    DeepSeekAdapter: makeAdapter("deepseek"),
    OpenRouterAdapter: makeAdapter("openrouter"),
    OllamaAdapter: makeAdapter("ollama"),
    LmStudioAdapter: makeAdapter("lmstudio"),
    createDefaultBuiltinToolSurface: coreSurfaceMocks.createDefaultBuiltinToolSurface.mockImplementation(() => ({
      tools: [],
      toolNames: ["mock_builtin"],
      registry: {
        lookup: vi.fn(),
        list: vi.fn(() => []),
        has: vi.fn((name: string) => name === "mock_builtin"),
        size: 1,
      },
      toolDefinitions: mockToolDefinitions,
      capabilities: mockCapabilities,
      bridge: {
        execute: coreSurfaceMocks.bridgeExecute.mockResolvedValue({
          result: { output: "mock output", isError: false },
          attempts: 1,
          fallbackUsed: false,
        }),
        listTools: vi.fn(() => []),
        authorizeRequest: vi.fn(),
        authorizeRequestWithAuthority: vi.fn(),
      },
    })),
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
  };
});

vi.mock("@kilnai/runtime", () => {
  class MockRuntimeSession {
    addUserMessage = runtimeMocks.addUserMessage;
    addAssistantMessage = runtimeMocks.addAssistantMessage;
    conversationHistory: unknown[] = [];
    sessionMode = "ai_active" as const;
    id = "cli-test-session";
  }

  return {
    buildEffectiveTurnAuthorityPolicyInputs: (input: {
      executionMode: "execute" | "plan";
      tenantId?: string;
      requestedAuthority: string;
      admittedAuthority: string;
      routeReason: string;
    }) => [
      {
        source: "requested_authority",
        status: "applied",
        requestedAuthority: input.requestedAuthority,
        reason: `Operator requested ${input.requestedAuthority} authority.`,
      },
      {
        source: "session_policy",
        status: "applied",
        admittedAuthority: "unknown",
        reason: "No narrower session authority policy is configured for this turn.",
      },
      {
        source: "tenant_policy",
        status: input.tenantId ? "applied" : "unresolved",
        ...(input.tenantId ? { subjectId: input.tenantId } : {}),
        admittedAuthority: "unknown",
        reason: input.tenantId
          ? `Tenant ${input.tenantId} contributes the runtime tool surface policy.`
          : "Tenant policy input is unavailable for this turn.",
      },
      {
        source: "route_policy",
        status: "applied",
        admittedAuthority: input.admittedAuthority,
        reason: input.routeReason,
      },
      {
        source: "parent_authority",
        status: "not_applicable",
        reason: "Operator turns have no parent managed-agent authority.",
      },
      {
        source: "plan_approval",
        status: input.executionMode === "plan" ? "applied" : "not_applicable",
        ...(input.executionMode === "plan" ? { admittedAuthority: "read_only" } : {}),
        reason: input.executionMode === "plan"
          ? "Plan mode applies the plan approval workflow read-only authority envelope."
          : "Execute-mode turns are not governed by plan-mode approval policy.",
      },
      {
        source: "goal_envelope",
        status: "not_applicable",
        reason: "Goal envelopes are introduced by Slice 6 and are not available to this Slice 5 admission.",
      },
      {
        source: "work_item_authority",
        status: "not_applicable",
        reason: "Work-item authority envelopes are introduced by Slice 7 and are not available to this Slice 5 admission.",
      },
    ],
    describeEffectiveTurnAuthorityActionability: (input: {
      requestedAuthority?: string;
    }) => ({
      authorityMode: input.requestedAuthority ?? "auto",
      admittedAuthority: "unknown",
      mutationUnavailable: false,
      approvalActionable: false,
      nextAction: "continue_with_admitted_route",
    }),
    formatEffectiveTurnAuthorityGuidance: (actionability: {
      authorityMode: string;
      admittedAuthority: string;
      approvalActionable: boolean;
    }) => [
      `Authority mode: ${actionability.authorityMode}.`,
      `Admitted authority: ${actionability.admittedAuthority}.`,
      `Approval actionable: ${actionability.approvalActionable ? "yes" : "no"}.`,
      "Requested authority is a runtime execution limit, not a natural-language approval workflow.",
      "Do not ask the operator to approve work in natural language.",
      "Only runtime approval_requested events create approval actions in CLI, TUI, and GUI surfaces.",
    ].join("\n"),
    createAttachedRuntimeBuiltinToolSurface: vi.fn((options?: {
      operatorSurface?: {
        theme?: {
          setTheme(input: { theme: string; scope: "session" | "persisted"; reason?: string }): Promise<{
            ok: boolean;
            appliedTheme?: string;
            error?: string;
          }>;
        };
      };
    }) => {
      const coreSurface = coreSurfaceMocks.createDefaultBuiltinToolSurface();
      const callBuiltinTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
      for (const toolName of coreSurface.toolNames as readonly string[]) {
        callBuiltinTools.set(toolName, async (input: Record<string, unknown>) => {
          const execution = await coreSurface.bridge.execute({ name: toolName, input });
          const result = execution.result;
          return { output: result.output, isError: result.isError, metadata: result.metadata };
        });
      }
      const toolDefinitions = [...coreSurface.toolDefinitions];
      const capabilities = new Map(coreSurface.capabilities);
      if (options?.operatorSurface?.theme) {
        const themeController = options.operatorSurface.theme;
        callBuiltinTools.set("operator_set_theme", async (input: Record<string, unknown>) => (
          themeController.setTheme({
            theme: typeof input.theme === "string" ? input.theme : "",
            scope: input.scope === "persisted" ? "persisted" : "session",
            ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
          })
        ));
        toolDefinitions.push({
          name: "operator_set_theme",
          description: "Mock operator theme tool",
          inputSchema: { type: "object", properties: {}, required: ["theme"] },
          tags: new Set<string>(["operator-ui"]),
        });
        capabilities.set("operator_set_theme", {
          name: "operator_set_theme",
          description: "Mock operator theme tool",
          schema: { type: "object", properties: {}, required: ["theme"] },
          tags: ["operator-ui"],
          annotations: { idempotent: true },
        });
      }
      return {
        callBuiltinTools,
        toolDefinitions,
        capabilities,
        toolAuthority: new Map(),
      };
    }),
    RuntimeSessionOrchestrator: class MockRuntimeSessionOrchestrator {
      constructor(...args: unknown[]) {
        runtimeMocks.orchestratorConstructor(...args);
      }
      processMessage = runtimeMocks.processMessage;
    },
    RuntimeSession: MockRuntimeSession,
    CodexOAuthCredentialPoolService: class MockCodexOAuthCredentialPoolService {
      async createPooledAdapter(config: { defaultModel?: string }) {
        const Adapter = makeAdapter("codex-oauth");
        return new Adapter(config);
      }
    },
    DirectProviderCredentialPoolService: class MockDirectProviderCredentialPoolService {
      private readonly env: Record<string, string | undefined>;

      constructor(config?: { env?: Record<string, string | undefined> }) {
        this.env = config?.env ?? {};
      }

      async listStatus(provider: string) {
        if (provider === "ollama" || provider === "lmstudio") return [{ id: "env" }];
        const envKey = {
          anthropic: "ANTHROPIC_API_KEY",
          openai: "OPENAI_API_KEY",
          deepseek: "DEEPSEEK_API_KEY",
          openrouter: "OPENROUTER_API_KEY",
        }[provider];
        return envKey && this.env[envKey] ? [{ id: "env" }] : [];
      }

      async createPooledAdapter(config: {
        provider: keyof typeof adapterMocks;
        defaultModel?: string;
        openRouterAppUrl?: string;
        openRouterAppName?: string;
      }) {
        const Adapter = makeAdapter(config.provider);
        const adapterConfig = (() => {
          switch (config.provider) {
            case "anthropic":
              return { apiKey: this.env.ANTHROPIC_API_KEY, defaultModel: config.defaultModel };
            case "openai":
              return { apiKey: this.env.OPENAI_API_KEY, defaultModel: config.defaultModel };
            case "deepseek":
              return { apiKey: this.env.DEEPSEEK_API_KEY, defaultModel: config.defaultModel };
            case "openrouter":
              return {
                apiKey: this.env.OPENROUTER_API_KEY,
                defaultModel: config.defaultModel,
                appUrl: config.openRouterAppUrl,
                appName: config.openRouterAppName,
              };
            case "ollama":
              return { baseUrl: this.env.OLLAMA_BASE_URL, defaultModel: config.defaultModel };
            case "lmstudio":
              return { apiKey: this.env.LMSTUDIO_API_KEY, baseUrl: this.env.LMSTUDIO_BASE_URL, defaultModel: config.defaultModel };
            default:
              return { defaultModel: config.defaultModel };
          }
        })();
        return new Adapter(adapterConfig);
      }
    },
    isPooledDirectProviderId: (provider: string) => (
      provider === "anthropic"
      || provider === "openai"
      || provider === "deepseek"
      || provider === "openrouter"
      || provider === "ollama"
      || provider === "lmstudio"
    ),
  };
});

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
    expect(new ProviderSession(baseConfig({ provider: "lmstudio" })).capabilities.priority).toBe(9);
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
    runtimeMocks.processMessage.mockReset();
    runtimeMocks.orchestratorConstructor.mockReset();
    runtimeMocks.addUserMessage.mockReset();
    runtimeMocks.addAssistantMessage.mockReset();
    coreSurfaceMocks.createDefaultBuiltinToolSurface.mockClear();
    coreSurfaceMocks.bridgeExecute.mockClear();
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
      model: "gpt-4o",
      env: { OPENAI_API_KEY: "cfg-key" },
      executionMode: "text-only",
    }));
    const events = await collectEvents(session.run({ prompt: "test prompt" }));

    expect(events).toContainEqual({ type: "text_delta", content: "thinking...", isThinking: true });
    expect(events).toContainEqual({ type: "text_delta", content: "hello" });
    expect(events).toContainEqual({
      type: "tool_use",
      toolName: "memory_store",
      input: { key: "k", value: "v" },
    });
    expect(events).toContainEqual({
      type: "error",
      code: "TOOL_UNSUPPORTED",
      message: "Provider emitted a tool call in text-only execution mode.",
      isRetryable: false,
    });
    expect(events).toContainEqual({ type: "tool_result", toolName: "provider_tool_result", output: "stored" });
    expect(events).toContainEqual(expect.objectContaining({
      type: "cost_update",
      usd: 0,
      mode: "computed",
      provider: "openai",
      model: "gpt-4o",
      canonicalModel: "gpt-4o",
      billingMode: "metered",
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: true }));
  });

  it.each([
    {
      provider: "codex-oauth",
      config: { model: "gpt-5.4", executionMode: "text-only" as const },
    },
    {
      provider: "anthropic",
      config: {
        model: "claude-sonnet-4-6",
        env: { ANTHROPIC_API_KEY: "cfg-key" },
        executionMode: "text-only" as const,
      },
    },
    {
      provider: "openai",
      config: {
        model: "gpt-5.4",
        env: { OPENAI_API_KEY: "cfg-key" },
        executionMode: "text-only" as const,
      },
    },
  ] satisfies Array<{
    readonly provider: ProviderSessionConfig["provider"];
    readonly config: Partial<ProviderSessionConfig>;
  }>)("keeps $provider tool frames typed in text-only mode", async ({ provider, config }) => {
    adapterMocks[provider].stream.mockReturnValue(
      streamEvents([
        {
          type: "tool_use",
          content: JSON.stringify({
            name: "write",
            input: { path: "src/feature.ts", content: "export const x = 1;" },
          }),
        },
        { type: "tool_result", content: "tool output" },
        { type: "done", content: "" },
      ]),
    );

    const session = new ProviderSession(baseConfig({
      provider,
      ...config,
    }));
    const events = await collectEvents(session.run({ prompt: "parse test" }));

    expect(session.capabilities.supportedTools).toHaveLength(0);
    expect(events).toContainEqual({
      type: "tool_use",
      toolName: "write",
      input: { path: "src/feature.ts", content: "export const x = 1;" },
    });
    expect(events).toContainEqual({
      type: "error",
      code: "TOOL_UNSUPPORTED",
      message: "Provider emitted a tool call in text-only execution mode.",
      isRetryable: false,
    });
    expect(events).toContainEqual({ type: "tool_result", toolName: "provider_tool_result", output: "tool output" });
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: true }));
  });

  it.each([
    {
      provider: "codex-oauth",
      config: { model: "gpt-5.4" },
    },
    {
      provider: "anthropic",
      config: { model: "claude-sonnet-4-6", env: { ANTHROPIC_API_KEY: "cfg-key" } },
    },
    {
      provider: "openai",
      config: { model: "gpt-5.4", env: { OPENAI_API_KEY: "cfg-key" } },
    },
  ] satisfies Array<{
    readonly provider: ProviderSessionConfig["provider"];
    readonly config: Partial<ProviderSessionConfig>;
  }>)("emits canonical tool_result and file_changed events for executable $provider sessions", async ({ provider, config }) => {
    runtimeMocks.processMessage.mockResolvedValueOnce({
      parts: [{ type: "text", text: "applied changes" }],
      toolExecutions: [
        {
          toolCallId: "call_write_1",
          toolName: "write",
          input: { filePath: "src/feature.ts", content: "export const feature = true;" },
          durationMs: 20,
          success: true,
          output: "export const feature = true;",
          resultSummary: "wrote src/feature.ts",
          fileChanges: [{ path: "src/feature.ts", changeType: "modified" as const }],
        },
      ],
      inputTokens: 11,
      outputTokens: 9,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ProviderSession(baseConfig({
      provider,
      ...config,
    }));
    const events = await collectEvents(session.run({ prompt: "execute tool path" }));

    expect(session.capabilities.supportedTools).toEqual(["mock_builtin", "operator_set_theme"]);
    expect(events).toContainEqual({ type: "text_delta", content: "applied changes" });
    expect(events).toContainEqual({
      type: "tool_use",
      toolName: "write",
      toolCallId: "call_write_1",
      input: { filePath: "src/feature.ts", content: "export const feature = true;" },
    });
    expect(events).toContainEqual({
      type: "tool_result",
      toolName: "write",
      toolCallId: "call_write_1",
      output: "export const feature = true;",
      outputSummary: "wrote src/feature.ts",
    });
    const toolUseIndex = events.findIndex((event) => event.type === "tool_use" && event.toolCallId === "call_write_1");
    const toolResultIndex = events.findIndex((event) => event.type === "tool_result" && event.toolCallId === "call_write_1");
    const textIndex = events.findIndex((event) => event.type === "text_delta" && event.content === "applied changes");
    expect(toolUseIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndex).toBeGreaterThan(toolUseIndex);
    expect(textIndex).toBeGreaterThan(toolResultIndex);
    expect(events).toContainEqual({
      type: "file_changed",
      path: "src/feature.ts",
      changeType: "modified",
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "cost_update",
      mode: "computed",
      provider,
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: false }));
  });

  it("records min-policy inputs for CLI executable requested authority", async () => {
    runtimeMocks.processMessage.mockResolvedValueOnce({
      parts: [{ type: "text", text: "authority applied" }],
      toolExecutions: [],
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      model: "gpt-5.4",
      env: { OPENAI_API_KEY: "cfg-key" },
      executionMode: "kiln-executable",
    }));

    await collectEvents(session.run({
      prompt: "execute with authority evidence",
      requestedAuthority: "audited",
    }));

    const perCallConfig = runtimeMocks.processMessage.mock.calls[0]?.[4] as {
      effectiveTurnAuthority?: {
        policyInputs?: readonly unknown[];
      };
    } | undefined;

    expect(perCallConfig?.effectiveTurnAuthority?.policyInputs).toEqual([
      {
        source: "requested_authority",
        status: "applied",
        requestedAuthority: "audited",
        reason: "Operator requested audited authority.",
      },
      {
        source: "session_policy",
        status: "applied",
        admittedAuthority: "unknown",
        reason: "No narrower session authority policy is configured for this turn.",
      },
      {
        source: "tenant_policy",
        status: "unresolved",
        admittedAuthority: "unknown",
        reason: "Tenant policy input is unavailable for this turn.",
      },
      {
        source: "route_policy",
        status: "applied",
        admittedAuthority: "audited",
        reason: "cli direct-provider requested turn authority",
      },
      {
        source: "parent_authority",
        status: "not_applicable",
        reason: "Operator turns have no parent managed-agent authority.",
      },
      {
        source: "plan_approval",
        status: "not_applicable",
        reason: "Execute-mode turns are not governed by plan-mode approval policy.",
      },
      {
        source: "goal_envelope",
        status: "not_applicable",
        reason: "Goal envelopes are introduced by Slice 6 and are not available to this Slice 5 admission.",
      },
      {
        source: "work_item_authority",
        status: "not_applicable",
        reason: "Work-item authority envelopes are introduced by Slice 7 and are not available to this Slice 5 admission.",
      },
    ]);
  });

  it("streams runtime tool events before the final executable assistant text", async () => {
    runtimeMocks.processMessage.mockImplementationOnce(async () => {
      const deps = runtimeMocks.orchestratorConstructor.mock.calls.at(-1)?.[0] as {
        eventBus?: {
          emit(event: unknown): void;
        };
      } | undefined;
      deps?.eventBus?.emit({
        type: "tool_called",
        toolName: "write",
        toolInput: { filePath: "live.txt", content: "live" },
        sessionId: "cli-test-session",
        timestamp: new Date(),
      });
      deps?.eventBus?.emit({
        type: "tool_result",
        toolName: "write",
        durationMs: 5,
        success: true,
        output: "live",
        resultSummary: "wrote live.txt",
        sessionId: "cli-test-session",
        timestamp: new Date(),
      });
      return {
        parts: [{ type: "text", text: "applied live changes" }],
        toolExecutions: [
          {
            toolCallId: "call_live_write",
            toolName: "write",
            input: { filePath: "live.txt", content: "live" },
            durationMs: 5,
            success: true,
            output: "live",
            resultSummary: "wrote live.txt",
            fileChanges: [{ path: "live.txt", changeType: "modified" as const }],
          },
        ],
        inputTokens: 3,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
      };
    });

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      model: "gpt-5.4",
      env: { OPENAI_API_KEY: "cfg-key" },
      executionMode: "kiln-executable",
    }));
    const events = await collectEvents(session.run({ prompt: "execute live tool path" }));

    const toolUseIndex = events.findIndex((event) => event.type === "tool_use" && event.toolName === "write");
    const toolResultIndex = events.findIndex((event) => event.type === "tool_result" && event.toolName === "write");
    const textIndex = events.findIndex((event) => event.type === "text_delta" && event.content === "applied live changes");
    expect(toolUseIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndex).toBeGreaterThan(toolUseIndex);
    expect(textIndex).toBeGreaterThan(toolResultIndex);
    expect(events.filter((event) => event.type === "tool_result" && event.toolName === "write")).toHaveLength(1);
    expect(events).toContainEqual({
      type: "file_changed",
      path: "live.txt",
      changeType: "modified",
    });
  });

  it("builds executable sessions from the canonical core builtin tool surface", async () => {
    runtimeMocks.processMessage.mockResolvedValueOnce({
      parts: [],
      toolExecutions: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      model: "gpt-5.4",
      env: { OPENAI_API_KEY: "cfg-key" },
      executionMode: "kiln-executable",
    }));

    expect(session.capabilities.supportedTools).toEqual(["mock_builtin", "operator_set_theme"]);

    await collectEvents(session.run({ prompt: "execute with canonical surface" }));

    expect(coreSurfaceMocks.createDefaultBuiltinToolSurface).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.orchestratorConstructor).toHaveBeenCalledWith(expect.objectContaining({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "mock_builtin" }),
      ]),
      capabilityMap: expect.any(Map),
      builtinTools: expect.any(Map),
    }));
  });

  it("normalizes direct-provider builtin tool executor results before runtime execution", async () => {
    coreSurfaceMocks.bridgeExecute.mockResolvedValueOnce({
      result: {
        output: "normalized builtin output",
        isError: false,
        metadata: {
          filePath: "src/demo.ts",
          source: "provider-session-test",
        },
        result: {
          output: "nested tool result should not leak",
          isError: true,
          metadata: { leaked: true },
        },
      },
      attempts: 2,
      fallbackUsed: true,
    });
    runtimeMocks.processMessage.mockResolvedValueOnce({
      parts: [],
      toolExecutions: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
    });

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      model: "gpt-5.4",
      env: { OPENAI_API_KEY: "cfg-key" },
      executionMode: "kiln-executable",
    }));

    await collectEvents(session.run({ prompt: "normalize builtin tool result" }));

    const orchestratorConfig = runtimeMocks.orchestratorConstructor.mock.calls[0]?.[0] as {
      builtinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
    };
    const builtinExecutor = orchestratorConfig.builtinTools.get("mock_builtin");
    expect(builtinExecutor).toBeDefined();

    const result = await builtinExecutor!({ filePath: "src/demo.ts" });

    expect(result).toEqual({
      output: "normalized builtin output",
      isError: false,
      metadata: {
        filePath: "src/demo.ts",
        source: "provider-session-test",
      },
    });
  });

  it("does not let explicit executable mode bypass an unsupported model profile", () => {
    const session = new ProviderSession(baseConfig({
      provider: "deepseek",
      model: "deepseek-reasoner",
      env: { DEEPSEEK_API_KEY: "cfg-key" },
      executionMode: "kiln-executable",
    }));

    expect(session.capabilities.supportedTools).toHaveLength(0);
  });

  it("derives executable mode from the resolved provider model profile", () => {
    const session = new ProviderSession(baseConfig({
      provider: "openai",
      model: "gpt-5.4",
      env: { OPENAI_API_KEY: "cfg-key" },
    }));

    expect(session.capabilities.supportedTools).toEqual(["mock_builtin", "operator_set_theme"]);
  });

  it("does not derive executable mode when no model is selected", () => {
    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
    }));

    expect(session.capabilities.supportedTools).toHaveLength(0);
  });

  it("yields error and completed when adapter streaming throws", async () => {
    const errStream = (async function* () {
      throw new Error("provider stream exploded");
    })();
    adapterMocks.openai.stream.mockReturnValue(errStream);

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
      executionMode: "text-only",
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

  it("includes credential pool exhaustion outcome and provider cause in streaming errors", async () => {
    const providerError = new Error("openrouter API error 429: free-model rate limit");
    const errStream = (async function* () {
      throw new AllCredentialsExhaustedError(providerError, { type: "rate-limited" });
    })();
    adapterMocks.openrouter.stream.mockReturnValue(errStream);

    const session = new ProviderSession(baseConfig({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      env: { OPENROUTER_API_KEY: "cfg-key" },
      executionMode: "text-only",
    }));
    const events = await collectEvents(session.run({ prompt: "error test" }));

    expect(events).toContainEqual({
      type: "error",
      code: "PROVIDER_SESSION_ERROR",
      message: "All credentials in the pool are exhausted: last outcome rate-limited; last error openrouter API error 429: free-model rate limit",
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
      executionMode: "text-only",
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
      model: "gpt-4o",
      env: { OPENAI_API_KEY: "config-key" },
      executionMode: "text-only",
    }));

    await collectEvents(session.run({
      prompt: "key precedence",
      env: { OPENAI_API_KEY: "options-key" },
    }));

    expect(adapterMocks.openai.ctor).toHaveBeenCalledWith({
      apiKey: "options-key",
      defaultModel: "gpt-4o",
    });
  });

  it("resolves API key from config.env when options.env is not set", async () => {
    delete process.env.OPENAI_API_KEY;
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      model: "gpt-4o",
      env: { OPENAI_API_KEY: "config-key" },
      executionMode: "text-only",
    }));

    await collectEvents(session.run({ prompt: "config key" }));

    expect(adapterMocks.openai.ctor).toHaveBeenCalledWith({
      apiKey: "config-key",
      defaultModel: "gpt-4o",
    });
  });

  it("resolves API key from process.env when options and config env are missing", async () => {
    process.env.OPENAI_API_KEY = "process-key";
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));

    const session = new ProviderSession(baseConfig({
      provider: "openai",
      model: "gpt-4o",
      executionMode: "text-only",
    }));

    await collectEvents(session.run({ prompt: "process key" }));

    expect(adapterMocks.openai.ctor).toHaveBeenCalledWith({
      apiKey: "process-key",
      defaultModel: "gpt-4o",
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
      executionMode: "text-only",
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

  it("appends cross-surface authority guidance into provider system prompt", async () => {
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));
    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
      executionMode: "text-only",
    }));

    await collectEvents(session.run({
      prompt: "authority prompt",
      requestedAuthority: "audited",
    }));

    const streamCall = adapterMocks.openai.stream.mock.calls[0]?.[0] as {
      system: string;
    };
    expect(streamCall.system).toContain("[KILN AUTHORITY GUIDANCE]");
    expect(streamCall.system).toContain("Authority mode: audited.");
    expect(streamCall.system).toContain("Do not ask the operator to approve work in natural language.");
    expect(streamCall.system).toContain("Only runtime approval_requested events create approval actions in CLI, TUI, and GUI surfaces.");
  });

  it("uses structured preamble prompt as system and task as user message", async () => {
    adapterMocks.openai.stream.mockReturnValue(streamEvents([{ type: "done", content: "" }]));
    const session = new ProviderSession(baseConfig({
      provider: "openai",
      env: { OPENAI_API_KEY: "cfg-key" },
      task: "Ship provider session implementation",
      systemPrompt: "legacy system prompt should not be used in preamble mode",
      constraintInstructions: ["[file-governance] DENY **/.env"],
      executionMode: "text-only",
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
      executionMode: "text-only",
    }));

    await collectEvents(session.run({ prompt: "token tracking" }));

    const tracker = (session as unknown as {
      contextTracker: { totalTokens: number };
    }).contextTracker;
    expect(tracker.totalTokens).toBe(200);
  });
});

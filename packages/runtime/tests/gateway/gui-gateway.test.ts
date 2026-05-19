import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManagedAgentCapabilitySnapshot,
  GPT4O,
  OPENCODE_BASE_URL,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  textParts,
  type ManagedAgentInvocationRequest,
  type OpenCodeAuthFile,
  type OpenCodeTier,
} from "@kilnai/core";
import type { GuiProviderDescriptor } from "@kilnai/gateway-contracts";
import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processAdmittedTurn } from "../../src/gateway/message-pipeline.js";
import { mountGuiStaticAssets, resolveGuiDistPath } from "../../src/gateway/gui-static-assets.js";
import {
  buildGuiOperatorDiscoveryResults,
  buildWelcomeProviderDescriptors,
  discoverCodexCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
  projectGuiOperatorModels,
  resolveGuiOperatorDiscoveryResults,
  resolveGuiProviderSwitch,
  type GuiCliProviderModelDiscovery,
} from "../../src/gateway/gui-provider-models.js";
import type { ManagedInvocationToolOptions } from "../../src/agents/managed-invocation/runtime-tool.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";
import { CodexOAuthCredentialPoolService } from "../../src/agents/credential-pool/codex-oauth-credential-pool.js";
import { OpenCodeCredentialPoolService } from "../../src/agents/credential-pool/opencode-credential-pool.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

const guiSocketHarness = vi.hoisted(() => {
  type HandlerFactory = Parameters<UpgradeWebSocket>[0];
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket: UpgradeWebSocket = (factory) => {
    capturedFactory = factory;
    return async (_c, next) => next();
  };

  function simulateConnection(queryParams: Record<string, string> = {}) {
    if (!capturedFactory) throw new Error("upgradeWebSocket not called yet");

    const url = new URL("http://localhost/gui/ws");
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }

    const ctx = {
      req: {
        query: (key: string) => url.searchParams.get(key) ?? undefined,
      },
    } as Parameters<HandlerFactory>[0];

    const handlers = capturedFactory(ctx);
    const mockWs = {
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    };

    return { handlers, mockWs, wsCtx: mockWs as unknown as Parameters<typeof handlers.onOpen>[1] };
  }

  function reset(): void {
    capturedFactory = null;
  }

  return {
    upgradeWebSocket,
    simulateConnection,
    reset,
  };
});

vi.mock("hono/bun", () => ({
  createBunWebSocket: () => ({
    upgradeWebSocket: guiSocketHarness.upgradeWebSocket,
    websocket: {},
  }),
}));

vi.mock("../../src/gateway/message-pipeline.js", () => ({
  processAdmittedTurn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");

  return {
    ...actual,
    execSync: vi.fn(() => ""),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
        kill: () => void;
      };

      proc.stdout = new EventEmitter();
      proc.stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
      proc.kill = () => {
        proc.emit("close");
      };

      queueMicrotask(() => {
        proc.emit("close");
      });

      return proc;
    }),
  };
});

function createGuiDist(): string {
  const distDir = mkdtempSync(join(tmpdir(), "gui-gateway-dist-"));
  mkdirSync(join(distDir, "assets"), { recursive: true });
  writeFileSync(
    join(distDir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/gui/assets/app.js\"></script></head><body><div id=\"app\">GUI Test Build</div></body></html>",
    "utf-8",
  );
  writeFileSync(join(distDir, "assets", "app.js"), "console.log('asset-ok');", "utf-8");
  return distDir;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCondition(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await flushAsyncWork();
  }
  throw new Error(message);
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gui-gateway-empty-"));
}

type GuiOperatorDiscoveryBuilderInput = Parameters<typeof buildGuiOperatorDiscoveryResults>[0];

const AVAILABLE_CANONICAL_PROVIDERS: Record<string, boolean> = {
  anthropic: true,
  openai: true,
  deepseek: true,
  openrouter: true,
  ollama: true,
  "opencode-go": true,
  "opencode-zen": true,
  "codex-oauth": true,
};

function makeGuiOperatorDiscoveryBuilderInput(
  overrides: Partial<GuiOperatorDiscoveryBuilderInput> = {},
): GuiOperatorDiscoveryBuilderInput {
  return {
    opencodeModels: [],
    codexModels: [],
    ...overrides,
  };
}

function projectGuiOperatorDiscoveryInput(input: GuiOperatorDiscoveryBuilderInput): Record<string, string[]> {
  return projectGuiOperatorModels(buildGuiOperatorDiscoveryResults(input));
}

function makeGuiOperatorDiscoveryFromModels(
  models: Readonly<Record<string, readonly string[]>>,
) {
  const directProviderDiscovery: Record<string, GuiCliProviderModelDiscovery> = Object.fromEntries(
    Object.entries(models).flatMap(([provider, providerModels]) => (
      provider === "claude" || provider === "codex" || provider === "opencode" || providerModels.length === 0
        ? []
        : [[provider, {
            models: [...providerModels],
            status: "available",
            reason: `${provider} models discovered.`,
            authState: "authenticated",
          }]]
    )),
  );
  return buildGuiOperatorDiscoveryResults({
    opencodeModels: models.opencode ?? [],
    codexModels: models.codex ?? [],
    providerAvailability: Object.fromEntries(
      Object.keys(models).map((provider) => [provider, true]),
    ),
    directProviderDiscovery,
    lastCheckedAt: "2026-04-28T12:00:00.000Z",
  });
}

function makeManagedInvocationOptions(): ManagedInvocationToolOptions {
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:opencode:harness",
      providerId: "opencode",
      adapterKind: "harness",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["cli-harness"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: { supported: true, diagnosticArtifactOnTimeout: true },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    }),
    invoke: vi.fn(async ({ request, admission }: {
      readonly request: ManagedAgentInvocationRequest;
      readonly admission: { readonly capabilitySnapshot: ReturnType<typeof buildManagedAgentCapabilitySnapshot> };
    }) =>
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        profile: request.profile,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: admission.capabilitySnapshot,
        childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
        childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        resultHandoff: {
          summary: "GUI child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
        },
      })),
  };

  return {
    routes: [{
      routeId: "opencode-readonly",
      providerId: "opencode",
      model: "openai/gpt-4o:free",
      adapter,
      surface: "cli-harness",
      profiles: {
        "foundation-readonly-plan": {
          authorityProfileId: "authority:opencode-readonly:foundation-readonly-plan",
          permissionProfile: "read-only",
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
          workingDirectory: {
            path: "C:/workspace/kiln",
            mode: "read-only",
          },
          timeoutMs: 120000,
          credentialRoute: {
            mode: "runtime-selected",
            routeId: "credential-route:opencode:runtime-selected",
          },
          memoryScope: {
            scope: { kind: "project", id: "kiln" },
            access: "read-only",
          },
        },
      },
    }],
    requestedBy: "assistant",
    requestSource: "gui",
  };
}

function projectDirectProviderDiscoveryForTest(
  directProviderDiscovery: Awaited<ReturnType<typeof discoverGuiDirectProviderModelDiscovery>>,
  providerAvailability: Readonly<Record<string, boolean>>,
): Record<string, string[]> {
  return projectGuiOperatorModels(buildGuiOperatorDiscoveryResults({
    opencodeModels: [],
    codexModels: [],
    providerAvailability,
    directProviderDiscovery,
  }));
}

function mockOpenCodeCredentialPool(
  credentialsForTier: (tier: OpenCodeTier) => readonly OpenCodeAuthFile[] = () => [],
) {
  type OpenCodePool = Awaited<ReturnType<OpenCodeCredentialPoolService["createPool"]>>;
  return vi.spyOn(OpenCodeCredentialPoolService.prototype, "createPool").mockImplementation(async (tier) => ({
    getAllCredentials: () => credentialsForTier(tier).map((auth, index) => ({
      id: `${tier}-${index}`,
      label: `${tier}-${index}`,
      providerId: "opencode",
      source: "manual",
      priority: 0,
      tier: auth.tier,
      auth,
      requestCount: 0,
      lastSuccess: null,
      lastExhausted: null,
      cooldownUntil: null,
      softLeaseCount: 0,
    })),
  }) as OpenCodePool);
}

afterEach(() => {
  guiSocketHarness.reset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("startGuiGateway static mount", () => {
  it("serves /gui/index.html and falls back to index.html for unknown /gui routes", async () => {
    const distDir = createGuiDist();
    const app = new Hono();
    app.get("/gui", (c) => c.redirect("/gui/"));
    mountGuiStaticAssets(app, distDir);

    try {
      const indexResponse = await app.request("http://localhost/gui/index.html");
      expect(indexResponse.status).toBe(200);
      const indexHtml = await indexResponse.text();
      expect(indexHtml).toContain("GUI Test Build");

      const routeResponse = await app.request("http://localhost/gui/sessions/alpha");
      expect(routeResponse.status).toBe(200);
      const routeHtml = await routeResponse.text();
      expect(routeHtml).toContain("GUI Test Build");
      expect(routeHtml).toContain("/gui/assets/app.js");

      const assetResponse = await app.request("http://localhost/gui/assets/app.js");
      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toContain("asset-ok");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("builds structured provider discovery results with unavailable reasons", () => {
    const checkedAt = "2026-04-28T12:00:00.000Z";
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: ["gpt-5.4"],
      providerAvailability: {
        claude: true,
        codex: true,
        openai: true,
        "codex-oauth": false,
      },
      lastCheckedAt: checkedAt,
    });

    expect(discovery.find((entry) => entry.provider === "claude")).toMatchObject({
      provider: "claude",
      available: true,
      models: [],
      status: "model_selection_not_required",
      reason: "Claude CLI is available. Model selection is not required.",
      authState: "not_required",
      lastCheckedAt: checkedAt,
    });
    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: true,
      models: ["gpt-5.4"],
      status: "available",
    });
    expect(discovery.find((entry) => entry.provider === "openai")).toMatchObject({
      provider: "openai",
      available: false,
      models: [],
      status: "empty_model_list",
      reason: "No models were discovered for OpenAI.",
    });
    expect(discovery.find((entry) => entry.provider === "codex-oauth")).toMatchObject({
      provider: "codex-oauth",
      available: false,
      models: [],
      status: "missing_auth",
      reason: "Codex OAuth is unavailable in this runtime.",
    });

    expect(projectGuiOperatorModels(discovery)).toEqual({
      claude: [],
      codex: ["gpt-5.4"],
    });
    expect(buildWelcomeProviderDescriptors(discovery).find((entry) => entry.id === "openai")).toMatchObject({
      id: "openai",
      available: false,
      models: [],
      status: "empty_model_list",
      reason: "No models were discovered for OpenAI.",
    });
  });

  it("uses structured discovery reasons when rejecting provider switches", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: { openai: true },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(resolveGuiProviderSwitch({
      provider: "openai",
      model: "gpt-5.4",
      discovery,
    })).toEqual({
      ok: false,
      error: "No models were discovered for OpenAI.",
    });
  });

  it("projects unhealthy direct provider model routes into structured discovery", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: { openrouter: true },
      directProviderDiscovery: {
        openrouter: {
          models: ["openrouter/free", "qwen/qwen3-coder:free"],
          modelRouteHealth: {
            "qwen/qwen3-coder:free": {
              healthy: false,
              reason: "Provider/model route 'openrouter/qwen/qwen3-coder:free' is cooling down.",
              cooldownUntil: 1_777_777_777_000,
            },
            "unused/free": {
              healthy: false,
              reason: "This model is not advertised.",
            },
          },
          status: "available",
          reason: "OpenRouter models discovered.",
          authState: "authenticated",
        },
      },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "openrouter")).toMatchObject({
      provider: "openrouter",
      available: true,
      models: ["openrouter/free", "qwen/qwen3-coder:free"],
      modelRouteHealth: {
        "qwen/qwen3-coder:free": {
          healthy: false,
          reason: "Provider/model route 'openrouter/qwen/qwen3-coder:free' is cooling down.",
          cooldownUntil: 1_777_777_777_000,
        },
      },
    });
  });

  it("uses one provider readiness wording path for switches and prompt execution", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "openai",
      model: undefined,
      models: {
        openai: ["gpt-5.4"],
      },
    });
    expect(resolution).toMatchObject({
      ok: false,
      error: "Provider 'openai' requires a selected model.",
    });
  });

  it("keeps Claude model-less when availability says it is live", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: { claude: true },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "claude")).toMatchObject({
      provider: "claude",
      available: true,
      models: [],
      status: "model_selection_not_required",
      reason: "Claude CLI is available. Model selection is not required.",
    });
    expect(projectGuiOperatorModels(discovery).claude).toEqual([]);
    expect(buildWelcomeProviderDescriptors(discovery).find((entry) => entry.id === "claude")).toMatchObject({
      id: "claude",
      models: [],
      available: true,
    });
  });

  it("does not probe Codex or OpenCode CLI models when provider availability is empty", async () => {
    vi.mocked(execSync).mockClear();
    vi.mocked(spawn).mockClear();

    const discovery = await resolveGuiOperatorDiscoveryResults({});

    expect(vi.mocked(execSync)).not.toHaveBeenCalled();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: false,
      status: "cli_missing",
    });
    expect(discovery.find((entry) => entry.provider === "opencode")).toMatchObject({
      provider: "opencode",
      available: false,
      status: "cli_missing",
    });
  });

  it("keeps Codex and OpenCode CLI model discovery active when availability admits them", async () => {
    vi.mocked(execSync).mockClear();
    vi.mocked(spawn).mockClear();

    await resolveGuiOperatorDiscoveryResults({
      codex: true,
      opencode: true,
    });

    expect(vi.mocked(execSync)).toHaveBeenCalled();
    expect(vi.mocked(spawn)).toHaveBeenCalled();
  });

  it("fails fast when an explicit GUI dist path is missing index.html", () => {
    const distDir = createTempDir();

    try {
      expect(() => resolveGuiDistPath(distDir)).toThrow("GUI bundle missing");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("starts listening before operator provider discovery resolves", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      expect(gateway.operatorModels).toEqual({});
      expect(gateway.operatorDiscovery).toEqual([]);
      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledTimes(1);
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("executes setup actions through the gateway callback", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    const executeSetupAction = vi.fn(async (action: "sync-repo-shims") => ({
      action,
      status: "applied" as const,
      message: "Repo shims synced.",
      errors: [],
      setup: {
        projectRoot: "C:/workspace/kiln",
        projectContext: {
          path: "C:/workspace/kiln/.kiln/project-context.md",
          status: "valid" as const,
          recommendation: "none" as const,
        },
        repoShims: [],
        nativeProjections: [],
        recommendedActions: ["none" as const],
      },
    }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return {
          port: port ?? 4810,
          stop,
        };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        executeSetupAction,
      });

      const response = await appFetch!(new Request("http://localhost/gui/api/config/setup/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync-repo-shims" }),
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        action: "sync-repo-shims",
        status: "applied",
      });
      expect(executeSetupAction).toHaveBeenCalledWith("sync-repo-shims");
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("exposes health with CORS for direct dev GUI polling", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let appFetch: ((request: Request) => Promise<Response>) | undefined;
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port, fetch }: { port?: number; fetch: typeof appFetch }) => {
        appFetch = fetch;
        return {
          port: port ?? 4810,
          stop,
        };
      }),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
      });

      const response = await appFetch!(new Request("http://localhost/health", {
        headers: { origin: "http://localhost:5183" },
      }));

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toMatchObject({
        status: "ok",
        channel: "gui",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("omits stale active provider/model selections from the welcome frame when they are absent from the authoritative models map", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "claude",
            setProvider: vi.fn(),
            getModel: () => "claude-sonnet-4-6",
            setModel: vi.fn(),
          },
        },
      });
      await flushAsyncWork();

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        activeProvider?: string;
        activeModel?: string;
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.activeProvider).toBeUndefined();
      expect(welcomeFrame.activeModel).toBeUndefined();
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("applies the durable operator provider preference when the session manager has no active selection", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ "codex-oauth": ["gpt-5.4"] }));
    const setProvider = vi.fn();
    const setModel = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        resolveProviderPreference: () => ({ provider: "codex-oauth", model: "gpt-5.4" }),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });
      await flushAsyncWork();

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        activeProvider?: string;
        activeModel?: string;
      };

      expect(setProvider).toHaveBeenCalledWith("codex-oauth");
      expect(setModel).toHaveBeenCalledWith("gpt-5.4");
      expect(welcomeFrame).toMatchObject({
        type: "welcome",
        activeProvider: "codex-oauth",
        activeModel: "gpt-5.4",
      });
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("omits stale active provider/model selections from the welcome frame when the authoritative provider model list is empty", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [] }));
    let activeProvider = "openai";
    let activeModel = "gpt-4o";
    const factory = vi.fn() as never;
    const setProvider = vi.fn((provider: string) => {
      activeProvider = provider;
    });
    const setModel = vi.fn((model: string) => {
      activeModel = model;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory,
            getProvider: () => activeProvider,
            setProvider,
            getModel: () => activeModel,
            setModel,
          },
        },
      });
      await waitForCondition(
        () => (gateway?.operatorDiscovery?.length ?? 0) > 0,
        "Expected GUI provider discovery to finish before authoritative welcome validation.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        activeProvider?: string;
        activeModel?: string;
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.activeProvider).toBeUndefined();
      expect(welcomeFrame.activeModel).toBeUndefined();
      expect(setModel).toHaveBeenCalledWith("");
      expect(setProvider).toHaveBeenCalledWith("");
      expect(activeProvider).toBe("");
      expect(activeModel).toBe("");
      expect(factory).not.toHaveBeenCalled();
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["blank", ""],
    ["stale", "gpt-4o-stale"],
  ])("does not fall back to providerModels[0] in the welcome frame when the stored model is %s", async (_kind, storedModel) => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let activeProvider = "openai";
    let activeModel = storedModel;
    const factory = vi.fn() as never;
    const setProvider = vi.fn((provider: string) => {
      activeProvider = provider;
    });
    const setModel = vi.fn((model: string) => {
      activeModel = model;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory,
            getProvider: () => activeProvider,
            setProvider,
            getModel: () => activeModel,
            setModel,
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models to be ready before welcome validation.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        activeProvider?: string;
        activeModel?: string;
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.activeProvider).toBeUndefined();
      expect(welcomeFrame.activeModel).toBeUndefined();
      expect(setProvider).toHaveBeenCalledWith("");
      expect(setModel).toHaveBeenCalledWith("");
      expect(activeProvider).toBe("");
      expect(activeModel).toBe("");
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects turn execution when the active provider is advertised with an empty model list", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [] }));
    const factory = vi.fn() as never;
    vi.mocked(processAdmittedTurn).mockReset();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => "gpt-4o",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string });

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual({
        type: "error",
        message: "No models were discovered for OpenAI.",
      });
      expect(processAdmittedTurn).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects turn execution with a clear error when no provider is selected", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const factory = vi.fn() as never;
    vi.mocked(processAdmittedTurn).mockReset();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string });

      expect(outboundFrames).toContainEqual({
        type: "error",
        message: "No provider selected. Choose a provider before sending a message.",
      });
      expect(processAdmittedTurn).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("admits model-less Claude turns without leaking a stale stored model", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ claude: [] }));
    const setModel = vi.fn();
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "hello" }],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "session-1",
        sessionMode: "mode-a",
        traceId: "trace-1",
      },
    } as never);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "claude",
            setProvider: vi.fn(),
            getModel: () => "stale-model",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; routedProvider?: string; routedModel?: string });

      expect(setModel).toHaveBeenCalledWith("");
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        routedProvider: "claude",
        routedModel: "",
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("omits model from model-less Claude provider switch acknowledgements", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ claude: [] }));
    const setProvider = vi.fn();
    const setModel = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "provider", provider: "claude", requestId: "request-claude" }),
        }),
        wsCtx,
      );

      expect(setProvider).toHaveBeenCalledWith("claude");
      expect(setModel).toHaveBeenCalledWith("");
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "provider_changed",
        provider: "claude",
        requestId: "request-claude",
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses the initial provider catalog when accepting a provider switch before socket welcome", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const setProvider = vi.fn();
    const setModel = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "provider", provider: "openai", model: GPT4O, requestId: "request-drift" }),
        }),
        wsCtx,
      );

      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledTimes(1);
      expect(setProvider).toHaveBeenCalledWith("openai");
      expect(setModel).toHaveBeenCalledWith(GPT4O);
      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toContainEqual({
        type: "provider_changed",
        provider: "openai",
        requestId: "request-drift",
        model: GPT4O,
      });
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses the cached ready provider catalog for provider switches instead of blocking on cold rediscovery", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ "codex-oauth": ["gpt-5.4"] }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const setProvider = vi.fn();
    const setModel = vi.fn();
    const updateProviderPreference = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        updateProviderPreference,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider",
            provider: "codex-oauth",
            model: "gpt-5.4",
            requestId: "request-codex-oauth",
          }),
        }),
        wsCtx,
      );

      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledTimes(1);
      expect(setProvider).toHaveBeenCalledWith("codex-oauth");
      expect(setModel).toHaveBeenCalledWith("gpt-5.4");
      expect(updateProviderPreference).toHaveBeenCalledWith({
        provider: "codex-oauth",
        model: "gpt-5.4",
      });
      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toContainEqual({
        type: "provider_changed",
        provider: "codex-oauth",
        requestId: "request-codex-oauth",
        model: "gpt-5.4",
      });
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("refreshes GUI provider discovery on request without reconnecting", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let openAiAvailable = false;
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockImplementation(async () => [
        {
          provider: "openai",
          available: openAiAvailable,
          models: openAiAvailable ? [GPT4O] : [],
          status: openAiAvailable ? "available" : "missing_auth",
          reason: openAiAvailable ? "OpenAI models discovered." : "OPENAI_API_KEY is missing.",
          authState: openAiAvailable ? "authenticated" : "missing",
          lastCheckedAt: openAiAvailable ? "2026-04-28T12:01:00.000Z" : "2026-04-28T12:00:00.000Z",
        },
      ]);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;
    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        getProviderAvailability: () => ({ openai: true }),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);

      openAiAvailable = true;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_providers" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "providers_refreshed",
        models: { openai: [GPT4O] },
        providers: [
          expect.objectContaining({
            id: "openai",
            available: true,
            models: [GPT4O],
          }),
        ],
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses cached provider models before admitting a turn", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }))
      .mockResolvedValueOnce(makeGuiOperatorDiscoveryFromModels({ openai: [] }));
    const factory = vi.fn() as never;
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "cached discovery admitted" }],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "session-1",
        sessionMode: "mode-a",
        traceId: "trace-1",
        routingDecision: {
          provider: "openai",
          model: GPT4O,
          routingTier: "rule",
          reasoning: "GUI route selected",
          selectionMode: "auto",
          rationale: {
            selectedProvider: "openai",
            selectedModel: GPT4O,
            selectionMode: "auto",
            routingReason: "GUI route selected",
            confidence: 1,
            routingTier: "rule",
            inputsUsed: {
              tenantId: "default",
              complexityClass: "simple",
              complexityScore: 0.2,
              hasTools: false,
              toolCount: 0,
              requiresStreaming: false,
            },
            rankingEvidence: [],
            diagnostics: [],
          },
        },
      },
    } as never);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string; routingRationale?: Record<string, unknown> });

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "cached discovery admitted",
        routingRationale: expect.objectContaining({
          selectedProvider: "openai",
          selectedModel: GPT4O,
          selectionMode: "auto",
          routingReason: "GUI route selected",
        }),
      }));
      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledTimes(1);
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("streams managed invocation session events from a GUI turn", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const session = new RuntimeSession({
        sessionId: "gui-parent-session",
        appName: "kiln-gui",
        tenantId: "gui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      session.addUserMessage(textParts("Delegate a managed read-only review."));
      await input.turnCapture?.start?.(session.id, 10);
      const managedInvoke = input.callBuiltinTools?.get("managed_agent.invoke");
      if (!managedInvoke) {
        throw new Error("managed_agent.invoke was not attached to the GUI turn surface");
      }
      expect(input.perCallConfig?.toolAllowlist?.has("managed_agent.invoke")).toBe(true);
      expect(input.perCallConfig?.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
        allowed: false,
        requiresApproval: true,
      });

      const toolResult = await managedInvoke({
        profile: "foundation-readonly-plan",
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "openai/gpt-4o:free",
        },
        task: "Inspect the managed invocation docs and report risks.",
      }, {
        session,
        toolCall: {
          id: "tool-call-managed-1",
          name: "managed_agent.invoke",
          input: {},
        },
      });
      await input.turnCapture?.finish?.(session.id);

      expect(toolResult.isError).toBe(false);
      expect(toolResult.output).toContain("GUI child review completed.");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Parent turn completed." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-gui",
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        managedInvocation: makeManagedInvocationOptions(),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "delegate from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: { kind: string; payload: Record<string, unknown> };
      });
      const sessionEventFrames = outboundFrames.filter((frame) => frame.type === "session_event");

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "Parent turn completed.",
      }));
      expect(sessionEventFrames.map((frame) => frame.event?.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        "agent_invocation_completed",
      ]);
      expect(sessionEventFrames[2]?.event?.payload).toMatchObject({
        resultSummary: "GUI child review completed.",
        managedInvocationEvidence: {
          childSessionId: expect.stringContaining("gui-parent-session:managed:"),
        },
      });
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("forwards browser session stream updates from the configured provider", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let browserSessionUpdateHandler: ((state: {
      readonly target: "browser";
      readonly status: "running" | "succeeded" | "failed";
      readonly updatedAt: string;
      readonly provider: "playwright";
      readonly sessionId: string;
      readonly ownership: "agent" | "operator" | "released";
      readonly viewMode: "snapshot" | "live";
      readonly stream: { readonly status: "starting" | "live" | "ended" | "failed" };
      readonly latestCapture?: {
        readonly uri: string;
        readonly relation: "snapshot";
        readonly mimeType: "image/png";
        readonly width?: number;
        readonly height?: number;
      };
    }) => void) | undefined;
    const browserProvider = {
      execute: vi.fn(),
      setBrowserSessionUpdateHandler: vi.fn((handler) => {
        browserSessionUpdateHandler = handler;
      }),
    };
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      await input.turnCapture?.start?.("gui-browser-session", 10);
      browserSessionUpdateHandler?.({
        target: "browser",
        status: "running",
        updatedAt: "2026-05-12T12:00:00.000Z",
        provider: "playwright",
        sessionId: "browser-live",
        ownership: "agent",
        viewMode: "live",
        stream: { status: "live" },
        latestCapture: {
          uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
          relation: "snapshot",
          mimeType: "image/png",
          width: 1280,
          height: 720,
        },
      });
      await input.turnCapture?.finish?.("gui-browser-session");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Browser stream observed." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
        },
      };
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "open the browser" }),
        }),
        wsCtx,
      );

      const browserFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; browserSession?: Record<string, unknown> })
        .find((frame) => frame.type === "browser_session_updated");
      const liveFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; [key: string]: unknown })
        .find((frame) => frame.type === "browser_live_viewport_frame");

      expect(browserProvider.setBrowserSessionUpdateHandler).toHaveBeenCalledWith(expect.any(Function));
      expect(browserFrame).toEqual({
        type: "browser_session_updated",
        browserSession: {
          target: "browser",
          status: "running",
          updatedAt: "2026-05-12T12:00:00.000Z",
          provider: "playwright",
          kilnSessionId: "gui-browser-session",
          sessionId: "browser-live",
          ownership: "agent",
          viewMode: "live",
          stream: { status: "live" },
          latestCapture: {
            uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
            relation: "snapshot",
            mimeType: "image/png",
            width: 1280,
            height: 720,
          },
        },
      });
      expect(liveFrame).toEqual({
        type: "browser_live_viewport_frame",
        sessionId: "browser-live",
        kilnSessionId: "gui-browser-session",
        frameId: "browser-live:2026-05-12T12:00:00.000Z",
        transport: "snapshot-polling",
        format: "png",
        artifactUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
        width: 1280,
        height: 720,
        capturedAt: "2026-05-12T12:00:00.000Z",
      });
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("preserves CDP screencast transport in forwarded browser live viewport frames", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let browserSessionUpdateHandler: ((state: {
      readonly target: "browser";
      readonly status: "running";
      readonly updatedAt: string;
      readonly provider: "playwright";
      readonly sessionId: string;
      readonly ownership: "operator";
      readonly viewMode: "live";
      readonly stream: { readonly status: "live" };
      readonly latestCapture: {
        readonly uri: string;
        readonly relation: "snapshot";
        readonly mimeType: "image/png";
        readonly width: number;
        readonly height: number;
        readonly transport: "cdp-screencast";
      };
    }) => void) | undefined;
    const browserProvider = {
      execute: vi.fn(),
      setBrowserSessionUpdateHandler: vi.fn((handler) => {
        browserSessionUpdateHandler = handler;
      }),
    };
    vi.mocked(processAdmittedTurn).mockImplementationOnce(async (input: {
      readonly turnCapture?: {
        readonly start: (sessionId: string, nextSequence: number) => void;
        readonly finish: (sessionId: string) => void;
      };
    }) => {
      input.turnCapture?.start("gui-browser-session", 1);
      input.turnCapture?.finish("gui-browser-session");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "watching" }],
          inputTokens: 1,
          outputTokens: 1,
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "open the browser" }),
        }),
        wsCtx,
      );

      browserSessionUpdateHandler?.({
        target: "browser",
        status: "running",
        updatedAt: "2026-05-13T12:00:00.000Z",
        provider: "playwright",
        sessionId: "browser-live",
        ownership: "operator",
        viewMode: "live",
        stream: { status: "live" },
        latestCapture: {
          uri: "kiln://artifacts/interactive-screenshots/artifact_2/content",
          relation: "snapshot",
          mimeType: "image/png",
          width: 1440,
          height: 900,
          transport: "cdp-screencast",
        },
      });

      const liveFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; [key: string]: unknown })
        .find((frame) => frame.type === "browser_live_viewport_frame" && frame.frameId === "browser-live:2026-05-13T12:00:00.000Z");

      expect(liveFrame).toMatchObject({
        type: "browser_live_viewport_frame",
        sessionId: "browser-live",
        kilnSessionId: "gui-browser-session",
        transport: "cdp-screencast",
        artifactUri: "kiln://artifacts/interactive-screenshots/artifact_2/content",
        width: 1440,
        height: 900,
      });
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("routes browser session control requests to the configured provider", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let browserSessionUpdateHandler: ((state: {
      readonly target: "browser";
      readonly status: "running";
      readonly updatedAt: string;
      readonly provider: "playwright";
      readonly sessionId: string;
      readonly ownership: "operator";
      readonly viewMode: "live";
      readonly stream: { readonly status: "paused"; readonly reason: string };
    }) => void) | undefined;
    const requestBrowserSessionControl = vi.fn(async () => {
      const state = {
        target: "browser" as const,
        status: "running" as const,
        updatedAt: "2026-05-12T12:00:00.000Z",
        provider: "playwright",
        sessionId: "browser-live",
        ownership: "operator" as const,
        viewMode: "live" as const,
        stream: {
          status: "paused" as const,
          reason: "Inspect before continuing.",
        },
      };
      browserSessionUpdateHandler?.(state);
      return state;
    });
    const browserProvider = {
      execute: vi.fn(),
      setBrowserSessionUpdateHandler: vi.fn((handler) => {
        browserSessionUpdateHandler = handler;
      }),
      requestBrowserSessionControl,
    };
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "browser_session_control",
            action: "takeover",
            sessionId: "browser-live",
            reason: "Inspect before continuing.",
            requestId: "browser-control-1",
          }),
        }),
        wsCtx,
      );

      expect(requestBrowserSessionControl).toHaveBeenCalledWith({
        action: "takeover",
        sessionId: "browser-live",
        operatorId: "operator-1",
        reason: "Inspect before continuing.",
      });
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "browser_session_updated",
        browserSession: {
          target: "browser",
          status: "running",
          updatedAt: "2026-05-12T12:00:00.000Z",
          provider: "playwright",
          sessionId: "browser-live",
          kilnSessionId: undefined,
          ownership: "operator",
          viewMode: "live",
          stream: {
            status: "paused",
            reason: "Inspect before continuing.",
          },
        },
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("routes browser operator input requests to the configured provider and forwards acknowledgements", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const requestBrowserOperatorInput = vi.fn(async () => ({
      requestId: "browser-input-1",
      sessionId: "browser-live",
      status: "accepted" as const,
      handledAt: "2026-05-13T12:00:00.000Z",
    }));
    const browserProvider = {
      execute: vi.fn(),
      requestBrowserOperatorInput,
    };
    vi.mocked(processAdmittedTurn).mockImplementationOnce(async (input: {
      readonly turnCapture?: {
        readonly start: (sessionId: string, nextSequence: number) => void;
        readonly finish: (sessionId: string) => void;
      };
    }) => {
      input.turnCapture?.start("gui-browser-session", 1);
      input.turnCapture?.finish("gui-browser-session");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "ready" }],
          inputTokens: 1,
          outputTokens: 1,
        },
      } as never;
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start browser work" }),
        }),
        wsCtx,
      );
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "browser_operator_input",
            requestId: "browser-input-1",
            sessionId: "browser-live",
            input: {
              kind: "pointer",
              phase: "down",
              x: 120,
              y: 80,
              button: "left",
            },
          }),
        }),
        wsCtx,
      );

      expect(requestBrowserOperatorInput).toHaveBeenCalledWith({
        requestId: "browser-input-1",
        sessionId: "browser-live",
        operatorId: "operator-1",
        input: {
          kind: "pointer",
          phase: "down",
          x: 120,
          y: 80,
          button: "left",
        },
      });
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "browser_operator_input_ack",
        requestId: "browser-input-1",
        sessionId: "browser-live",
        status: "accepted",
        handledAt: "2026-05-13T12:00:00.000Z",
      }));
      const evidenceFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          event?: {
            kind: string;
            kilnSessionId: string;
            payload: Record<string, unknown>;
          };
        })
        .find((frame) => frame.type === "session_event" && frame.event?.kind === "browser_operator_evidence");
      expect(evidenceFrame?.event).toMatchObject({
        kilnSessionId: "gui-browser-session",
        kind: "browser_operator_evidence",
        payload: {
          action: "operator_input",
          browserSessionId: "browser-live",
          input: {
            kind: "pointer",
            phase: "down",
          },
          acknowledgement: {
            status: "accepted",
          },
        },
      });
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["blank", ""],
    ["stale", "gpt-4o-stale"],
  ])("does not fall back to providerModels[0] in the message path when the stored model is %s", async (_kind, storedModel) => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const factory = vi.fn() as never;
    const setModel = vi.fn();
    vi.mocked(processAdmittedTurn).mockReset();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory,
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => storedModel,
            setModel,
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models to be ready before message validation.",
      );

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "hello from gui" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual({
        type: "error",
        message: storedModel
          ? `Provider 'openai' does not advertise model '${storedModel}'`
          : "Provider 'openai' requires a selected model.",
      });
      expect(setModel).not.toHaveBeenCalled();
      expect(processAdmittedTurn).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects provider switch frames without a nonblank requestId before mutating provider state", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    const setProvider = vi.fn();
    const setModel = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider,
            getModel: () => "",
            setModel,
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "provider", provider: "openai", model: GPT4O, requestId: "   " }),
        }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "error",
        message: "Provider switch requestId is required",
      }));
      expect(setProvider).not.toHaveBeenCalled();
      expect(setModel).not.toHaveBeenCalled();
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("publishes no provider descriptors in the fallback websocket welcome frame when no operator transport is available", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection();
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        providers: unknown[];
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.providers).toEqual([]);
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });


  it("reuses cached provider availability on welcome and refreshes drifted direct provider models on request", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let providerAvailability: Record<string, boolean> = { openai: true };
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: GPT4O }] }),
    })));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        getProviderAvailability: () => providerAvailability,
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models to be ready before cached welcome validation.",
      );

      expect(gateway.operatorModels?.openai).toContain(GPT4O);
      providerAvailability = { openai: false };

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      const welcomeFrame = JSON.parse(mockWs.send.mock.calls[0][0] as string) as {
        type: string;
        models: Record<string, string[]>;
        providers: GuiProviderDescriptor[];
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.models.openai).toEqual([GPT4O]);
      expect(welcomeFrame.providers.find((descriptor) => descriptor.id === "openai")).toMatchObject({
        id: "openai",
        available: true,
        models: [GPT4O],
      });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_providers" }),
        }),
        wsCtx,
      );
      const refreshFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          models?: Record<string, string[]>;
          providers?: GuiProviderDescriptor[];
        })
        .find((frame) => frame.type === "providers_refreshed");

      expect(refreshFrame?.models?.openai).toBeUndefined();
      expect(refreshFrame?.providers?.find((descriptor) => descriptor.id === "openai")).toMatchObject({
        id: "openai",
        available: false,
        models: [],
        reason: "OpenAI is unavailable in this runtime.",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses the runtime operator model resolver to advertise codex-oauth models", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({
        "codex-oauth": ["gpt-5.4-mini"],
      }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        getProviderAvailability: () => ({ "codex-oauth": true }),
        operatorTransport: {
          sessionManager: {
            factory: vi.fn() as never,
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.["codex-oauth"]?.includes("gpt-5.4-mini") ?? false,
        "Expected codex-oauth models to be advertised after background discovery.",
      );

      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledWith({ "codex-oauth": true });
      expect(gateway.operatorModels?.["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});

describe("projectGuiOperatorModels", () => {
  it("includes discovered codex-oauth subscription models from direct OAuth discovery", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      opencodeModels: ["openai/gpt-5.4-mini"],
      codexModels: ["gpt-5.4", "gpt-5.4-mini"],
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    expect(models.codex).toEqual(["gpt-5.4", "gpt-5.4-mini"]);
    expect(models.opencode).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("does not expose codex-oauth when only local Codex CLI models are discovered", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      codexModels: ["gpt-5.4"],
    }));

    expect(models.codex).toEqual(["gpt-5.4"]);
    expect(models["codex-oauth"]).toBeUndefined();
  });

  it("publishes only directly discovered codex-oauth models when direct OAuth discovery is present", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      codexModels: ["gpt-5.4"],
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    expect(models["codex-oauth"]).not.toContain("gpt-5.4");
  });

  it("uses structured codex-oauth discovery instead of local Codex CLI discovery", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: ["gpt-5.4"],
      codexDiscovery: {
        models: ["gpt-5.4"],
        status: "available",
        reason: "Codex CLI models discovered.",
        authState: "authenticated",
      },
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: true,
      models: ["gpt-5.4"],
      reason: "Codex CLI models discovered.",
    });
    expect(discovery.find((entry) => entry.provider === "codex-oauth")).toMatchObject({
      provider: "codex-oauth",
      available: true,
      models: ["gpt-5.4-mini"],
      reason: "Codex OAuth models discovered.",
    });
    expect(projectGuiOperatorModels(discovery)["codex-oauth"]).not.toContain("gpt-5.4");
  });

  it("publishes discovered direct provider models when discovery and availability agree", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        anthropic: {
          models: ["claude-sonnet-4-6"],
          status: "available",
          reason: "Anthropic models discovered.",
          authState: "authenticated",
        },
        openai: {
          models: [GPT4O],
          status: "available",
          reason: "OpenAI models discovered.",
          authState: "authenticated",
        },
        deepseek: {
          models: ["deepseek-chat"],
          status: "available",
          reason: "DeepSeek models discovered.",
          authState: "authenticated",
        },
        openrouter: {
          models: ["nvidia/nemotron-3-nano-30b-a3b:free"],
          status: "available",
          reason: "OpenRouter models discovered.",
          authState: "authenticated",
        },
        "opencode-go": {
          models: ["minimax-m2.5"],
          status: "available",
          reason: "OpenCode Go models discovered.",
          authState: "authenticated",
        },
        "opencode-zen": {
          models: ["openai/gpt-5.4"],
          status: "available",
          reason: "OpenCode Zen models discovered.",
          authState: "authenticated",
        },
        ollama: {
          models: ["ollama-local"],
          status: "available",
          reason: "Ollama models discovered.",
          authState: "not_required",
        },
      },
    }));

    expect(models.anthropic).toContain("claude-sonnet-4-6");
    expect(models.openai).toContain(GPT4O);
    expect(models.deepseek).toContain("deepseek-chat");
    expect(models.openrouter).toContain("nvidia/nemotron-3-nano-30b-a3b:free");
    expect(models["opencode-go"]).toContain("minimax-m2.5");
    expect(models["opencode-zen"]).toContain("openai/gpt-5.4");
    expect(models.ollama).toContain("ollama-local");
    expect(models.claude).toBeUndefined();
  });

  it("keeps OpenCode CLI wrapper models separate from OpenCode subscription models", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: ["opencode/wrapper-model"],
      codexModels: [],
      opencodeDiscovery: {
        models: ["opencode/wrapper-model"],
        status: "available",
        reason: "OpenCode CLI models discovered.",
        authState: "authenticated",
      },
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "opencode-go": {
          models: ["opencode/go-model"],
          status: "available",
          reason: "OpenCode Go models discovered.",
          authState: "authenticated",
        },
        "opencode-zen": {
          models: ["opencode/zen-model"],
          status: "available",
          reason: "OpenCode Zen models discovered.",
          authState: "authenticated",
        },
      },
    });

    const models = projectGuiOperatorModels(discovery);

    expect(models.opencode).toEqual(["opencode/wrapper-model"]);
    expect(models["opencode-go"]).toEqual(["opencode/go-model"]);
    expect(models["opencode-zen"]).toEqual(["opencode/zen-model"]);
    expect(models.opencode).not.toContain("opencode/go-model");
    expect(models.opencode).not.toContain("opencode/zen-model");
    expect(models["opencode-go"]).not.toContain("opencode/wrapper-model");
    expect(models["opencode-zen"]).not.toContain("opencode/wrapper-model");
  });

  it("publishes Claude as a model-less operator provider when availability says it is live", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: {
        claude: true,
      },
    }));

    expect(models.claude).toEqual([]);
  });

  it("does not expose codex-oauth when codex discovery returns no models", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        openai: {
          models: [GPT4O],
          status: "available",
          reason: "OpenAI models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models.codex).toBeUndefined();
    expect(models["codex-oauth"]).toBeUndefined();
    expect(models.openai).toContain(GPT4O);
  });
});

describe("discoverOpencodeCliModelDiscovery", () => {
  afterEach(() => {
    vi.mocked(execSync).mockReturnValue("");
  });

  it("discovers local OpenCode CLI models from the models command", async () => {
    vi.mocked(execSync).mockImplementation((command) => {
      const text = String(command);
      if (text.includes("--version")) {
        return "opencode 1.0.0";
      }
      if (text.includes(" models")) {
        return "opencode/big-pickle\nanthropic/claude-sonnet-4-6\n";
      }
      return "";
    });

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: ["opencode/big-pickle", "anthropic/claude-sonnet-4-6"],
      status: "available",
      reason: "OpenCode CLI models discovered.",
      authState: "authenticated",
    });
  });

  it("diagnoses missing OpenCode CLI executable", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("missing opencode");
    });

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "cli_missing",
      reason: "OpenCode CLI executable was not found.",
      authState: "not_required",
    });
  });

  it("diagnoses OpenCode CLI models command failure after the executable is found", async () => {
    vi.mocked(execSync).mockImplementation((command) => {
      const text = String(command);
      if (text.includes("--version")) {
        return "opencode 1.0.0";
      }
      if (text.includes(" models")) {
        throw new Error("models failed");
      }
      return "";
    });

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenCode CLI models command failed.",
      authState: "unknown",
    });
  });

  it("diagnoses an empty OpenCode CLI model list", async () => {
    vi.mocked(execSync).mockImplementation((command) => {
      const text = String(command);
      if (text.includes("--version")) {
        return "opencode 1.0.0";
      }
      if (text.includes(" models")) {
        return "\n  \n";
      }
      return "";
    });

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenCode CLI returned an empty model list.",
      authState: "unknown",
    });
  });
});

describe("discoverCodexCliModelDiscovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(execSync).mockReturnValue("");
  });

  it("initializes Codex app-server before requesting local models", async () => {
    const writes: unknown[] = [];
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          writes.push(message);
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: {
                  userAgent: "codex-test",
                  codexHome: "C:/tmp/codex",
                  platformFamily: "windows",
                  platformOs: "windows",
                },
              }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: {
                  data: [
                    { id: "gpt-5.4" },
                    { id: "gpt-5.4-mini" },
                  ],
                },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    const discovery = await discoverCodexCliModelDiscovery();

    expect(spawn).toHaveBeenCalledWith(expect.any(String), ["app-server"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    expect(writes).toEqual([
      expect.objectContaining({
        method: "initialize",
        id: 1,
      }),
      { method: "initialized" },
      expect.objectContaining({
        method: "model/list",
        id: 2,
        params: { limit: 100, includeHidden: false },
      }),
    ]);
    expect(discovery).toMatchObject({
      models: ["gpt-5.4", "gpt-5.4-mini"],
      status: "available",
      reason: "Codex CLI models discovered.",
      authState: "authenticated",
    });
  });

  it("diagnoses missing Codex CLI executable", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("missing codex");
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "cli_missing",
      reason: "Codex CLI executable was not found.",
      authState: "not_required",
    });
  });

  it("diagnoses Codex app-server timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = { write: vi.fn(() => true) };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    const discoveryPromise = discoverCodexCliModelDiscovery();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(discoveryPromise).resolves.toMatchObject({
      models: [],
      status: "endpoint_timeout",
      reason: "Codex app-server did not return models before timeout.",
      authState: "unknown",
    });
  });

  it("diagnoses Codex app-server auth failures", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result: {} }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                error: { code: -32000, message: "OpenAI authentication required" },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "Codex CLI authentication is missing or expired.",
      authState: "missing",
    });
  });

  it("diagnoses an empty Codex app-server model list", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result: {} }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: { data: [] },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Codex app-server returned an empty model list.",
      authState: "unknown",
    });
  });
});

describe("discoverGuiDirectProviderModelDiscovery", () => {
  it("discovers OpenAI chat-capable models and filters clearly incompatible model families", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.openai.com/v1/models",
      json: async () => ({
        data: [
          { id: "gpt-5.4" },
          { id: "gpt-4o-mini" },
          { id: "o3" },
          { id: "ft:gpt-4o-mini:sequel:custom:abc123" },
          { id: "text-embedding-3-large" },
          { id: "omni-moderation-latest" },
          { id: "tts-1" },
          { id: "whisper-1" },
          { id: "gpt-image-1" },
          { id: "dall-e-3" },
          { id: "gpt-realtime" },
          { id: "gpt-audio" },
          { id: "computer-use-preview" },
        ],
      }),
    }));
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { openai: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.openai).toMatchObject({
      status: "available",
      reason: "OpenAI models discovered.",
      authState: "authenticated",
    });
    expect(models.openai).toEqual([
      "gpt-5.4",
      "gpt-4o-mini",
      "o3",
      "ft:gpt-4o-mini:sequel:custom:abc123",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-openai-key" },
      }),
    );
  });

  it("diagnoses missing OpenAI API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "OPENAI_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses OpenAI model endpoint failures", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenAI model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty OpenAI model lists", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenAI model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses OpenAI lists with no usable chat models after filtering", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "text-embedding-3-large" },
          { id: "omni-moderation-latest" },
          { id: "gpt-image-1" },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenAI model endpoint returned no usable chat models.",
      authState: "unknown",
    });
  });

  it("discovers Anthropic message-capable models from the Models API", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.anthropic.com/v1/models",
      json: async () => ({
        data: [
          {
            id: "claude-opus-4-7",
            type: "model",
            max_input_tokens: 1_000_000,
            max_tokens: 128_000,
            capabilities: {
              messages: { supported: true },
            },
          },
          {
            id: "claude-sonnet-4-6",
            type: "model",
            max_input_tokens: 1_000_000,
            max_tokens: 64_000,
            capabilities: {
              messages: { supported: true },
            },
          },
          {
            id: "claude-embedding-preview",
            type: "model",
            capabilities: {
              messages: { supported: false },
            },
          },
        ],
      }),
    }));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { anthropic: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.anthropic).toMatchObject({
      status: "available",
      reason: "Anthropic models discovered.",
      authState: "authenticated",
    });
    expect(models.anthropic).toEqual([
      "claude-opus-4-7",
      "claude-sonnet-4-6",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": "test-anthropic-key",
        },
      }),
    );
  });

  it("keeps Anthropic Claude IDs when the provider omits capability metadata", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "claude-haiku-4-5-20251001", type: "model" },
          { id: "not-claude-experimental", type: "model" },
        ],
      }),
    })));

    const providerAvailability = { anthropic: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(models.anthropic).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it("diagnoses missing Anthropic API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "ANTHROPIC_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses Anthropic model endpoint failures", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "Anthropic model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty Anthropic model lists", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Anthropic model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses Anthropic lists with no message-capable models after filtering", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "claude-embedding-preview",
            type: "model",
            capabilities: {
              messages: { supported: false },
            },
          },
          {
            id: "non-claude-model",
            type: "model",
          },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Anthropic model endpoint returned no message-capable models.",
      authState: "unknown",
    });
  });

  it("discovers DeepSeek chat and reasoner models from the Models API", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.deepseek.com/models",
      json: async () => ({
        object: "list",
        data: [
          { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
          { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
          { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
          { id: "deepseek-reasoner", object: "model", owned_by: "deepseek" },
          { id: "deepseek-embedding-preview", object: "model", owned_by: "deepseek" },
          { id: "not-deepseek-chat", object: "model", owned_by: "third-party" },
        ],
      }),
    }));
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { deepseek: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.deepseek).toMatchObject({
      status: "available",
      reason: "DeepSeek models discovered.",
      authState: "authenticated",
    });
    expect(models.deepseek).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-deepseek-key" },
      }),
    );
  });

  it("diagnoses missing DeepSeek API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "DEEPSEEK_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses DeepSeek model endpoint failures", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "DeepSeek model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty DeepSeek model lists", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ object: "list", data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "DeepSeek model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses DeepSeek lists with no usable chat models after filtering", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "deepseek-embedding-preview" },
          { id: "deepseek-audio-preview" },
          { id: "not-deepseek-chat" },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "DeepSeek model endpoint returned no usable chat models.",
      authState: "unknown",
    });
  });

  it("discovers OpenRouter text chat models and filters incompatible modalities", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://openrouter.ai/api/v1/models",
      json: async () => ({
        data: [
          {
            id: "openai/gpt-4.1",
            architecture: {
              modality: "text->text",
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            supported_parameters: ["tools", "temperature"],
          },
          {
            id: "anthropic/claude-sonnet-4.5",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            context_length: 200_000,
          },
          {
            id: "openai/text-embedding-3-large",
            architecture: {
              modality: "text->embedding",
              input_modalities: ["text"],
              output_modalities: ["embedding"],
            },
          },
          {
            id: "google/gemini-image-preview",
            architecture: {
              modality: "text->image",
              input_modalities: ["text"],
              output_modalities: ["image"],
            },
          },
          {
            id: "unscoped-model",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
        ],
      }),
    }));
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { openrouter: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.openrouter).toMatchObject({
      status: "available",
      reason: "OpenRouter models discovered.",
      authState: "authenticated",
    });
    expect(models.openrouter).toEqual([
      "openai/gpt-4.1",
      "anthropic/claude-sonnet-4.5",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-openrouter-key" },
      }),
    );
  });

  it("diagnoses missing OpenRouter API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "OPENROUTER_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses OpenRouter model endpoint failures", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenRouter model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty OpenRouter model lists", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenRouter model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses OpenRouter lists with no usable text chat models after filtering", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "openai/text-embedding-3-large",
            architecture: { output_modalities: ["embedding"] },
          },
          {
            id: "google/gemini-image-preview",
            architecture: { output_modalities: ["image"] },
          },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenRouter model endpoint returned no usable text chat models.",
      authState: "unknown",
    });
  });

  it("discovers locally installed Ollama models from the daemon without remote auth", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [
          { name: "llama3.1:8b", digest: "sha256-local-a" },
          { model: "qwen2.5-coder:7b", digest: "sha256-local-b" },
          { id: "remote/library-model" },
          { name: "  " },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { ollama: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.ollama).toMatchObject({
      models: ["llama3.1:8b", "qwen2.5-coder:7b"],
      status: "available",
      reason: "Ollama models discovered.",
      authState: "not_required",
    });
    expect(models.ollama).toEqual(["llama3.1:8b", "qwen2.5-coder:7b"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("diagnoses an unreachable Ollama daemon separately from no installed models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      ollama: true,
    });

    expect(discovered.ollama).toMatchObject({
      models: [],
      status: "daemon_unreachable",
      reason: "Ollama daemon is not reachable at http://localhost:11434.",
      authState: "not_required",
    });
  });

  it("diagnoses an Ollama daemon with no installed models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      ollama: true,
    });

    expect(discovered.ollama).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Ollama daemon returned no installed models.",
      authState: "not_required",
    });
  });

  it.each([
    ["go", "opencode-go", "https://opencode.ai/zen/go/v1/models"],
    ["zen", "opencode-zen", `${OPENCODE_BASE_URL}/models`],
  ])("discovers %s tier OpenCode models from the tiered credential pool", async (tier, providerId, modelsUrl) => {
    const poolSpy = mockOpenCodeCredentialPool((requestedTier) => requestedTier === tier
      ? [{
          api_key: "test-opencode-key",
          tier: tier as "go" | "zen",
          created_at: "2026-01-01T00:00:00.000Z",
        }]
      : []);
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === modelsUrl,
      json: async () => ({ data: [{ id: "opencode/live-model" }] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        [providerId]: true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models[providerId]).toEqual(["opencode/live-model"]);
      expect(models[tier === "go" ? "opencode-zen" : "opencode-go"]).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        modelsUrl,
        expect.objectContaining({
          headers: { Authorization: "Bearer test-opencode-key" },
        }),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("uses OPENCODE_API_KEY to discover both OpenCode Go and Zen requested tiers", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        data: [
          { id: url.includes("/go/") ? "go-model" : "zen-model" },
        ],
      }),
    }));
    vi.stubEnv("OPENCODE_API_KEY", "env-opencode-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = {
      "opencode-go": true,
      "opencode-zen": true,
    };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(models["opencode-go"]).toEqual(["go-model"]);
    expect(models["opencode-zen"]).toEqual(["zen-model"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer env-opencode-key" } }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      `${OPENCODE_BASE_URL}/models`,
      expect.objectContaining({ headers: { Authorization: "Bearer env-opencode-key" } }),
    );
  });

  it("uses tiered Kiln OpenCode credential pool entries to discover Go and Zen models", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: tier === "go" ? "go-pool-key" : "zen-pool-key",
      tier,
      created_at: "2026-05-15T00:00:00.000Z",
    }]);
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        data: [
          { id: url.includes("/go/") ? "go-model" : "zen-model" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "opencode-go": true,
        "opencode-zen": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

      expect(models["opencode-go"]).toEqual(["go-model"]);
      expect(models["opencode-zen"]).toEqual(["zen-model"]);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://opencode.ai/zen/go/v1/models",
        expect.objectContaining({ headers: { Authorization: "Bearer go-pool-key" } }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        `${OPENCODE_BASE_URL}/models`,
        expect.objectContaining({ headers: { Authorization: "Bearer zen-pool-key" } }),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses missing OpenCode API credentials for requested subscription tiers", async () => {
    const poolSpy = mockOpenCodeCredentialPool();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-go": true,
        "opencode-zen": true,
      });

      expect(discovered["opencode-go"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "No OpenCode Go credential is linked.",
        authState: "missing",
      });
      expect(discovered["opencode-zen"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "No OpenCode Zen credential is linked.",
        authState: "missing",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses OpenCode subscription model endpoint failures", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: "test-opencode-key",
      tier,
      created_at: "2026-01-01T00:00:00.000Z",
    }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-go": true,
      });

      expect(discovered["opencode-go"]).toMatchObject({
        models: [],
        status: "endpoint_error",
        reason: "OpenCode Go model endpoint failed.",
        authState: "unknown",
      });
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses empty OpenCode subscription model responses", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: "test-opencode-key",
      tier,
      created_at: "2026-01-01T00:00:00.000Z",
    }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-zen": true,
      });

      expect(discovered["opencode-zen"]).toMatchObject({
        models: [],
        status: "empty_model_list",
        reason: "OpenCode Zen model endpoint returned an empty model list.",
        authState: "unknown",
      });
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("discovers codex-oauth models from live OAuth auth and the Codex models endpoint", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token" }]);
    const fetchSpy = vi.fn(async (url: string) => {
      const requestedUrl = new URL(url);
      return {
        ok: (
          requestedUrl.origin === "https://chatgpt.com"
          && requestedUrl.pathname === "/backend-api/codex/models"
          && requestedUrl.searchParams.get("client_version") === "2.0.0"
        ),
        json: async () => ({
          models: [
            {
              slug: "gpt-5.4",
              shell_type: "shell_command",
              apply_patch_tool_type: "freeform",
              supports_parallel_tool_calls: true,
              context_window: 272000,
              input_modalities: ["text", "image"],
              default_reasoning_level: "medium",
              supported_reasoning_levels: [
                { effort: "low", description: "Fast responses with lighter reasoning" },
                { effort: "medium", description: "Balances speed and reasoning depth" },
                { effort: "high", description: "Greater reasoning depth" },
              ],
            },
            {
              slug: "gpt-5.4-mini",
              shell_type: "disabled",
            },
            {
              slug: "gpt-no-functions",
              supports_tools: false,
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "codex-oauth": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models["codex-oauth"]).toEqual(["gpt-5.4", "gpt-5.4-mini", "gpt-no-functions"]);
      expect(discovered["codex-oauth"]?.modelCapabilities).toEqual({
        "gpt-5.4": {
          supportsNativeShellTools: true,
          supportsNativePatchTools: true,
          supportsParallelToolCalls: true,
          contextWindow: 272000,
          supportsVision: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high"],
        },
        "gpt-5.4-mini": {
          supportsNativeShellTools: false,
        },
        "gpt-no-functions": {
          supportsFunctionTools: false,
          supportsRuntimeTools: false,
          supportsTools: false,
        },
      });
      const discoveryResults = buildGuiOperatorDiscoveryResults({
        opencodeModels: [],
        codexModels: [],
        providerAvailability,
        directProviderDiscovery: discovered,
        lastCheckedAt: "2026-04-28T12:00:00.000Z",
      });
      expect(discoveryResults.find((entry) => entry.provider === "codex-oauth")?.modelCapabilities)
        .toEqual(discovered["codex-oauth"]?.modelCapabilities);
      const [url, options] = fetchSpy.mock.calls[0] ?? [];
      const requestedUrl = new URL(String(url));
      expect(requestedUrl.origin).toBe("https://chatgpt.com");
      expect(requestedUrl.pathname).toBe("/backend-api/codex/models");
      expect(requestedUrl.searchParams.get("client_version")).toBe("2.0.0");
      expect(options).toEqual(expect.objectContaining({
        headers: { Authorization: "Bearer test-codex-token" },
      }));
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("skips backend-invalidated codex-oauth credentials during model discovery", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([
        { credentialId: "old", accessToken: "old-invalidated-token" },
        { credentialId: "fresh", accessToken: "fresh-token" },
      ]);
    const fetchSpy = vi.fn(async (_url: string, options?: RequestInit) => {
      const authorization = (options?.headers as Record<string, string> | undefined)?.Authorization;
      if (authorization === "Bearer old-invalidated-token") {
        return {
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({
            error: {
              message: "Your authentication token has been invalidated. Please try signing in again.",
              code: "token_invalidated",
            },
          }),
        };
      }
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ models: [{ slug: "gpt-5.4" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });

      expect(discovered["codex-oauth"]).toMatchObject({
        models: ["gpt-5.4"],
        status: "available",
        authState: "authenticated",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls.map(([, options]) => (options?.headers as Record<string, string>).Authorization))
        .toEqual(["Bearer old-invalidated-token", "Bearer fresh-token"]);
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses missing codex-oauth OAuth credentials", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "Codex OAuth authentication is missing.",
        authState: "missing",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses expired codex-oauth OAuth credentials", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockRejectedValue(new Error("refresh token expired"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "auth_expired",
        reason: "Codex OAuth authentication is expired.",
        authState: "expired",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses codex-oauth model endpoint failure", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-endpoint-failure" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "endpoint_error",
        reason: "Codex OAuth model endpoint failed.",
        authState: "unknown",
      });
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses an empty codex-oauth model response", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-empty-models" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [] }),
    })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "empty_model_list",
        reason: "Codex OAuth model endpoint returned an empty model list.",
        authState: "unknown",
      });
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("reuses in-flight and cached codex-oauth model discovery", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-cache" }]);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [{ slug: "gpt-5.4" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "codex-oauth": true,
      };
      const [first, second] = await Promise.all([
        discoverGuiDirectProviderModelDiscovery(providerAvailability),
        discoverGuiDirectProviderModelDiscovery(providerAvailability),
      ]);
      const third = await discoverGuiDirectProviderModelDiscovery(providerAvailability);

      expect(projectDirectProviderDiscoveryForTest(first, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(projectDirectProviderDiscoveryForTest(second, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(projectDirectProviderDiscoveryForTest(third, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("does not expose opencode-go/opencode-zen without live OpenCode auth and /models discovery", async () => {
    const poolSpy = mockOpenCodeCredentialPool();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "opencode-go": true,
        "opencode-zen": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models["opencode-go"]).toBeUndefined();
      expect(models["opencode-zen"]).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalledWith(
        `${OPENCODE_BASE_URL}/models`,
        expect.anything(),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });
});

describe("buildWelcomeProviderDescriptors", () => {
  it("includes live modeled providers and strips stale model lists from model-less providers", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      "opencode-go": ["minimax-m2.5"],
      openai: ["gpt-5.4"],
    });

    expect(descriptors).toEqual([
      expect.objectContaining({
        id: "claude",
        models: [],
        available: true,
      }),
      expect.objectContaining({
        id: "opencode-go",
        models: ["minimax-m2.5"],
        available: true,
      }),
      expect.objectContaining({
        id: "openai",
        models: ["gpt-5.4"],
        available: true,
      }),
    ]);
  });

  it("omits metadata-only providers when they are absent from the live model map", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      "codex-oauth": ["gpt-5.4-mini"],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual([
      "claude",
      "codex-oauth",
    ]);
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-go")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-zen")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "openai")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "anthropic")).toBeUndefined();
  });

  it("omits providers whose advertised model lists are empty instead of surfacing unavailable static descriptors", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      openai: [],
      anthropic: ["claude-sonnet-4-6"],
      "opencode-go": [],
      "opencode-zen": [],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(["anthropic"]);
    expect(descriptors.find((descriptor) => descriptor.id === "openai")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-go")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-zen")).toBeUndefined();
  });

  it("includes model-less Claude as an available welcome provider descriptor", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: [],
    });

    expect(descriptors).toEqual([
      expect.objectContaining({
        id: "claude",
        available: true,
        models: [],
      }),
    ]);
  });

  it("does not expose codex-oauth when codex discovery returns no models", () => {
    const descriptors = buildWelcomeProviderDescriptors(
      projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput()),
    );

    expect(descriptors.find((descriptor) => descriptor.id === "codex-oauth")?.available ?? false).toBe(false);
  });

  it("does not expose codex or codex-oauth when codex discovery returns no models", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput());

    expect(models.codex).toBeUndefined();
    expect(models["codex-oauth"]).toBeUndefined();

    const descriptors = buildWelcomeProviderDescriptors(models);

    expect(descriptors.find((descriptor) => descriptor.id === "codex")?.available ?? false).toBe(false);
    expect(descriptors.find((descriptor) => descriptor.id === "codex-oauth")?.available ?? false).toBe(false);
  });

  it("does not expose opencode as available when discovery returns no models", () => {
    const descriptors = buildWelcomeProviderDescriptors(
      projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput()),
    );

    expect(descriptors.find((descriptor) => descriptor.id === "opencode")?.available ?? false).toBe(false);
  });

  it("does not surface unknown provider ids from the operator models map", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      unknown: ["mystery-model"],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).not.toContain("unknown");
  });
});

describe("resolveGuiProviderSwitch", () => {
  it("rejects unavailable providers", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "openai",
      model: undefined,
      models: {
        claude: ["claude-sonnet-4-6"],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected unavailable provider resolution failure");
    }
    expect(resolution.error).toContain("openai");
  });

  it("rejects providers whose advertised model list is empty", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "opencode",
      model: undefined,
      models: {
        opencode: [],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected empty-provider-model resolution failure");
    }
    expect(resolution.error).toContain("opencode");
  });

  it("accepts model-less Claude switches without requiring a fake model id", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "claude",
      model: undefined,
      models: {
        claude: [],
      },
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      throw new Error(`expected model-less Claude switch to resolve: ${resolution.error}`);
    }
    expect(resolution.modelForSessionManager).toBe("");
    expect(resolution.modelForAck).toBeUndefined();
  });

  it("rejects provider switches without an explicit model", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "anthropic",
      model: undefined,
      models: {
        anthropic: ["claude-sonnet-4-6"],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected missing model resolution failure");
    }
    expect(resolution.error).toContain("model");
  });

  it("rejects requested models that are not advertised by the selected provider", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "anthropic",
      model: "gpt-5.4",
      models: {
        anthropic: ["claude-sonnet-4-6"],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected invalid provider-model resolution failure");
    }
    expect(resolution.error).toContain("anthropic");
    expect(resolution.error).toContain("gpt-5.4");
  });

  it("rejects requested models that are cooling down", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      discovery: [{
        provider: "openrouter",
        available: true,
        models: ["openrouter/free", "qwen/qwen3-coder:free"],
        modelRouteHealth: {
          "qwen/qwen3-coder:free": {
            healthy: false,
            reason: "qwen route is temporarily rate-limited.",
          },
        },
        status: "available",
        reason: "OpenRouter models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-04-28T12:00:00.000Z",
      }],
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected cooling provider-model route resolution failure");
    }
    expect(resolution.error).toBe("qwen route is temporarily rate-limited.");
  });

  it("rejects unknown providers even when the models map contains them", () => {
    const resolution = resolveGuiProviderSwitch({
      provider: "unknown",
      model: "mystery-model",
      models: {
        unknown: ["mystery-model"],
      },
    });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      throw new Error("expected unknown provider resolution failure");
    }
    expect(resolution.error).toContain("unknown");
  });
});

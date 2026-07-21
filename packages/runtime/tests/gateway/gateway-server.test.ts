import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { UpgradeWebSocket } from "hono/ws";
import { createGatewayApp } from "../../src/gateway/gateway-routes.js";
import type { LoadedApp, GatewayServerConfig } from "../../src/gateway/gateway-routes.js";
import { createSignedArtifactMediaUrl } from "../../src/gateway/public-media-delivery.js";
import {
  assertMetaVoicePublicMediaConfig,
  discoverMcpCapabilitiesWithConfiguredToolRetry,
  evaluateProviderSubsystemHealth,
} from "../../src/gateway/gateway-server.js";
import { CredentialPoolObservabilityRegistry } from "../../src/agents/credential-pool/credential-pool-observability.js";
import { ChannelRegistry } from "../../src/channels/channel-registry.js";
import { WebChannel } from "../../src/channels/web-channel.js";
import type { WebSocketLike } from "../../src/channels/web-channel.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import type { App, EventBus, ProviderAdapter, RuntimeModeConfig, SttAdapter, TenantConfig, VoiceConfig } from "@kilnai/core";
import { CredentialPool, MemoryArtifactResourceStore, textParts } from "@kilnai/core";

const originalFetch = globalThis.fetch;

function makeApp(name: string): App {
  return {
    name,
    teams: {
      default: {
        name: "default",
        agents: { w: { name: "w", tier: "coding", tools: [] } },
        workflow: { phases: ["run"], gates: {} },
        capabilities: [],
        qualityGates: [],
      },
    },
    router: { rules: [], fallback: "default" },
    memory: { scopes: ["user"], backend: "sqlite" },
    channels: ["api"],
  };
}

function makeLoadedApp(name: string, channelType: string, path?: string): LoadedApp {
  return {
    name,
    app: makeApp(name),
    binding: {
      name,
      config: `apps/${name}.yaml`,
      channels: [{ type: channelType, ...(path ? { path } : {}) }],
    },
    registry: new ChannelRegistry(),
  };
}

function makeConfig(apps: LoadedApp[]): GatewayServerConfig {
  return { port: 4800, apps };
}

describe("gateway harness ingress composition", () => {
  it("does not expose the harness websocket route without explicit ingress configuration", async () => {
    const response = await createGatewayApp(makeConfig([])).request("http://localhost/harness/v1/ws");
    expect(response.status).toBe(404);
  });
});

function makeMockProvider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeProviderHealthApp(providerName: string): { readonly runtimeModeConfig: RuntimeModeConfig } {
  return {
    runtimeModeConfig: {
      runtime: "provider-adapter",
      provider: { name: providerName, model: "gpt-5.4-mini" },
    },
  };
}

function makeMetaAudioResponseVoiceConfig(channelType: "whatsapp" | "instagram" | "messenger"): VoiceConfig {
  return {
    stt: { provider: "openai" },
    tts: { provider: "openai", voice: "alloy" },
    policy: {
      surfaces: {
        [channelType]: {
          enabled: true,
          output: { modes: ["audio-response", "transcript-only"], failureMode: "fail-closed" },
        },
      },
    },
  };
}

function makeUpgradeWebSocket() {
  type HandlerFactory = Parameters<UpgradeWebSocket>[0];
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket: UpgradeWebSocket = (factory) => {
    capturedFactory = factory;
    return async (_c, next) => next();
  };

  function simulateConnection(queryParams: Record<string, string> = {}) {
    if (!capturedFactory) throw new Error("upgradeWebSocket not called yet");

    const url = new URL("http://localhost/ws");
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }

    const ctx = {
      req: {
        query: (key: string) => url.searchParams.get(key) ?? undefined,
      },
    } as Parameters<HandlerFactory>[0];

    const handlers = capturedFactory(ctx);
    const mockWs: WebSocketLike & { close: ReturnType<typeof vi.fn> } = {
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    };
    return { handlers, mockWs, wsCtx: mockWs as unknown as Parameters<typeof handlers.onOpen>[1] };
  }

  return { upgradeWebSocket, simulateConnection };
}

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  const now = new Date().toISOString();
  return {
    tenantId: "test-tenant",
    appName: "atendia",
    name: "Test Business",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("assertMetaVoicePublicMediaConfig", () => {
  it("fails fast when Meta audio-response lacks public media binding names", () => {
    expect(() => assertMetaVoicePublicMediaConfig({
      appName: "voice-app",
      channelType: "instagram",
      voiceConfig: makeMetaAudioResponseVoiceConfig("instagram"),
    })).toThrow("does not declare publicMediaBaseUrlEnv and publicMediaSigningSecretEnv");
  });

  it("fails fast when Meta audio-response public media env values are missing", () => {
    expect(() => assertMetaVoicePublicMediaConfig({
      appName: "voice-app",
      channelType: "messenger",
      voiceConfig: makeMetaAudioResponseVoiceConfig("messenger"),
      publicMediaBaseUrlEnv: "GATEWAY_PUBLIC_URL",
      publicMediaSigningSecretEnv: "GATEWAY_MEDIA_SIGNING_SECRET",
    })).toThrow("are not both set");
  });

  it("fails fast when Meta public media base URL is not HTTPS", () => {
    expect(() => assertMetaVoicePublicMediaConfig({
      appName: "voice-app",
      channelType: "whatsapp",
      voiceConfig: makeMetaAudioResponseVoiceConfig("whatsapp"),
      publicMediaBaseUrlEnv: "GATEWAY_PUBLIC_URL",
      publicMediaSigningSecretEnv: "GATEWAY_MEDIA_SIGNING_SECRET",
      publicMediaBaseUrl: "http://localhost:3800",
      publicMediaSigningSecret: "secret",
    })).toThrow("must be a valid HTTPS origin");
  });

  it("allows transcript-only Meta voice output without public media binding", () => {
    expect(() => assertMetaVoicePublicMediaConfig({
      appName: "voice-app",
      channelType: "instagram",
      voiceConfig: {
        stt: { provider: "openai" },
        tts: { provider: "openai", voice: "alloy" },
        policy: {
          surfaces: {
            instagram: {
              enabled: true,
              output: { modes: ["transcript-only"], failureMode: "fail-closed" },
            },
          },
        },
      },
    })).not.toThrow();
  });
});

describe("createGatewayApp", () => {
  it("returns Hono app", () => {
    const app = createGatewayApp(makeConfig([]));
    expect(app).toBeInstanceOf(Hono);
  });

  it("GET /health returns all loaded apps with status ok", async () => {
    const apps = [makeLoadedApp("app-a", "api", "/api/app-a"), makeLoadedApp("app-b", "api", "/api/app-b")];
    const app = createGatewayApp(makeConfig(apps));

    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; apps: { name: string; status: string }[] };
    expect(body.status).toBe("ok");
    expect(body.apps).toHaveLength(2);
    expect(body.apps[0]!.name).toBe("app-a");
    expect(body.apps[0]!.status).toBe("ok");
    expect(body.apps[1]!.name).toBe("app-b");
    expect(body.apps[1]!.status).toBe("ok");
  });

  it("GET /health includes channel types for each app", async () => {
    const apps = [makeLoadedApp("app-a", "api", "/api/app-a"), makeLoadedApp("app-b", "whatsapp")];
    const app = createGatewayApp(makeConfig(apps));

    const res = await app.request("/health");
    const body = (await res.json()) as { status: string; apps: { name: string; channels: string[] }[] };

    expect(body.apps[0]!.channels).toEqual(["api"]);
    expect(body.apps[1]!.channels).toEqual(["whatsapp"]);
  });

  it("serves signed public media artifact content", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-15T00:00:00.000Z" });
    artifactStore.put({
      namespace: "voice-synthesis",
      title: "Voice output",
      mimeType: "audio/mpeg",
      content: { type: "blob", blob: "AQID" },
      producer: { kind: "gateway", name: "test" },
      retention: { scope: "session" },
    });
    const loadedApp = {
      ...makeLoadedApp("voice-app", "whatsapp"),
      artifactStore,
      publicMediaSigningSecret: "secret",
    };
    const app = createGatewayApp(makeConfig([loadedApp]));
    const signedUrl = createSignedArtifactMediaUrl({
      appName: "voice-app",
      publicBaseUrl: "https://gateway.example.com",
      namespace: "voice-synthesis",
      id: "artifact_1",
      signingSecret: "secret",
    });
    const requestUrl = new URL(signedUrl);

    const res = await app.request(`${requestUrl.pathname}${requestUrl.search}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("GET /observability includes active credential pool health", async () => {
    const registry = new CredentialPoolObservabilityRegistry();
    const pool = new CredentialPool("opencode");
    pool.addCredential("go-primary", "go-primary", { apiKey: "secret" }, { tier: "go" });
    const secondPool = new CredentialPool("opencode");
    secondPool.addCredential("go-secondary", "go-secondary", { apiKey: "secret-2" }, { tier: "go" });
    registry.register("opencode-go", pool);
    registry.register("opencode-go", secondPool);
    const app = createGatewayApp({
      ...makeConfig([]),
      credentialPoolObservability: registry,
    });

    const res = await app.request("/observability");

    expect(res.status).toBe(200);
    const body = await res.json() as {
      providers: Array<{
        provider: string;
        credentialPool: { providerId: string; entries: Array<{ id: string; health: string; requestCount: number }> };
      }>;
    };
    expect(body.providers).toEqual([{
      provider: "opencode-go",
      credentialPool: {
        providerId: "opencode",
        strategy: "fill-first",
        metrics: {
          totalCredentials: 1,
          availableCount: 1,
          coolingCount: 0,
          exhaustedCount: 0,
          totalRequests: 0,
        },
        entries: [{
          id: "go-primary",
          label: "go-primary",
          source: "manual",
          priority: 0,
          tier: "go",
          health: "ok",
          requestCount: 0,
          lastSuccess: null,
          lastExhausted: null,
          cooldownUntil: null,
        }],
      },
    }, {
      provider: "opencode-go",
      credentialPool: {
        providerId: "opencode",
        strategy: "fill-first",
        metrics: {
          totalCredentials: 1,
          availableCount: 1,
          coolingCount: 0,
          exhaustedCount: 0,
          totalRequests: 0,
        },
        entries: [{
          id: "go-secondary",
          label: "go-secondary",
          source: "manual",
          priority: 0,
          tier: "go",
          health: "ok",
          requestCount: 0,
          lastSuccess: null,
          lastExhausted: null,
          cooldownUntil: null,
        }],
      },
    }]);
  });

  it("provider health uses credential pools for providers without apiKeyEnv", () => {
    const registry = new CredentialPoolObservabilityRegistry();
    const pool = new CredentialPool("codex-oauth");
    pool.addCredential("codex-primary", "codex-primary", { tokenPath: "token.json" });
    registry.register("codex-oauth", pool);

    const health = evaluateProviderSubsystemHealth([makeProviderHealthApp("codex-oauth")], registry);

    expect(health).toEqual({
      status: "ok",
      details: { "codex-oauth": "ok" },
    });
  });

  it("provider health reports pooled providers without credentials as errors", () => {
    const registry = new CredentialPoolObservabilityRegistry();
    registry.register("codex-oauth", new CredentialPool("codex-oauth"));

    const health = evaluateProviderSubsystemHealth([makeProviderHealthApp("codex-oauth")], registry);

    expect(health).toEqual({
      status: "error",
      details: { "codex-oauth": "error" },
    });
  });

  it("retries MCP discovery when configured tools are initially missing", async () => {
    const app = makeApp("artu");
    app.teams.default.agents.w.tools = ["mcp:artu-trading:tool:get_opportunity_report"];
    const discoverProviderCapabilities = vi.fn()
      .mockResolvedValueOnce([{ name: "mcp:artu-trading:tool:get_opportunity" }])
      .mockResolvedValueOnce([
        { name: "mcp:artu-trading:tool:get_opportunity" },
        { name: "mcp:artu-trading:tool:get_opportunity_report" },
      ]);

    const capabilities = await discoverMcpCapabilitiesWithConfiguredToolRetry({
      client: { discoverProviderCapabilities },
      app,
      appName: "artu",
      serverName: "artu-trading",
      attempts: 2,
      delayMs: 0,
    });

    expect(discoverProviderCapabilities).toHaveBeenCalledTimes(2);
    expect(capabilities.map((capability) => capability.name)).toContain(
      "mcp:artu-trading:tool:get_opportunity_report",
    );
  });

  it("does not make one canonical server satisfy another server's configured selectors", async () => {
    const app = makeApp("artu");
    app.teams.default.agents.w.tools = ["mcp:other-server:tool:lookup"];
    const discoverProviderCapabilities = vi.fn().mockResolvedValue([]);

    await discoverMcpCapabilitiesWithConfiguredToolRetry({
      client: { discoverProviderCapabilities },
      app,
      appName: "artu",
      serverName: "artu-trading",
      attempts: 3,
      delayMs: 0,
    });

    expect(discoverProviderCapabilities).toHaveBeenCalledTimes(1);
  });

  it("GET /observability requires gateway JWT when configured", async () => {
    const verifyJwt = vi.fn().mockResolvedValue({ sub: "operator" });
    const app = createGatewayApp({
      ...makeConfig([]),
      credentialPoolObservability: new CredentialPoolObservabilityRegistry(),
      jwtVerifier: verifyJwt,
    });

    const missing = await app.request("/observability");
    expect(missing.status).toBe(401);

    const authorized = await app.request("/observability", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(authorized.status).toBe(200);
    expect(verifyJwt).toHaveBeenCalledWith("valid-token");
  });

  it("multiple apps loaded without interference", async () => {
    const apps = [makeLoadedApp("app-a", "api", "/api/app-a"), makeLoadedApp("app-b", "api", "/api/app-b")];
    const app = createGatewayApp(makeConfig(apps));

    const resA = await app.request("/api/app-a");
    const resB = await app.request("/api/app-b");

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = (await resA.json()) as { app: string; status: string };
    const bodyB = (await resB.json()) as { app: string; status: string };

    expect(bodyA.app).toBe("app-a");
    expect(bodyB.app).toBe("app-b");
  });

  it("app with API channel binding is reachable at declared path", async () => {
    const apps = [makeLoadedApp("app-a", "api", "/api/app-a")];
    const app = createGatewayApp(makeConfig(apps));

    const res = await app.request("/api/app-a");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { app: string; status: string };
    expect(body.app).toBe("app-a");
    expect(body.status).toBe("ok");
  });

  it("app with non-api channel type has no route", async () => {
    const apps = [makeLoadedApp("app-web", "web")];
    const app = createGatewayApp(makeConfig(apps));

    // No path registered for web type -- health should still work
    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);

    // Channel type is correctly reported
    const body = (await healthRes.json()) as { apps: { name: string; channels: string[] }[] };
    expect(body.apps[0]!.channels).toEqual(["web"]);
  });

  it("serves OAuth discovery metadata when MCP is enabled", async () => {
    const app = createGatewayApp({ ...makeConfig([]), mcp: { enabled: true } });

    const authRes = await app.request("http://localhost:3800/.well-known/oauth-authorization-server");
    expect(authRes.status).toBe(200);
    expect(authRes.headers.get("content-type")).toContain("application/json");
    const authBody = await authRes.json() as {
      issuer: string;
      token_endpoint: string;
      response_types_supported: string[];
      grant_types_supported: string[];
      token_endpoint_auth_methods_supported: string[];
    };
    expect(authBody).toEqual({
      issuer: "http://localhost:3800",
      authorization_endpoint: "http://localhost:3800/oauth/authorize",
      token_endpoint: "http://localhost:3800/oauth/token",
      response_types_supported: ["code", "token"],
      grant_types_supported: ["authorization_code", "urn:ietf:params:oauth:grant-type:token-exchange"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
    });

    const resourceRes = await app.request("http://localhost:3800/.well-known/oauth-protected-resource");
    expect(resourceRes.status).toBe(200);
    expect(resourceRes.headers.get("content-type")).toContain("application/json");
    const resourceBody = await resourceRes.json() as {
      resource: string;
      authorization_servers: string[];
      bearer_methods_supported: string[];
      resource_documentation: string;
    };
    expect(resourceBody).toEqual({
      resource: "http://localhost:3800",
      authorization_servers: ["http://localhost:3800"],
      bearer_methods_supported: ["header"],
      resource_documentation: "http://localhost:3800/mcp",
    });
  });

  it("does not serve OAuth discovery metadata when MCP is disabled", async () => {
    const app = createGatewayApp(makeConfig([]));

    const authRes = await app.request("/.well-known/oauth-authorization-server");
    const resourceRes = await app.request("/.well-known/oauth-protected-resource");

    expect(authRes.status).toBe(404);
    expect(resourceRes.status).toBe(404);
  });
});

describe("createGatewayApp multi-tenant wiring", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ remaining: 50000, unit: "tokens" }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("mounts tenant routes at API path for multi-tenant app", async () => {
    const storageDir = join(tmpdir(), `kiln-test-${randomUUID()}`);
    const tenantRegistry = new TenantRegistry(storageDir);
    tenantRegistry.create(makeTenantConfig());

    const provider = makeMockProvider();
    const loadedApp: LoadedApp = {
      name: "atendia",
      app: makeApp("atendia"),
      binding: {
        name: "atendia",
        config: "apps/atendia.yaml",
        channels: [{ type: "api", path: "/api/atendia", multiTenant: true }],
      },
      registry: new ChannelRegistry(),
      tenantRuntime: {
        appName: "atendia",
        orchestrator: new RuntimeSessionOrchestrator({ provider }),
        sessionRegistry: new SessionRegistry(),
        tenantRegistry,
      },
    };

    const honoApp = createGatewayApp(makeConfig([loadedApp]));

    // POST /api/atendia/message should hit tenant routes
    const res = await honoApp.request("/api/atendia/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hola", userId: "u1", tenantId: "test-tenant" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string; tenantId: string };
    expect(body.content).toBe("mock response");
    expect(body.tenantId).toBe("test-tenant");
  });

  it("mounts WhatsApp webhook routes for multi-tenant app", async () => {
    const storageDir = join(tmpdir(), `kiln-test-${randomUUID()}`);
    const tenantRegistry = new TenantRegistry(storageDir);
    tenantRegistry.create(makeTenantConfig({ whatsappPhoneNumberId: "12345" }));

    const provider = makeMockProvider();
    const loadedApp: LoadedApp = {
      name: "atendia",
      app: makeApp("atendia"),
      binding: {
        name: "atendia",
        config: "apps/atendia.yaml",
        channels: [
          { type: "api", path: "/api/atendia", multiTenant: true },
          { type: "whatsapp", multiTenant: true, verifyTokenEnv: "WA_VERIFY" },
        ],
      },
      registry: new ChannelRegistry(),
      whatsappWebhookConfig: {
        appName: "atendia",
        orchestrator: new RuntimeSessionOrchestrator({ provider }),
        sessionRegistry: new SessionRegistry(),
        tenantRegistry,
        verifyToken: "test-verify-token",
      },
    };

    const honoApp = createGatewayApp(makeConfig([loadedApp]));

    // GET /whatsapp/atendia/webhook should verify
    const res = await honoApp.request(
      "/whatsapp/atendia/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge123",
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("challenge123");
  });

  it("mounts admin routes for multi-tenant app", async () => {
    const storageDir = join(tmpdir(), `kiln-test-${randomUUID()}`);
    const tenantRegistry = new TenantRegistry(storageDir);
    tenantRegistry.create(makeTenantConfig());

    const loadedApp: LoadedApp = {
      name: "atendia",
      app: makeApp("atendia"),
      binding: {
        name: "atendia",
        config: "apps/atendia.yaml",
        channels: [{ type: "api", path: "/api/atendia", multiTenant: true }],
      },
      registry: new ChannelRegistry(),
      tenantAdminConfig: {
        tenantRegistry,
        appName: "atendia",
      },
    };

    const honoApp = createGatewayApp(makeConfig([loadedApp]));

    // GET /admin/atendia/tenants should list tenants
    const res = await honoApp.request("/admin/atendia/tenants");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenants: TenantConfig[] };
    expect(body.tenants).toHaveLength(1);
    expect(body.tenants[0]!.tenantId).toBe("test-tenant");
  });

  it("GET /health reports multiTenant flag", async () => {
    const loadedApp: LoadedApp = {
      name: "atendia",
      app: makeApp("atendia"),
      binding: {
        name: "atendia",
        config: "apps/atendia.yaml",
        channels: [{ type: "api", path: "/api/atendia", multiTenant: true }],
      },
      registry: new ChannelRegistry(),
    };

    const honoApp = createGatewayApp(makeConfig([loadedApp]));

    const res = await honoApp.request("/health");
    const body = (await res.json()) as { apps: { name: string; multiTenant: boolean }[] };
    expect(body.apps[0]!.multiTenant).toBe(true);
  });

  it("non-multi-tenant app reports multiTenant=false", async () => {
    const loadedApp = makeLoadedApp("standard", "api", "/api/standard");
    const honoApp = createGatewayApp(makeConfig([loadedApp]));

    const res = await honoApp.request("/health");
    const body = (await res.json()) as { apps: { name: string; multiTenant: boolean }[] };
    expect(body.apps[0]!.multiTenant).toBe(false);
  });

  it("tenant routes take priority over mode-b routes", async () => {
    const storageDir = join(tmpdir(), `kiln-test-${randomUUID()}`);
    const tenantRegistry = new TenantRegistry(storageDir);
    tenantRegistry.create(makeTenantConfig());

    const provider = makeMockProvider();
    const loadedApp: LoadedApp = {
      name: "atendia",
      app: makeApp("atendia"),
      binding: {
        name: "atendia",
        config: "apps/atendia.yaml",
        channels: [{ type: "api", path: "/api/atendia", multiTenant: true }],
      },
      registry: new ChannelRegistry(),
      // Both set -- tenant should win
      tenantRuntime: {
        appName: "atendia",
        orchestrator: new RuntimeSessionOrchestrator({ provider }),
        sessionRegistry: new SessionRegistry(),
        tenantRegistry,
      },
      providerAdapterRuntime: {
        appName: "atendia",
        orchestrator: new RuntimeSessionOrchestrator({ provider }),
        sessionRegistry: new SessionRegistry(),
        billing: undefined,
        systemPrompt: "test",
      },
    };

    const honoApp = createGatewayApp(makeConfig([loadedApp]));

    // POST /message requires tenantId -- only tenant routes enforce this
    const res = await honoApp.request("/api/atendia/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", userId: "u1" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("tenantId is required");
  });

  it("projects provider-adapter WebSocket messages through the governed context seam", async () => {
    const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
    const session = {
      id: "sess-web-1",
      userContext: { plan: "enterprise" },
    };
    const sessionRegistry = {
      getOrCreate: vi.fn().mockResolvedValue(session),
    } as unknown as SessionRegistry;
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("mock response"),
        inputTokens: 1,
        outputTokens: 1,
      }),
    } as unknown as RuntimeSessionOrchestrator;
    const loadedApp: LoadedApp = {
      name: "standard",
      app: makeApp("standard"),
      binding: {
        name: "standard",
        config: "apps/standard.yaml",
        channels: [{ type: "web" }],
      },
      registry: new ChannelRegistry(),
      webChannel: new WebChannel(),
      providerAdapterRuntime: {
        appName: "standard",
        orchestrator,
        sessionRegistry,
        billing: undefined,
        systemPrompt: "test",
      },
    };

    createGatewayApp({
      ...makeConfig([loadedApp]),
      upgradeWebSocket,
    });

    const { handlers, wsCtx } = simulateConnection({ userId: "user-1" });
    await handlers.onMessage!(
      new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hello" }) }),
      wsCtx,
    );

    expect(orchestrator.processMessage).toHaveBeenCalledOnce();
    const [calledSession, parts, governedContext] = vi.mocked(orchestrator.processMessage).mock.calls[0]!;
    expect(calledSession).toBe(session);
    expect(parts).toEqual(textParts("hello"));
    expect(governedContext).toEqual(expect.objectContaining({
      content: expect.stringContaining("plan: enterprise"),
      audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
    }));
  });

  it("projects provider-adapter WebSocket coordination context through the governed seam", async () => {
    const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
    const session = {
      id: "sess-web-2",
      userContext: {},
    };
    const sessionRegistry = {
      getOrCreate: vi.fn().mockResolvedValue(session),
    } as unknown as SessionRegistry;
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("mock response"),
        inputTokens: 1,
        outputTokens: 1,
      }),
    } as unknown as RuntimeSessionOrchestrator;
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: "runtime-cross-agent-memory:adapter-handoff",
        content: "Cross-agent memory\nsummary: Adapter handoff is active.",
        score: 0.8,
      },
    ]);
    const loadedApp: LoadedApp = {
      name: "standard",
      app: makeApp("standard"),
      binding: {
        name: "standard",
        config: "apps/standard.yaml",
        channels: [{ type: "web" }],
      },
      registry: new ChannelRegistry(),
      webChannel: new WebChannel(),
      providerAdapterRuntime: {
        appName: "standard",
        orchestrator,
        sessionRegistry,
        billing: undefined,
        systemPrompt: "test",
        coordinationContextProvider,
      },
    };

    createGatewayApp({
      ...makeConfig([loadedApp]),
      upgradeWebSocket,
    });

    const { handlers, wsCtx } = simulateConnection({ userId: "user-2" });
    await handlers.onMessage!(
      new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hello" }) }),
      wsCtx,
    );

    expect(coordinationContextProvider).toHaveBeenCalledWith({
      appName: "standard",
      tenantId: "_default",
      userId: "user-2",
      sessionId: "sess-web-2",
      channel: "web",
    });
    const governedContext = vi.mocked(orchestrator.processMessage).mock.calls[0]![2];
    expect(governedContext?.content).toContain("Adapter handoff is active.");
    expect(governedContext?.audit?.blocks.find((block) => block.kind === "coordination")).toEqual(
      expect.objectContaining({
        decision: "admitted",
        source: expect.stringContaining("runtime-coordination-provider:0:adapter-handoff"),
      }),
    );
  });

  it("passes gateway event bus into tenant WebSocket audio transform routing", async () => {
    const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
    const storageDir = join(tmpdir(), `kiln-test-${randomUUID()}`);
    const tenantRegistry = new TenantRegistry(storageDir);
    tenantRegistry.create(makeTenantConfig({ widgetId: "widget-a" }));
    const sessionRegistry = new SessionRegistry();
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("mock response"),
        inputTokens: 1,
        outputTokens: 1,
      }),
    } as unknown as RuntimeSessionOrchestrator;
    const sttAdapter: SttAdapter = {
      name: "test-stt",
      transcribe: vi.fn().mockResolvedValue({ text: "transcribed audio", confidence: 0.95, durationMs: 1000 }),
    };
    const eventBus = { emit: vi.fn() } as unknown as EventBus;
    const artifactStore = new MemoryArtifactResourceStore();
    const loadedApp: LoadedApp = {
      name: "atendia",
      app: makeApp("atendia"),
      binding: {
        name: "atendia",
        config: "apps/atendia.yaml",
        channels: [{ type: "web", multiTenant: true }],
      },
      registry: new ChannelRegistry(),
      webChannel: new WebChannel(),
      sttAdapter,
      artifactStore,
      tenantRuntime: {
        appName: "atendia",
        orchestrator,
        sessionRegistry,
        tenantRegistry,
      },
    };

    createGatewayApp({
      ...makeConfig([loadedApp]),
      eventBus,
      upgradeWebSocket,
    });

    const { handlers, wsCtx } = simulateConnection({ widgetId: "widget-a", userId: "user-1" });
    await handlers.onMessage!(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "message",
          parts: [{ type: "audio", mimeType: "audio/ogg", data: "YXVkaW8=" }],
        }),
      }),
      wsCtx,
    );

    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "multimodal_routed",
      strategy: "transform",
      provider: "gateway-transform",
      model: "test-stt",
      requestedCapability: "transcription",
      artifactUris: ["kiln://artifacts/inbound-multimodal/artifact_1/content"],
    }));
    expect(artifactStore.get("inbound-multimodal", "artifact_1")).toMatchObject({
      multimodal: {
        modality: "audio",
        source: { kind: "uploaded-file", id: "atendia:test-tenant:user-1:web:part:0" },
      },
    });
    expect(orchestrator.processMessage).toHaveBeenCalledOnce();
    const [, parts] = vi.mocked(orchestrator.processMessage).mock.calls[0]!;
    expect(parts).toEqual(textParts("[Voice note transcription]: transcribed audio"));
  });
});

describe("createGatewayApp devMode", () => {
  it("does not mount /dev/ when devMode is falsy", async () => {
    const app = createGatewayApp(makeConfig([]));
    const res = await app.request("/dev/");
    expect(res.status).toBe(404);
  });

  it("mounts GET /dev/ returning HTML when devMode is true", async () => {
    const app = createGatewayApp({ ...makeConfig([]), devMode: true });
    const res = await app.request("/dev/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("Kiln Dev Inspector");
  });

  it("mounts /dev/state when devMode is true", async () => {
    const app = createGatewayApp({
      ...makeConfig([]),
      devMode: true,
      devRoutesConfig: {
        getPhaseState: () => ({ status: "running", phase: "implement" }),
      },
    });
    const res = await app.request("/dev/state");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; phase: string };
    expect(body.phase).toBe("implement");
  });

  it("does not expose /dev/state when devMode is falsy", async () => {
    const app = createGatewayApp(makeConfig([]));
    const res = await app.request("/dev/state");
    expect(res.status).toBe(404);
  });
});

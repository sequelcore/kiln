import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createGatewayApp } from "../../src/gateway/gateway-routes.js";
import type { LoadedApp, GatewayServerConfig } from "../../src/gateway/gateway-routes.js";
import { ChannelRegistry } from "../../src/channels/channel-registry.js";
import { SessionRegistry } from "../../src/session/session-registry.js";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import type { App, ProviderAdapter, TenantConfig } from "@kilnai/core";
import { textParts } from "@kilnai/core";

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
        orchestrator: new ModeBOrchestrator({ provider }),
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
        orchestrator: new ModeBOrchestrator({ provider }),
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
        orchestrator: new ModeBOrchestrator({ provider }),
        sessionRegistry: new SessionRegistry(),
        tenantRegistry,
      },
      modeBRuntime: {
        appName: "atendia",
        orchestrator: new ModeBOrchestrator({ provider }),
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

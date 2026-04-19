import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter, TenantConfig } from "@kilnai/core";
import { textParts } from "@kilnai/core";
import { createInstagramWebhookRoutes } from "../../src/gateway/instagram-webhook-routes.js";
import type { InstagramWebhookConfig } from "../../src/gateway/instagram-webhook-routes.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../../src/session/session-registry.js";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { mockedToolAuthority, mockedResolveAgentContextAsync } = vi.hoisted(() => {
  const toolAuthority = new Map([["mock_tool", {
    level: 2,
    allowed: true,
    requiresApproval: false,
    reason: "Audited execution",
  }]]);

  return {
    mockedToolAuthority: toolAuthority,
    mockedResolveAgentContextAsync: vi.fn(),
  };
});

vi.mock("../../src/tenant/agent-resolver.js", () => ({
  resolveAgentContextAsync: mockedResolveAgentContextAsync,
}));

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

interface InstagramWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    time: number;
    messaging: Array<{
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: {
        mid: string;
        text?: string;
        is_echo?: boolean;
        attachments?: Array<{
          type: string;
          payload: { url?: string };
        }>;
      };
    }>;
  }>;
}

function makeMockProvider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock ig response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeInstagramPayload(
  senderId: string,
  recipientPageId: string,
  text: string,
  options?: { isEcho?: boolean },
): InstagramWebhookPayload {
  return {
    object: "instagram",
    entry: [
      {
        id: recipientPageId,
        time: Date.now(),
        messaging: [
          {
            sender: { id: senderId },
            recipient: { id: recipientPageId },
            timestamp: Date.now(),
            message: {
              mid: "mid-123",
              text,
              is_echo: options?.isEcho,
            },
          },
        ],
      },
    ],
  };
}

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "ig-tenant",
    appName: "test-app",
    name: "Test IG Business",
    description: "An Instagram business",
    tone: "friendly",
    language: "es-MX",
    instagramPageId: "page-456",
    instagramAccessToken: "IG_ACCESS_TOKEN",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<InstagramWebhookConfig> = {}): InstagramWebhookConfig {
  const provider = makeMockProvider();
  const tmpDir = mkdtempSync(join(tmpdir(), "ig-webhook-test-"));
  const tenantRegistry = new TenantRegistry(tmpDir);
  return {
    appName: "test-app",
    orchestrator: new RuntimeSessionOrchestrator({ provider }),
    sessionRegistry: new SessionRegistry(),
    tenantRegistry,
    verifyToken: "ig-verify-token",
    ...overrides,
  };
}

describe("createInstagramWebhookRoutes", () => {
  beforeEach(() => {
    mockedResolveAgentContextAsync.mockResolvedValue({
      systemPrompt: "Mock system prompt",
      tenantToolContext: {
        callBuiltinTools: new Map(),
        toolDefinitions: [],
        capabilities: new Map(),
        toolAuthority: mockedToolAuthority,
        toolAllowlist: undefined,
        rateLimiter: undefined,
        maxToolRounds: undefined,
      },
      isHandoff: false,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recipient_id: "user-1", message_id: "mid-1" }),
    });
    process.env.IG_ACCESS_TOKEN = "test-ig-access-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("GET /webhook", () => {
    it("returns challenge on valid verification", async () => {
      const config = makeConfig();
      const app = createInstagramWebhookRoutes(config);

      const res = await app.request(
        "/webhook?hub.mode=subscribe&hub.verify_token=ig-verify-token&hub.challenge=ig-challenge-789",
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ig-challenge-789");
    });

    it("returns 403 for wrong token", async () => {
      const config = makeConfig();
      const app = createInstagramWebhookRoutes(config);

      const res = await app.request(
        "/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test",
      );

      expect(res.status).toBe(403);
    });
  });

  describe("POST /webhook", () => {
    it("processes text message and sends reply via fetch", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const app = createInstagramWebhookRoutes(config);

      const payload = makeInstagramPayload("user-sender", "page-456", "Hola Instagram");
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");

      // Wait for fire-and-forget processing
      await new Promise((r) => setTimeout(r, 50));

      // Orchestrator should have been called
      const provider = (config.orchestrator as unknown as { deps: { provider: ProviderAdapter } }).deps.provider;
      expect(provider.createMessage).toHaveBeenCalledTimes(1);

      // fetch should have been called to send Instagram reply
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain("/page-456/messages");
      const fetchBody = JSON.parse(fetchCall[1]?.body as string);
      expect(fetchBody.recipient.id).toBe("user-sender");
      expect(fetchBody.message.text).toBe("mock ig response");
    });

    it("filters echo messages", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const app = createInstagramWebhookRoutes(config);

      const payload = makeInstagramPayload("user-sender", "page-456", "Echo test", { isEcho: true });
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      const provider = (config.orchestrator as unknown as { deps: { provider: ProviderAdapter } }).deps.provider;
      expect(provider.createMessage).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("ignores non-instagram object", async () => {
      const config = makeConfig();
      const app = createInstagramWebhookRoutes(config);

      const payload = { object: "page", entry: [] };
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
    });

    it("silently ignores unknown page ID", async () => {
      const config = makeConfig();
      const app = createInstagramWebhookRoutes(config);

      const payload = makeInstagramPayload("user-1", "unknown-page", "Hello");
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      const provider = (config.orchestrator as unknown as { deps: { provider: ProviderAdapter } }).deps.provider;
      expect(provider.createMessage).not.toHaveBeenCalled();
    });

    it("returns 200 for empty payload", async () => {
      const config = makeConfig();
      const app = createInstagramWebhookRoutes(config);

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: "instagram" }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 200 for malformed JSON", async () => {
      const config = makeConfig();
      const app = createInstagramWebhookRoutes(config);

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-valid-json",
      });

      expect(res.status).toBe(200);
    });

    it("emits events when emitter is configured", async () => {
      const emitFn = vi.fn();
      const config = makeConfig({
        eventEmitter: { emit: emitFn } as unknown as InstagramWebhookConfig["eventEmitter"],
      });
      config.tenantRegistry.create(makeTenantConfig());
      const app = createInstagramWebhookRoutes(config);

      const payload = makeInstagramPayload("user-sender", "page-456", "Hola");
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should emit MESSAGE_RECEIVED and MESSAGE_SENT
      const received = emitFn.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, string>).eventType === "MESSAGE_RECEIVED",
      );
      expect(received).toBeDefined();
      expect(received![0].channel).toBe("instagram");

      const sent = emitFn.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, string>).eventType === "MESSAGE_SENT",
      );
      expect(sent).toBeDefined();
      expect(sent![0].channel).toBe("instagram");
    });

    it("forwards tenant tool authority into per-call config", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const processSpy = vi.spyOn(config.orchestrator, "processMessage");
      const app = createInstagramWebhookRoutes(config);

      const payload = makeInstagramPayload("user-sender", "page-456", "Authority check");
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(processSpy).toHaveBeenCalledTimes(1);
      const perCallConfig = processSpy.mock.calls[0]![4];
      expect(perCallConfig?.toolAuthority).toBe(mockedToolAuthority);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter, TenantConfig } from "@kilnai/core";
import { MemoryArtifactResourceStore, textParts } from "@kilnai/core";
import { createMessengerWebhookRoutes } from "../../src/gateway/messenger-webhook-routes.js";
import type { MessengerWebhookConfig } from "../../src/gateway/messenger-webhook-routes.js";
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

interface MessengerWebhookPayload {
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
      parts: textParts("mock messenger response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeMessengerPayload(
  senderId: string,
  recipientPageId: string,
  text: string,
  options?: { isEcho?: boolean },
): MessengerWebhookPayload {
  return {
    object: "page",
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
              mid: "mid-456",
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
    tenantId: "msg-tenant",
    appName: "test-app",
    name: "Test Messenger Business",
    description: "A Messenger business",
    tone: "friendly",
    language: "es-MX",
    messengerPageId: "fb-page-789",
    messengerAccessToken: "MSG_ACCESS_TOKEN",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<MessengerWebhookConfig> = {}): MessengerWebhookConfig {
  const provider = makeMockProvider();
  const tmpDir = mkdtempSync(join(tmpdir(), "msg-webhook-test-"));
  const tenantRegistry = new TenantRegistry(tmpDir);
  return {
    appName: "test-app",
    orchestrator: new RuntimeSessionOrchestrator({ provider }),
    sessionRegistry: new SessionRegistry(),
    tenantRegistry,
    verifyToken: "msg-verify-token",
    ...overrides,
  };
}

describe("createMessengerWebhookRoutes", () => {
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
      json: () => Promise.resolve({ recipient_id: "psid-1", message_id: "mid-1" }),
    });
    process.env.MSG_ACCESS_TOKEN = "test-msg-access-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("GET /webhook", () => {
    it("returns challenge on valid verification", async () => {
      const config = makeConfig();
      const app = createMessengerWebhookRoutes(config);

      const res = await app.request(
        "/webhook?hub.mode=subscribe&hub.verify_token=msg-verify-token&hub.challenge=msg-challenge-999",
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("msg-challenge-999");
    });

    it("returns 403 for wrong token", async () => {
      const config = makeConfig();
      const app = createMessengerWebhookRoutes(config);

      const res = await app.request(
        "/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test",
      );

      expect(res.status).toBe(403);
    });
  });

  describe("POST /webhook", () => {
    it("processes text message and sends reply", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const app = createMessengerWebhookRoutes(config);

      const payload = makeMessengerPayload("psid-sender", "fb-page-789", "Hello Messenger");
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");

      await new Promise((r) => setTimeout(r, 50));

      const provider = (config.orchestrator as unknown as { deps: { provider: ProviderAdapter } }).deps.provider;
      expect(provider.createMessage).toHaveBeenCalledTimes(1);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain("/me/messages");
      const fetchBody = JSON.parse(fetchCall[1]?.body as string);
      expect(fetchBody.messaging_type).toBe("RESPONSE");
      expect(fetchBody.recipient.id).toBe("psid-sender");
      expect(fetchBody.message.text).toBe("mock messenger response");
    });

    it("filters echo messages", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const app = createMessengerWebhookRoutes(config);

      const payload = makeMessengerPayload("psid-sender", "fb-page-789", "Echo", { isEcho: true });
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

    it("ignores non-page object", async () => {
      const config = makeConfig();
      const app = createMessengerWebhookRoutes(config);

      const payload = { object: "instagram", entry: [] };
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
    });

    it("silently ignores unknown page ID", async () => {
      const config = makeConfig();
      const app = createMessengerWebhookRoutes(config);

      const payload = makeMessengerPayload("psid-1", "unknown-page", "Hello");
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
      const app = createMessengerWebhookRoutes(config);

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: "page" }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 200 for malformed JSON", async () => {
      const config = makeConfig();
      const app = createMessengerWebhookRoutes(config);

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
        eventEmitter: { emit: emitFn } as unknown as MessengerWebhookConfig["eventEmitter"],
      });
      config.tenantRegistry.create(makeTenantConfig());
      const app = createMessengerWebhookRoutes(config);

      const payload = makeMessengerPayload("psid-sender", "fb-page-789", "Hola");
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      const received = emitFn.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, string>).eventType === "MESSAGE_RECEIVED",
      );
      expect(received).toBeDefined();
      expect(received![0].channel).toBe("messenger");

      const sent = emitFn.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, string>).eventType === "MESSAGE_SENT",
      );
      expect(sent).toBeDefined();
      expect(sent![0].channel).toBe("messenger");
    });

    it("forwards tenant tool authority into per-call config", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const processSpy = vi.spyOn(config.orchestrator, "processMessage");
      const app = createMessengerWebhookRoutes(config);

      const payload = makeMessengerPayload("psid-sender", "fb-page-789", "Authority check");
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(processSpy).toHaveBeenCalledTimes(1);
      const governedContext = processSpy.mock.calls[0]![2];
      expect(governedContext).toEqual(expect.objectContaining({
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }));
      const perCallConfig = processSpy.mock.calls[0]![4];
      expect(perCallConfig?.toolAuthority).toBe(mockedToolAuthority);
    });

    it("captures Messenger attachments as replay artifacts before provider invocation", async () => {
      const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
      const config = makeConfig({ artifactStore });
      config.tenantRegistry.create(makeTenantConfig());
      const processSpy = vi.spyOn(config.orchestrator, "processMessage");
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://cdn.example.test/msg-image.jpg") {
          return new Response(new Uint8Array([7, 8, 9]), {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          });
        }
        return new Response(JSON.stringify({ recipient_id: "psid-sender", message_id: "mid-reply" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const app = createMessengerWebhookRoutes(config);
      const payload: MessengerWebhookPayload = {
        object: "page",
        entry: [{
          id: "fb-page-789",
          time: Date.now(),
          messaging: [{
            sender: { id: "psid-sender" },
            recipient: { id: "fb-page-789" },
            timestamp: Date.now(),
            message: {
              mid: "mid-image",
              attachments: [{
                type: "image",
                payload: { url: "https://cdn.example.test/msg-image.jpg" },
              }],
            },
          }],
        }],
      };

      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processSpy.mock.calls[0]![1]).toEqual([{
        type: "image",
        mimeType: "image/jpeg",
        url: "https://cdn.example.test/msg-image.jpg",
        artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
      }]);
      expect(artifactStore.get("inbound-multimodal", "artifact_1")).toMatchObject({
        content: { type: "blob", blob: Buffer.from(new Uint8Array([7, 8, 9])).toString("base64") },
        multimodal: {
          modality: "image",
          source: { kind: "webhook-attachment", id: "test-app:msg-tenant:psid-sender:messenger:part:0" },
        },
      });
    });
  });
});

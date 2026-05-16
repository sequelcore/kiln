import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter, TenantConfig, TtsAdapter, VoiceConfig } from "@kilnai/core";
import { MemoryArtifactResourceStore, textParts } from "@kilnai/core";
import { createWhatsAppWebhookRoutes } from "../../src/gateway/whatsapp-webhook-routes.js";
import type { WhatsAppWebhookConfig } from "../../src/gateway/whatsapp-webhook-routes.js";
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

interface MetaWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata?: { phone_number_id?: string };
        messages?: Array<{
          from: string;
          type: string;
          text?: { body: string };
          image?: { id: string; mime_type: string; caption?: string };
        }>;
      };
    }>;
  }>;
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

function makeWebhookPayload(phoneNumberId: string, from: string, text: string): MetaWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              messages: [{ from, type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "test-tenant",
    appName: "test-app",
    name: "Test Business",
    description: "A test business",
    tone: "friendly",
    language: "es-MX",
    whatsappPhoneNumberId: "phone-123",
    whatsappAccessToken: "WA_ACCESS_TOKEN",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<WhatsAppWebhookConfig> = {}): WhatsAppWebhookConfig {
  const provider = makeMockProvider();
  const tmpDir = mkdtempSync(join(tmpdir(), "wa-webhook-test-"));
  const tenantRegistry = new TenantRegistry(tmpDir);
  return {
    appName: "test-app",
    orchestrator: new RuntimeSessionOrchestrator({ provider }),
    sessionRegistry: new SessionRegistry(),
    tenantRegistry,
    verifyToken: "my-verify-token",
    ...overrides,
  };
}

async function waitForMockFetchCall(
  predicate: (url: string) => boolean,
  timeoutMs = 500,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock?.calls ?? [];
    if (calls.some((call) => predicate(String(call[0])))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected mocked fetch call was not observed before timeout.");
}

describe("createWhatsAppWebhookRoutes", () => {
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
      json: () => Promise.resolve({}),
    });
    process.env.WA_ACCESS_TOKEN = "test-access-token-value";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("GET /webhook", () => {
    it("returns challenge on valid verification", async () => {
      const config = makeConfig();
      const app = createWhatsAppWebhookRoutes(config);

      const res = await app.request(
        "/webhook?hub.mode=subscribe&hub.verify_token=my-verify-token&hub.challenge=challenge-123",
      );

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("challenge-123");
    });

    it("returns 403 for wrong token", async () => {
      const config = makeConfig();
      const app = createWhatsAppWebhookRoutes(config);

      const res = await app.request(
        "/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-123",
      );

      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).toBe("Forbidden");
    });

    it("returns 403 for missing mode", async () => {
      const config = makeConfig();
      const app = createWhatsAppWebhookRoutes(config);

      const res = await app.request(
        "/webhook?hub.verify_token=my-verify-token&hub.challenge=challenge-123",
      );

      expect(res.status).toBe(403);
    });
  });

  describe("POST /webhook", () => {
    it("processes text message and sends reply via fetch", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const app = createWhatsAppWebhookRoutes(config);

      const payload = makeWebhookPayload("phone-123", "+5211234567", "Hola");
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");

      // Wait for fire-and-forget processing
      await new Promise((r) => setTimeout(r, 50));

      // Orchestrator should have been called (provider.createMessage)
      const provider = (config.orchestrator as unknown as { deps: { provider: ProviderAdapter } }).deps.provider;
      expect(provider.createMessage).toHaveBeenCalledTimes(1);

      // fetch should have been called to send WhatsApp reply
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toBe("https://graph.facebook.com/v21.0/phone-123/messages");
      const fetchBody = JSON.parse(fetchCall[1]?.body as string);
      expect(fetchBody.messaging_product).toBe("whatsapp");
      expect(fetchBody.to).toBe("+5211234567");
      expect(fetchBody.text.body).toBe("mock response");
    });

    it("synthesizes configured WhatsApp voice output and sends public audio media", async () => {
      const voiceConfig: VoiceConfig = {
        stt: { provider: "openai" },
        tts: { provider: "openai", voice: "alloy" },
        policy: {
          artifacts: { storeSynthesizedAudio: true },
          surfaces: {
            whatsapp: {
              enabled: true,
              output: { modes: ["audio-response", "transcript-only"], failureMode: "fail-closed" },
            },
          },
        },
      };
      const ttsAdapter: TtsAdapter = {
        name: "test-tts",
        synthesize: vi.fn().mockResolvedValue({
          audio: new Uint8Array([1, 2, 3]),
          mimeType: "audio/mpeg",
          durationMs: 1200,
        }),
      };
      const outboundMediaPublisher = {
        publish: vi.fn().mockResolvedValue({
          url: "https://media.example.com/test-app/voice-synthesis/artifact_1.mp3",
          mimeType: "audio/mpeg",
          artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content",
        }),
      };
      const config = makeConfig({
        artifactStore: new MemoryArtifactResourceStore(),
        voiceConfig,
        ttsAdapter,
        outboundMediaPublisher,
      });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "wamid.voice" }] }),
      });
      config.tenantRegistry.create(makeTenantConfig());
      const app = createWhatsAppWebhookRoutes(config);

      const payload = makeWebhookPayload("phone-123", "+5211234567", "Hola");
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      await waitForMockFetchCall((url) => url.includes("/phone-123/messages"), 1_000);

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      await vi.waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(2));
      const textBody = JSON.parse(fetchCalls[0]![1]?.body as string);
      const audioBody = JSON.parse(fetchCalls[1]![1]?.body as string);

      expect(ttsAdapter.synthesize).toHaveBeenCalledWith("mock response", { voice: "alloy" });
      expect(outboundMediaPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({
        channel: "whatsapp",
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "+5211234567",
        mimeType: "audio/mpeg",
        artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content",
        purpose: "assistant-output",
      }));
      expect(textBody.type).toBe("text");
      expect(textBody.text.body).toBe("mock response");
      expect(audioBody.type).toBe("audio");
      expect(audioBody.audio.link).toBe("https://media.example.com/test-app/voice-synthesis/artifact_1.mp3");
    });

    it("silently ignores unknown phone number", async () => {
      const config = makeConfig();
      // No tenant registered for this phone number
      const app = createWhatsAppWebhookRoutes(config);

      const payload = makeWebhookPayload("unknown-phone", "+5211234567", "Hola");
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      // No orchestrator or fetch calls
      const provider = (config.orchestrator as unknown as { deps: { provider: ProviderAdapter } }).deps.provider;
      expect(provider.createMessage).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns 200 immediately", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const app = createWhatsAppWebhookRoutes(config);

      const payload = makeWebhookPayload("phone-123", "+5211234567", "Hola");
      const start = Date.now();
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const elapsed = Date.now() - start;

      expect(res.status).toBe(200);
      // Response should be near-instant (fire-and-forget)
      expect(elapsed).toBeLessThan(100);
      await waitForMockFetchCall((url) => url === "https://graph.facebook.com/v21.0/phone-123/messages");
    });

    it("ignores disabled tenant messages", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig({ tenantId: "disabled-tenant", enabled: false }));
      // resolveByPhone checks enabled === true, so disabled tenant won't match
      const app = createWhatsAppWebhookRoutes(config);

      const payload = makeWebhookPayload("phone-123", "+5211234567", "Hola");
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

    it("ignores non-text message types", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const app = createWhatsAppWebhookRoutes(config);

      const payload: MetaWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-1",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: "phone-123" },
                  messages: [{ from: "+5211234567", type: "image" }],
                },
              },
            ],
          },
        ],
      };

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
      const app = createWhatsAppWebhookRoutes(config);

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: "whatsapp_business_account" }),
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");
    });

    it("returns 200 for malformed payload", async () => {
      const config = makeConfig();
      const app = createWhatsAppWebhookRoutes(config);

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-valid-json",
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");
    });

    it("forwards tenant tool authority into per-call config", async () => {
      const config = makeConfig();
      config.tenantRegistry.create(makeTenantConfig());
      const processSpy = vi.spyOn(config.orchestrator, "processMessage");
      const app = createWhatsAppWebhookRoutes(config);

      const payload = makeWebhookPayload("phone-123", "+5211234567", "Authority check");
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

    it("captures WhatsApp media as replay artifacts before provider invocation", async () => {
      const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
      const config = makeConfig({ artifactStore });
      config.tenantRegistry.create(makeTenantConfig());
      const processSpy = vi.spyOn(config.orchestrator, "processMessage");
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/media-image-1")) {
          return new Response(JSON.stringify({
            url: "https://media.example.test/wa-image.jpg",
            mime_type: "image/jpeg",
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "https://media.example.test/wa-image.jpg") {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          });
        }
        return new Response(JSON.stringify({ messages: [{ id: "wamid.reply" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const app = createWhatsAppWebhookRoutes(config);
      const payload = {
        object: "whatsapp_business_account",
        entry: [{
          id: "entry-1",
          changes: [{
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "phone-123" },
              messages: [{
                from: "+5211234567",
                type: "image",
                image: { id: "media-image-1", mime_type: "image/jpeg" },
              }],
            },
          }],
        }],
      } as MetaWebhookPayload;

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
        url: "https://graph.facebook.com/v21.0/media-image-1",
        artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
      }]);
      expect(artifactStore.get("inbound-multimodal", "artifact_1")).toMatchObject({
        content: { type: "blob", blob: Buffer.from(new Uint8Array([1, 2, 3])).toString("base64") },
        multimodal: {
          modality: "image",
          source: { kind: "webhook-attachment", id: "test-app:test-tenant:+5211234567:whatsapp:part:0" },
        },
      });
    });
  });

  describe("smb_message_echoes (coexistence)", () => {
    function makeCoexistencePayload(phoneNumberId: string, toCustomer: string, text: string, msgId = "wamid.echo1") {
      return {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-1",
            changes: [
              {
                field: "smb_message_echoes",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: phoneNumberId },
                  messages: [
                    { id: msgId, from: phoneNumberId, to: toCustomer, type: "text", text: { body: text } },
                  ],
                },
              },
            ],
          },
        ],
      };
    }

    it("ignores smb_message_echoes when coexistence is disabled", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig(); // no whatsappCoexistence
      config.tenantRegistry.create(tenant);

      const app = createWhatsAppWebhookRoutes(config);
      const payload = makeCoexistencePayload("phone-123", "521234567890", "I'll handle this");

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
    });

    it("transitions session to human_active on smb_message_echoes", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig({ whatsappCoexistence: { enabled: true } });
      config.tenantRegistry.create(tenant);

      // Pre-create a session for the customer
      const session = await config.sessionRegistry.getOrCreate({
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "521234567890",
        systemPrompt: "You are a test assistant.",
      });
      expect(session.sessionMode).toBe("ai_active");

      const app = createWhatsAppWebhookRoutes(config);
      const payload = makeCoexistencePayload("phone-123", "521234567890", "I'll handle this personally");

      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 50));

      const updatedSession = await config.sessionRegistry.get("test-app", "521234567890", "test-tenant");
      expect(updatedSession?.sessionMode).toBe("human_active");
      expect(updatedSession?.lastHumanMessageAt).toBeTypeOf("number");
    });

    it("injects operator message into session history", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig({ whatsappCoexistence: { enabled: true } });
      config.tenantRegistry.create(tenant);

      const session = await config.sessionRegistry.getOrCreate({
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "521234567890",
        systemPrompt: "You are a test assistant.",
      });

      const app = createWhatsAppWebhookRoutes(config);
      const payload = makeCoexistencePayload("phone-123", "521234567890", "Let me check on that");

      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      const updatedSession = await config.sessionRegistry.get("test-app", "521234567890", "test-tenant");
      const lastMsg = updatedSession?.conversationHistory[updatedSession.conversationHistory.length - 1];
      expect(lastMsg?.role).toBe("assistant");
    });

    it("emits HUMAN_TAKEOVER event", async () => {
      const emitFn = vi.fn();
      const config = makeConfig({ eventEmitter: { emit: emitFn } as any });
      const tenant = makeTenantConfig({ whatsappCoexistence: { enabled: true } });
      config.tenantRegistry.create(tenant);

      await config.sessionRegistry.getOrCreate({
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "521234567890",
        systemPrompt: "You are a test assistant.",
      });

      const app = createWhatsAppWebhookRoutes(config);
      const payload = makeCoexistencePayload("phone-123", "521234567890", "Taking over");

      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      const takeoverEvent = emitFn.mock.calls.find((c: any) => c[0]?.eventType === "HUMAN_TAKEOVER");
      expect(takeoverEvent).toBeDefined();
      expect(takeoverEvent![0].handoffSource).toBe("whatsapp_coexistence");
      expect(takeoverEvent![0].sessionMode).toBe("human_active");
      expect(takeoverEvent![0].channel).toBe("whatsapp");
    });

    it("does not transition when no session exists", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig({ whatsappCoexistence: { enabled: true } });
      config.tenantRegistry.create(tenant);

      const app = createWhatsAppWebhookRoutes(config);
      const payload = makeCoexistencePayload("phone-123", "999999999", "Hello");

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
    });

    it("updates timestamp when already human_active", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig({ whatsappCoexistence: { enabled: true } });
      config.tenantRegistry.create(tenant);

      const session = await config.sessionRegistry.getOrCreate({
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "521234567890",
        systemPrompt: "You are a test assistant.",
      });
      session.setSessionMode("human_active");
      session.recordHumanMessage();
      const firstTimestamp = session.lastHumanMessageAt;
      await config.sessionRegistry.save(session);

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      const app = createWhatsAppWebhookRoutes(config);
      const payload = makeCoexistencePayload("phone-123", "521234567890", "Follow up");

      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      const updatedSession = await config.sessionRegistry.get("test-app", "521234567890", "test-tenant");
      expect(updatedSession?.lastHumanMessageAt).toBeGreaterThan(firstTimestamp!);
    });

    it("auto-releases to ai_active after idle timeout", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig({
        whatsappCoexistence: { enabled: true, autoReleaseMs: 1 }, // 1ms for testing
      });
      config.tenantRegistry.create(tenant);

      // Create session and simulate human takeover
      const session = await config.sessionRegistry.getOrCreate({
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "521234567890",
        systemPrompt: "You are a test assistant.",
      });
      session.setSessionMode("human_active");
      (session as any)._lastHumanMessageAt = Date.now() - 100; // 100ms ago
      await config.sessionRegistry.save(session);

      const app = createWhatsAppWebhookRoutes(config);

      // Customer sends a new message -- should trigger auto-release
      const payload = makeWebhookPayload("phone-123", "521234567890", "Are you still there?");
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 100));

      const updatedSession = await config.sessionRegistry.get("test-app", "521234567890", "test-tenant");
      expect(updatedSession?.sessionMode).toBe("ai_active");
    });

    it("stays human_active when idle timeout not yet reached", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig({
        whatsappCoexistence: { enabled: true, autoReleaseMs: 999_999 }, // very long
      });
      config.tenantRegistry.create(tenant);

      const session = await config.sessionRegistry.getOrCreate({
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "521234567890",
        systemPrompt: "You are a test assistant.",
      });
      session.setSessionMode("human_active");
      session.recordHumanMessage(); // just now
      await config.sessionRegistry.save(session);

      const app = createWhatsAppWebhookRoutes(config);
      const payload = makeWebhookPayload("phone-123", "521234567890", "Hello?");

      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 50));

      // Session should still be human_active -- message gets queued
      const updatedSession = await config.sessionRegistry.get("test-app", "521234567890", "test-tenant");
      expect(updatedSession?.sessionMode).toBe("human_active");
    });

    it("emits HANDOFF_RELEASED on auto-release", async () => {
      const emitFn = vi.fn();
      const config = makeConfig({ eventEmitter: { emit: emitFn } as any });
      const tenant = makeTenantConfig({
        whatsappCoexistence: { enabled: true, autoReleaseMs: 1 },
      });
      config.tenantRegistry.create(tenant);

      const session = await config.sessionRegistry.getOrCreate({
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "521234567890",
        systemPrompt: "You are a test assistant.",
      });
      session.setSessionMode("human_active");
      (session as any)._lastHumanMessageAt = Date.now() - 100;
      await config.sessionRegistry.save(session);

      const app = createWhatsAppWebhookRoutes(config);
      const payload = makeWebhookPayload("phone-123", "521234567890", "Back again");

      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 100));

      const releaseEvent = emitFn.mock.calls.find((c: any) => c[0]?.eventType === "HANDOFF_RELEASED");
      expect(releaseEvent).toBeDefined();
      expect(releaseEvent![0].handoffSource).toBe("whatsapp_coexistence");
      expect(releaseEvent![0].sessionMode).toBe("ai_active");
    });
  });
});

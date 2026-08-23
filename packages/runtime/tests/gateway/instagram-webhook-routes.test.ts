import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import {
  type TenantConfig,
  textParts,
  type TtsAdapter,
  type VoiceConfig,
} from "@kilnai/core/engine";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import { createInstagramWebhookRoutes } from "../../src/gateway/instagram-webhook-routes.js";
import type { InstagramWebhookConfig } from "../../src/gateway/instagram-webhook-routes.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { makeGatewayTestAdmission } from "./gateway-test-admission.js";
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
  const orchestrator = new RuntimeSessionOrchestrator({ provider, model: provider.name });
  orchestrator.bindProvider = vi.fn().mockReturnValue(orchestrator);
  const tmpDir = mkdtempSync(join(tmpdir(), "ig-webhook-test-"));
  const tenantRegistry = new TenantRegistry(tmpDir);
  const sessionRegistry = new SessionRegistry();
  return {
    appName: "test-app",
    orchestrator,
    sessionRegistry,
    tenantRegistry,
    gatewayAdmission: makeGatewayTestAdmission(sessionRegistry, provider),
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
        executionEnvelope: undefined,
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

    it("synthesizes configured Instagram voice output and sends public audio media", async () => {
      const voiceConfig: VoiceConfig = {
        stt: { provider: "openai" },
        tts: { provider: "openai", voice: "alloy" },
        policy: {
          artifacts: { storeSynthesizedAudio: true },
          surfaces: {
            instagram: {
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
      const config = makeConfig({
        artifactStore: new MemoryArtifactResourceStore(),
        voiceConfig,
        ttsAdapter,
        publicMedia: {
          appName: "test-app",
          publicBaseUrl: "https://media.example.com",
          signingSecret: "secret",
          now: () => 0,
          ttlMs: 300_000,
        },
      });
      config.tenantRegistry.create(makeTenantConfig());
      const app = createInstagramWebhookRoutes(config);

      const payload = makeInstagramPayload("user-sender", "page-456", "Hola Instagram");
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const textBody = JSON.parse(fetchCalls[0]![1]?.body as string);
      const audioBody = JSON.parse(fetchCalls[1]![1]?.body as string);

      expect(ttsAdapter.synthesize).toHaveBeenCalledWith("mock ig response", { voice: "alloy" });
      expect(textBody.message.text).toBe("mock ig response");
      expect(audioBody.message.attachment.type).toBe("audio");
      expect(audioBody.message.attachment.payload.url).toMatch(/^https:\/\/media\.example\.com\/media\/test-app\/voice-synthesis\/artifact_1\/content\?expires=300000&sig=/u);
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


    it("uses the model-only admitted tool authority instead of tenant hints", async () => {
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
      const governedContext = processSpy.mock.calls[0]![2];
      expect(governedContext).toEqual(expect.objectContaining({
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }));
      const perCallConfig = processSpy.mock.calls[0]![4];
      expect(perCallConfig?.authorityAdmission).toMatchObject({
        turn: { authority: { admittedAuthority: "fail_closed" } },
      });
    });

    it("captures Instagram attachments as replay artifacts before provider invocation", async () => {
      const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
      const config = makeConfig({ artifactStore });
      config.tenantRegistry.create(makeTenantConfig());
      const processSpy = vi.spyOn(config.orchestrator, "processMessage");
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://cdn.example.test/ig-image.jpg") {
          return new Response(new Uint8Array([4, 5, 6]), {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          });
        }
        return new Response(JSON.stringify({ recipient_id: "user-sender", message_id: "mid-reply" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const app = createInstagramWebhookRoutes(config);
      const payload: InstagramWebhookPayload = {
        object: "instagram",
        entry: [{
          id: "page-456",
          time: Date.now(),
          messaging: [{
            sender: { id: "user-sender" },
            recipient: { id: "page-456" },
            timestamp: Date.now(),
            message: {
              mid: "mid-image",
              attachments: [{
                type: "image",
                payload: { url: "https://cdn.example.test/ig-image.jpg" },
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
        url: "https://cdn.example.test/ig-image.jpg",
        artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
      }]);
      expect(artifactStore.get("inbound-multimodal", "artifact_1")).toMatchObject({
        content: { type: "blob", blob: Buffer.from(new Uint8Array([4, 5, 6])).toString("base64") },
        multimodal: {
          modality: "image",
          source: { kind: "webhook-attachment", id: "test-app:ig-tenant:user-sender:instagram:part:0" },
        },
      });
    });
  });
});

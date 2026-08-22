import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import {
  type TenantConfig,
  textParts,
  type TtsAdapter,
  type VoiceConfig,
} from "@kilnai/core/engine";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import { createMessengerWebhookRoutes } from "../../src/gateway/messenger-webhook-routes.js";
import type { MessengerWebhookConfig } from "../../src/gateway/messenger-webhook-routes.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { makeGatewayTestAdmission } from "./gateway-test-admission.js";
import type { GatewayAuthorityAdmissionPort } from "../../src/gateway/gateway-authority-admission.js";
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

function withAdmissionFenceObservation(
  config: MessengerWebhookConfig,
  state: { active: boolean; outboundWhileActive: boolean },
): void {
  const base = config.gatewayAdmission;
  config.gatewayAdmission = {
    async execute<Result>(request, dispatch) {
      return base.execute(request, async (commit) => {
        state.active = true;
        try {
          return await dispatch(commit);
        } finally {
          state.active = false;
        }
      });
    },
  } satisfies GatewayAuthorityAdmissionPort;
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
  const orchestrator = new RuntimeSessionOrchestrator({ provider, model: provider.name });
  orchestrator.bindProvider = vi.fn().mockReturnValue(orchestrator);
  const tmpDir = mkdtempSync(join(tmpdir(), "msg-webhook-test-"));
  const tenantRegistry = new TenantRegistry(tmpDir);
  const sessionRegistry = new SessionRegistry();
  return {
    appName: "test-app",
    orchestrator,
    sessionRegistry,
    tenantRegistry,
    gatewayAdmission: makeGatewayTestAdmission(sessionRegistry, provider),
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
        executionEnvelope: undefined,
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

    it("keeps outbound delivery inside the admission fence and sends nothing on rejection", async () => {
      const state = { active: false, outboundWhileActive: false };
      const config = makeConfig();
      withAdmissionFenceObservation(config, state);
      config.tenantRegistry.create(makeTenantConfig());
      globalThis.fetch = vi.fn(async () => {
        state.outboundWhileActive ||= state.active;
        return new Response(JSON.stringify({ recipient_id: "psid-sender", message_id: "mid-reply" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
      await createMessengerWebhookRoutes(config).request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeMessengerPayload("psid-sender", "fb-page-789", "Fence me")),
      });
      await vi.waitFor(() => expect(state.outboundWhileActive).toBe(true));

      const rejectedConfig = makeConfig({
        gatewayAdmission: {
          async execute<Result>() {
            throw new Error("admission rejected");
          },
        } satisfies GatewayAuthorityAdmissionPort,
      });
      rejectedConfig.tenantRegistry.create(makeTenantConfig());
      const rejectedFetch = vi.fn(async () => new Response("unexpected", { status: 500 }));
      globalThis.fetch = rejectedFetch as typeof fetch;
      await createMessengerWebhookRoutes(rejectedConfig).request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeMessengerPayload("psid-sender", "fb-page-789", "Reject me")),
      });
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(rejectedFetch).not.toHaveBeenCalled();
    });

    it("synthesizes configured Messenger voice output and sends public audio media", async () => {
      const voiceConfig: VoiceConfig = {
        stt: { provider: "openai" },
        tts: { provider: "openai", voice: "alloy" },
        policy: {
          artifacts: { storeSynthesizedAudio: true },
          surfaces: {
            messenger: {
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
      config.tenantRegistry.create(makeTenantConfig());
      const app = createMessengerWebhookRoutes(config);

      const payload = makeMessengerPayload("psid-sender", "fb-page-789", "Hello Messenger");
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

      expect(ttsAdapter.synthesize).toHaveBeenCalledWith("mock messenger response", { voice: "alloy" });
      expect(outboundMediaPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({
        channel: "messenger",
        appName: "test-app",
        tenantId: "msg-tenant",
        userId: "psid-sender",
        mimeType: "audio/mpeg",
        artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content",
        purpose: "assistant-output",
      }));
      expect(textBody.message.text).toBe("mock messenger response");
      expect(audioBody.message.attachment.type).toBe("audio");
      expect(audioBody.message.attachment.payload.url).toBe("https://media.example.com/test-app/voice-synthesis/artifact_1.mp3");
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

    it("uses the model-only admitted tool authority instead of tenant hints", async () => {
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
      expect(perCallConfig?.toolAuthority).toEqual(new Map());
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

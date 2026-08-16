import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHandoffRoutes } from "../../src/gateway/handoff-routes.js";
import type { HandoffRoutesConfig } from "../../src/gateway/handoff-routes.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import type { WebChannel } from "../../src/channels/web-channel.js";
import type { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";
import type { ConversationEvent } from "@kilnai/core/engine";

// Mock sendWhatsAppMessage
vi.mock("../../src/channels/whatsapp-api.js", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }))),
}));

import { sendWhatsAppMessage } from "../../src/channels/whatsapp-api.js";

const ADMIN_TOKEN = "test-admin-token";
const APP_NAME = "test-app";
const TENANT_ID = "tenant-1";
const USER_ID = "user-1";

function makeSessionConfig(overrides: Record<string, unknown> = {}) {
  return {
    appName: APP_NAME,
    tenantId: TENANT_ID,
    userId: USER_ID,
    systemPrompt: "You are a helpful assistant.",
    ...overrides,
  };
}

function mockTenantRegistry(overrides: Record<string, unknown> = {}): TenantRegistry {
  return {
    get: vi.fn().mockReturnValue({
      tenantId: TENANT_ID,
      appName: APP_NAME,
      whatsappPhoneNumberId: "1234567890",
      whatsappAccessToken: "wa-token-abc",
      enabled: true,
      ...overrides,
    }),
  } as unknown as TenantRegistry;
}

function mockWebChannel(): WebChannel {
  return {
    sendToUser: vi.fn(),
  } as unknown as WebChannel;
}

function mockEventEmitter(): ConversationEventEmitter & { events: ConversationEvent[] } {
  const events: ConversationEvent[] = [];
  return {
    events,
    emit: vi.fn((event: ConversationEvent) => {
      events.push(event);
    }),
  } as unknown as ConversationEventEmitter & { events: ConversationEvent[] };
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  };
}

describe("createHandoffRoutes", () => {
  let sessionRegistry: SessionRegistry;
  let tenantRegistry: TenantRegistry;
  let webChannel: WebChannel;
  let eventEmitter: ReturnType<typeof mockEventEmitter>;
  let config: HandoffRoutesConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionRegistry = new SessionRegistry();
    tenantRegistry = mockTenantRegistry();
    webChannel = mockWebChannel();
    eventEmitter = mockEventEmitter();
    config = {
      sessionRegistry,
      tenantRegistry,
      appName: APP_NAME,
      adminToken: ADMIN_TOKEN,
      webChannel,
      eventEmitter,
    };
  });

  describe("admin token enforcement", () => {
    it("returns 401 without token when adminToken configured", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID, targetMode: "queued" }),
      });
      expect(res.status).toBe(401);
    });

    it("no auth required when adminToken not configured", async () => {
      const noAuthConfig = { ...config, adminToken: undefined };
      const app = createHandoffRoutes(noAuthConfig);
      // Even though session won't exist, we get 404 not 401
      const res = await app.request("/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID, targetMode: "queued" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /handoff", () => {
    it("returns 400 for missing required fields", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/handoff", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Missing required fields");
    });

    it("returns 404 when session not found", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/handoff", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID, userId: "nonexistent", targetMode: "queued" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 for invalid transition (ai_active -> resolved)", async () => {
      await sessionRegistry.getOrCreate(makeSessionConfig());
      const app = createHandoffRoutes(config);

      // ai_active -> resolved is not a valid transition
      const res = await app.request("/handoff", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID, targetMode: "resolved" as string }),
      });
      // targetMode only allows "queued" | "human_active" in the type, but runtime validation
      // happens via setSessionMode which rejects invalid transitions
      expect(res.status).toBe(409);
    });

    it("successfully transitions to queued from ai_active", async () => {
      await sessionRegistry.getOrCreate(makeSessionConfig());
      const app = createHandoffRoutes(config);

      const res = await app.request("/handoff", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID, targetMode: "queued", reason: "Customer needs help" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; previousMode: string; newMode: string };
      expect(body.success).toBe(true);
      expect(body.previousMode).toBe("ai_active");
      expect(body.newMode).toBe("queued");
    });

    it("successfully transitions to human_active from ai_active", async () => {
      await sessionRegistry.getOrCreate(makeSessionConfig());
      const app = createHandoffRoutes(config);

      const res = await app.request("/handoff", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID, targetMode: "human_active" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; previousMode: string; newMode: string };
      expect(body.success).toBe(true);
      expect(body.previousMode).toBe("ai_active");
      expect(body.newMode).toBe("human_active");
    });

    it("emits HANDOFF_INITIATED event", async () => {
      await sessionRegistry.getOrCreate(makeSessionConfig());
      const app = createHandoffRoutes(config);

      await app.request("/handoff", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          targetMode: "queued",
          operatorId: "op-1",
          reason: "User requested human",
        }),
      });

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      const emitted = eventEmitter.events[0]!;
      expect(emitted.eventType).toBe("HANDOFF_INITIATED");
      expect(emitted.tenantId).toBe(TENANT_ID);
      expect(emitted.externalUserId).toBe(USER_ID);
      expect(emitted.operatorId).toBe("op-1");
      expect(emitted.escalationReason).toBe("User requested human");
    });
  });

  describe("POST /release", () => {
    it("returns 400 for missing required fields", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/release", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 when session not found", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/release", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID, userId: "nonexistent" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 for invalid transition (ai_active -> ai_active)", async () => {
      await sessionRegistry.getOrCreate(makeSessionConfig());
      const app = createHandoffRoutes(config);

      // ai_active -> ai_active is not valid
      const res = await app.request("/release", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID }),
      });
      expect(res.status).toBe(409);
    });

    it("successfully releases from human_active to ai_active", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("human_active");
      const app = createHandoffRoutes(config);

      const res = await app.request("/release", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; previousMode: string; newMode: string };
      expect(body.success).toBe(true);
      expect(body.previousMode).toBe("human_active");
      expect(body.newMode).toBe("ai_active");
    });

    it("injects context summary into session history when provided", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("human_active");
      const app = createHandoffRoutes(config);

      await app.request("/release", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          contextSummary: "Customer wanted appointment rescheduled to Friday.",
        }),
      });

      const history = session.conversationHistory;
      const lastMessage = history[history.length - 1]!;
      expect(lastMessage.role).toBe("user");
      expect(lastMessage.parts[0]).toEqual({ type: "text", text: "[Handoff context] Customer wanted appointment rescheduled to Friday." });
    });

    it("emits HANDOFF_RELEASED event", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("human_active");
      const app = createHandoffRoutes(config);

      await app.request("/release", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          contextSummary: "Resolved billing question.",
        }),
      });

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      const emitted = eventEmitter.events[0]!;
      expect(emitted.eventType).toBe("HANDOFF_RELEASED");
      expect(emitted.sessionMode).toBe("ai_active");
      expect(emitted.summary).toBe("Resolved billing question.");
    });
  });

  describe("POST /operator-message", () => {
    it("returns 400 for missing required fields", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Missing required fields");
    });

    it("returns 404 when session not found", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: "nonexistent",
          message: "Hello",
          channel: "web",
        }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 when session is ai_active", async () => {
      await sessionRegistry.getOrCreate(makeSessionConfig());
      const app = createHandoffRoutes(config);

      const res = await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          message: "Hello",
          channel: "web",
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("ai_active");
    });

    it("returns 409 when session is resolved", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("human_active");
      session.setSessionMode("resolved");
      const app = createHandoffRoutes(config);

      const res = await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          message: "Hello",
          channel: "web",
        }),
      });
      expect(res.status).toBe(409);
    });

    it("successfully sends via web channel and injects into history", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("human_active");
      const app = createHandoffRoutes(config);

      const res = await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          message: "Your appointment is confirmed for Friday.",
          channel: "web",
          operatorId: "op-1",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; delivered: boolean };
      expect(body.success).toBe(true);
      expect(body.delivered).toBe(true);

      // Check session history
      const history = session.conversationHistory;
      const lastMessage = history[history.length - 1]!;
      expect(lastMessage.role).toBe("assistant");
      expect(lastMessage.parts[0]).toEqual({
        type: "text",
        text: "Your appointment is confirmed for Friday.",
      });

      // Check web channel was called
      expect(webChannel.sendToUser).toHaveBeenCalledWith(
        USER_ID,
        expect.stringContaining("Your appointment is confirmed for Friday."),
      );
    });

    it("successfully sends via whatsapp channel", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("human_active");
      const app = createHandoffRoutes(config);

      const res = await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          message: "We confirmed your booking.",
          channel: "whatsapp",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; delivered: boolean };
      expect(body.delivered).toBe(true);

      expect(sendWhatsAppMessage).toHaveBeenCalledWith(
        "1234567890",
        "wa-token-abc",
        USER_ID,
        { type: "text", text: { body: "We confirmed your booking." } },
      );
    });

    it("returns 422 when tenant has no WhatsApp credentials", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("human_active");

      const noWaConfig = {
        ...config,
        tenantRegistry: mockTenantRegistry({ whatsappPhoneNumberId: undefined, whatsappAccessToken: undefined }),
      };
      const app = createHandoffRoutes(noWaConfig);

      const res = await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          message: "Hello",
          channel: "whatsapp",
        }),
      });
      expect(res.status).toBe(422);
    });

    it("sends in queued mode", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("queued");
      const app = createHandoffRoutes(config);

      const res = await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          message: "Please hold.",
          channel: "web",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it("emits OPERATOR_MESSAGE_SENT event", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.setSessionMode("human_active");
      const app = createHandoffRoutes(config);

      await app.request("/operator-message", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tenantId: TENANT_ID,
          userId: USER_ID,
          message: "All set!",
          channel: "web",
          operatorId: "op-2",
        }),
      });

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      const emitted = eventEmitter.events[0]!;
      expect(emitted.eventType).toBe("OPERATOR_MESSAGE_SENT");
      expect(emitted.channel).toBe("web");
      expect(emitted.messageContent).toBe("All set!");
      expect(emitted.operatorId).toBe("op-2");
    });
  });

  describe("GET /session-history", () => {
    it("returns 400 for missing query params", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/session-history", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 when session not found", async () => {
      const app = createHandoffRoutes(config);
      const res = await app.request("/session-history?tenantId=x&userId=y", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(404);
    });

    it("returns session history with correct fields", async () => {
      const session = await sessionRegistry.getOrCreate(makeSessionConfig());
      session.addUserMessage([{ type: "text", text: "Hello" }]);
      session.addAssistantMessage([{ type: "text", text: "Hi there!" }]);
      const app = createHandoffRoutes(config);

      const res = await app.request(
        `/session-history?tenantId=${TENANT_ID}&userId=${USER_ID}`,
        { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sessionId: string;
        mode: string;
        messageCount: number;
        history: Array<{ role: string; parts: Array<{ type: string; text: string }> }>;
        createdAt: string;
        lastActivityAt: string;
      };
      expect(body.sessionId).toBeDefined();
      expect(body.mode).toBe("ai_active");
      expect(body.messageCount).toBe(2);
      expect(body.history).toHaveLength(2);
      expect(body.history[0]!.role).toBe("user");
      expect(body.history[0]!.parts[0]!.text).toBe("Hello");
      expect(body.history[1]!.role).toBe("assistant");
      expect(body.history[1]!.parts[0]!.text).toBe("Hi there!");
      expect(body.createdAt).toBeDefined();
      expect(body.lastActivityAt).toBeDefined();
    });
  });
});

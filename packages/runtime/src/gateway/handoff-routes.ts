// Gateway: Handoff routes -- Hono sub-app for operator message injection and session mode transitions
// Enables human-in-the-loop workflows: escalate to human, send operator messages, release back to AI

import { Hono } from "hono";
import { KilnError, textParts } from "@kilnai/core";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import type { WebChannel } from "../channels/web-channel.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import { sendWhatsAppMessage } from "../channels/whatsapp-api.js";
import { requireBearer } from "./auth-middleware.js";
import { TraceContext } from "./trace-context.js";

export interface HandoffRoutesConfig {
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly appName: string;
  readonly adminToken?: string;
  readonly webChannel?: WebChannel;
  readonly eventEmitter?: ConversationEventEmitter;
}

interface HandoffRequest {
  readonly tenantId: string;
  readonly userId: string;
  readonly targetMode: "queued" | "human_active";
  readonly operatorId?: string;
  readonly reason?: string;
}

interface ReleaseRequest {
  readonly tenantId: string;
  readonly userId: string;
  readonly contextSummary?: string;
}

interface OperatorMessageRequest {
  readonly tenantId: string;
  readonly userId: string;
  readonly message: string;
  readonly channel: "whatsapp" | "web";
  readonly operatorId?: string;
}

export function createHandoffRoutes(config: HandoffRoutesConfig): Hono {
  const app = new Hono();

  if (config.adminToken) {
    app.use("*", requireBearer(config.adminToken));
  }

  // POST /handoff -- Initiate handoff (transition to queued or human_active)
  app.post("/handoff", async (c) => {
    const trace = new TraceContext();

    let body: HandoffRequest;
    try {
      body = await c.req.json<HandoffRequest>();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    if (!body.tenantId || !body.userId || !body.targetMode) {
      return c.json({ success: false, error: "Missing required fields: tenantId, userId, targetMode" }, 400);
    }

    trace.log("handoff", "Initiating handoff", { tenantId: body.tenantId, userId: body.userId, targetMode: body.targetMode });

    const session = await config.sessionRegistry.get(config.appName, body.userId, body.tenantId);
    if (!session) {
      return c.json({ success: false, error: "Session not found" }, 404);
    }

    const previousMode = session.sessionMode;

    try {
      session.setSessionMode(body.targetMode);
    } catch (err) {
      if (err instanceof KilnError && err.code === "INVALID_SESSION_TRANSITION") {
        return c.json({ success: false, error: err.message }, 409);
      }
      throw err;
    }

    if (config.eventEmitter && session.tenantId) {
      config.eventEmitter.emit({
        eventType: "HANDOFF_INITIATED",
        tenantId: session.tenantId,
        channel: "api",
        externalUserId: body.userId,
        sessionMode: session.sessionMode,
        escalationReason: body.reason,
        operatorId: body.operatorId,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    trace.log("handoff", "Handoff complete", { sessionId: session.id, previousMode, newMode: session.sessionMode });

    return c.json({
      success: true,
      sessionId: session.id,
      previousMode,
      newMode: session.sessionMode,
    });
  });

  // POST /release -- Release session back to AI
  app.post("/release", async (c) => {
    const trace = new TraceContext();

    let body: ReleaseRequest;
    try {
      body = await c.req.json<ReleaseRequest>();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    if (!body.tenantId || !body.userId) {
      return c.json({ success: false, error: "Missing required fields: tenantId, userId" }, 400);
    }

    trace.log("handoff", "Releasing session to AI", { tenantId: body.tenantId, userId: body.userId });

    const session = await config.sessionRegistry.get(config.appName, body.userId, body.tenantId);
    if (!session) {
      return c.json({ success: false, error: "Session not found" }, 404);
    }

    const previousMode = session.sessionMode;

    try {
      session.setSessionMode("ai_active");
    } catch (err) {
      if (err instanceof KilnError && err.code === "INVALID_SESSION_TRANSITION") {
        return c.json({ success: false, error: err.message }, 409);
      }
      throw err;
    }

    if (body.contextSummary) {
      session.addUserMessage(textParts("[System] Handoff context: " + body.contextSummary));
    }

    if (config.eventEmitter && session.tenantId) {
      config.eventEmitter.emit({
        eventType: "HANDOFF_RELEASED",
        tenantId: session.tenantId,
        channel: "api",
        externalUserId: body.userId,
        sessionMode: "ai_active",
        summary: body.contextSummary,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    trace.log("handoff", "Release complete", { sessionId: session.id, previousMode });

    return c.json({
      success: true,
      sessionId: session.id,
      previousMode,
      newMode: "ai_active",
    });
  });

  // POST /operator-message -- Send human-authored message to end user
  app.post("/operator-message", async (c) => {
    const trace = new TraceContext();

    let body: OperatorMessageRequest;
    try {
      body = await c.req.json<OperatorMessageRequest>();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    if (!body.tenantId || !body.userId || !body.message || !body.channel) {
      return c.json(
        { success: false, error: "Missing required fields: tenantId, userId, message, channel" },
        400,
      );
    }

    trace.log("handoff", "Sending operator message", { tenantId: body.tenantId, userId: body.userId, channel: body.channel });

    const session = await config.sessionRegistry.get(config.appName, body.userId, body.tenantId);
    if (!session) {
      return c.json({ success: false, error: "Session not found" }, 404);
    }

    if (session.sessionMode === "ai_active" || session.sessionMode === "resolved") {
      return c.json(
        { success: false, error: `Cannot send operator message in ${session.sessionMode} mode` },
        409,
      );
    }

    // Inject message into session history as assistant message
    session.injectOperatorMessage(textParts(body.message));

    // Deliver via channel
    if (body.channel === "web") {
      if (config.webChannel) {
        const payload = JSON.stringify({
          type: "output",
          text: body.message,
          parts: textParts(body.message),
          target: "session",
          userId: body.userId,
        });
        config.webChannel.sendToUser(body.userId, payload);
      }
    } else if (body.channel === "whatsapp") {
      const tenant = config.tenantRegistry.get(body.tenantId);
      if (!tenant || !tenant.whatsappPhoneNumberId || !tenant.whatsappAccessToken) {
        return c.json({ success: false, error: "Tenant has no WhatsApp credentials configured" }, 422);
      }

      const accessToken = tenant.whatsappAccessToken.startsWith("$")
        ? (process.env[tenant.whatsappAccessToken.slice(1)] ?? tenant.whatsappAccessToken)
        : tenant.whatsappAccessToken;

      try {
        await sendWhatsAppMessage(tenant.whatsappPhoneNumberId, accessToken, body.userId, {
          type: "text",
          text: { body: body.message },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, error: `WhatsApp delivery failed: ${message}` }, 502);
      }
    }

    if (config.eventEmitter && session.tenantId) {
      config.eventEmitter.emit({
        eventType: "OPERATOR_MESSAGE_SENT",
        tenantId: session.tenantId,
        channel: body.channel,
        externalUserId: body.userId,
        messageContent: body.message,
        messageRole: "operator",
        operatorId: body.operatorId,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    trace.log("handoff", "Operator message delivered", { channel: body.channel });

    return c.json({ success: true, delivered: true });
  });

  // GET /session-history -- Get full conversation history
  app.get("/session-history", async (c) => {
    const trace = new TraceContext();
    const tenantId = c.req.query("tenantId");
    const userId = c.req.query("userId");

    if (!tenantId || !userId) {
      return c.json({ success: false, error: "Missing required query params: tenantId, userId" }, 400);
    }

    trace.log("handoff", "Retrieving session history", { tenantId, userId });

    const session = await config.sessionRegistry.get(config.appName, userId, tenantId);
    if (!session) {
      return c.json({ success: false, error: "Session not found" }, 404);
    }

    return c.json({
      sessionId: session.id,
      mode: session.sessionMode,
      messageCount: session.messageCount,
      history: session.conversationHistory,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
    });
  });

  return app;
}

// Gateway: Handoff routes -- Hono sub-app for operator message injection and session mode transitions
// Enables human-in-the-loop workflows: escalate to human, send operator messages, release back to AI

import { Hono } from "hono";
import { KilnError, textParts } from "@kilnai/core";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import type { WebChannel } from "../channels/web-channel.js";
import { sendWhatsAppMessage } from "../channels/whatsapp-api.js";
import { WHATSAPP_GRAPH_API_VERSION } from "../channels/whatsapp-api.js";
import { sendInstagramMessage, INSTAGRAM_GRAPH_API_VERSION } from "../channels/instagram-api.js";
import { sendMessengerMessage, MESSENGER_GRAPH_API_VERSION } from "../channels/messenger-api.js";
import { dispatchChannelEgress } from "../channels/channel-egress-action-claim.js";
import type { GatewayAuthorityAdmissionPort } from "./gateway-authority-admission.js";
import { requireBearer } from "./auth-middleware.js";
import { TraceContext } from "./trace-context.js";

export interface HandoffRoutesConfig {
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly gatewayAdmission: GatewayAuthorityAdmissionPort;
  readonly appName: string;
  readonly adminToken?: string;
  readonly webChannel?: WebChannel;
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
  /** Stable caller-owned identity for the logical operator send. */
  readonly callerId: string;
  /** Stable caller-owned idempotency key for the logical operator send. */
  readonly idempotencyKey: string;
  readonly message: string;
  readonly channel: "whatsapp" | "web" | "instagram" | "messenger" | "email";
  readonly operatorId?: string;
}

export function createHandoffRoutes(config: HandoffRoutesConfig): Hono {
  const app = new Hono();

  if (config.adminToken) {
    app.use("*", requireBearer(config.adminToken));
  } else {
    console.warn("[handoff-routes] No adminToken configured -- handoff endpoints are unauthenticated");
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
      await config.sessionRegistry.save(session);
    } catch (err) {
      if (err instanceof KilnError && (err.code === "INVALID_SESSION_TRANSITION" || err.code === "CONCURRENT_SESSION_MODIFICATION")) {
        return c.json({ success: false, error: err.message }, 409);
      }
      throw err;
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
      if (body.contextSummary) {
        session.addUserMessage(textParts("[Handoff context] " + body.contextSummary));
      }
      await config.sessionRegistry.save(session);
    } catch (err) {
      if (err instanceof KilnError && (err.code === "INVALID_SESSION_TRANSITION" || err.code === "CONCURRENT_SESSION_MODIFICATION")) {
        return c.json({ success: false, error: err.message }, 409);
      }
      throw err;
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
    if (!body.callerId || !body.idempotencyKey) {
      return c.json({ success: false, error: "Missing required fields: callerId, idempotencyKey" }, 400);
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
    await config.sessionRegistry.save(session);

    // Deliver via channel
    if (body.channel === "web") {
      if (!config.webChannel) return c.json({ success: false, error: "Web channel is unavailable" }, 503);
      const payload = {
        type: "output",
        text: body.message,
        parts: textParts(body.message),
        target: "session",
        userId: body.userId,
      };
      await config.gatewayAdmission.execute({
        ingressId: `handoff:${body.callerId}:${body.idempotencyKey}`,
        appName: config.appName,
        tenantId: body.tenantId,
        userId: session.userId,
        sessionId: session.id,
        channel: body.channel,
        userParts: textParts(body.message),
      }, (admitted) => dispatchChannelEgress({
        context: config.gatewayAdmission.channelEgressActionClaims,
        authorityAdmission: admitted.bundle,
        attemptId: admitted.runtimeModelRoundDispatch.attemptId,
        callerId: body.callerId,
        idempotencyKey: body.idempotencyKey,
        logicalSendSlot: "operator-message",
        channel: body.channel,
        destination: `web:${config.appName}:${body.tenantId}:${body.userId}`,
        adapterIdentity: "web-channel:session-output",
        payload,
        send: async () => { config.webChannel!.sendToUser(body.userId, JSON.stringify(payload)); },
      }));
    } else if (body.channel === "whatsapp") {
      const tenant = config.tenantRegistry.get(body.tenantId);
      if (!tenant || !tenant.whatsappPhoneNumberId || !tenant.whatsappAccessToken) {
        return c.json({ success: false, error: "Tenant has no WhatsApp credentials configured" }, 422);
      }

      const accessToken = tenant.whatsappAccessToken.startsWith("$")
        ? (process.env[tenant.whatsappAccessToken.slice(1)] ?? tenant.whatsappAccessToken)
        : tenant.whatsappAccessToken;

      try {
        const payload = { messaging_product: "whatsapp", to: body.userId, type: "text", text: { body: body.message } };
        await config.gatewayAdmission.execute({
          ingressId: `handoff:${body.callerId}:${body.idempotencyKey}`,
          appName: config.appName,
          tenantId: body.tenantId,
          userId: session.userId,
          sessionId: session.id,
          channel: body.channel,
          userParts: textParts(body.message),
        }, (admitted) => dispatchChannelEgress({
          context: config.gatewayAdmission.channelEgressActionClaims,
          authorityAdmission: admitted.bundle,
          attemptId: admitted.runtimeModelRoundDispatch.attemptId,
          callerId: body.callerId,
          idempotencyKey: body.idempotencyKey,
          logicalSendSlot: "operator-message",
          channel: body.channel,
          destination: `whatsapp:${tenant.whatsappPhoneNumberId}:${body.userId}`,
          adapterIdentity: `whatsapp-cloud:${WHATSAPP_GRAPH_API_VERSION}:${tenant.whatsappPhoneNumberId}`,
          payload,
          send: async () => {
            await sendWhatsAppMessage(tenant.whatsappPhoneNumberId!, accessToken, body.userId, { type: "text", text: { body: body.message } });
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, error: `WhatsApp delivery failed: ${message}` }, 502);
      }
    } else if (body.channel === "instagram") {
      const tenant = config.tenantRegistry.get(body.tenantId);
      if (!tenant || !tenant.instagramPageId || !tenant.instagramAccessToken) {
        return c.json({ success: false, error: "Tenant has no Instagram credentials configured" }, 422);
      }

      const accessToken = tenant.instagramAccessToken.startsWith("$")
        ? (process.env[tenant.instagramAccessToken.slice(1)] ?? tenant.instagramAccessToken)
        : tenant.instagramAccessToken;

      try {
        const payload = { recipient: { id: body.userId }, message: { text: body.message } };
        await config.gatewayAdmission.execute({
          ingressId: `handoff:${body.callerId}:${body.idempotencyKey}`,
          appName: config.appName,
          tenantId: body.tenantId,
          userId: session.userId,
          sessionId: session.id,
          channel: body.channel,
          userParts: textParts(body.message),
        }, (admitted) => dispatchChannelEgress({
          context: config.gatewayAdmission.channelEgressActionClaims,
          authorityAdmission: admitted.bundle,
          attemptId: admitted.runtimeModelRoundDispatch.attemptId,
          callerId: body.callerId,
          idempotencyKey: body.idempotencyKey,
          logicalSendSlot: "operator-message",
          channel: body.channel,
          destination: `instagram:${tenant.instagramPageId}:${body.userId}`,
          adapterIdentity: `instagram-graph:${INSTAGRAM_GRAPH_API_VERSION}:${tenant.instagramPageId}`,
          payload,
          send: () => sendInstagramMessage(tenant.instagramPageId!, accessToken, body.userId, body.message),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, error: `Instagram delivery failed: ${message}` }, 502);
      }
    } else if (body.channel === "messenger") {
      const tenant = config.tenantRegistry.get(body.tenantId);
      if (!tenant || !tenant.messengerPageId || !tenant.messengerAccessToken) {
        return c.json({ success: false, error: "Tenant has no Messenger credentials configured" }, 422);
      }

      const accessToken = tenant.messengerAccessToken.startsWith("$")
        ? (process.env[tenant.messengerAccessToken.slice(1)] ?? tenant.messengerAccessToken)
        : tenant.messengerAccessToken;

      try {
        const payload = { messaging_type: "RESPONSE", recipient: { id: body.userId }, message: { text: body.message } };
        await config.gatewayAdmission.execute({
          ingressId: `handoff:${body.callerId}:${body.idempotencyKey}`,
          appName: config.appName,
          tenantId: body.tenantId,
          userId: session.userId,
          sessionId: session.id,
          channel: body.channel,
          userParts: textParts(body.message),
        }, (admitted) => dispatchChannelEgress({
          context: config.gatewayAdmission.channelEgressActionClaims,
          authorityAdmission: admitted.bundle,
          attemptId: admitted.runtimeModelRoundDispatch.attemptId,
          callerId: body.callerId,
          idempotencyKey: body.idempotencyKey,
          logicalSendSlot: "operator-message",
          channel: body.channel,
          destination: `messenger:me:${body.userId}`,
          adapterIdentity: `messenger-graph:${MESSENGER_GRAPH_API_VERSION}:me`,
          payload,
          send: () => sendMessengerMessage(accessToken, body.userId, body.message),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, error: `Messenger delivery failed: ${message}` }, 502);
      }
    } else if (body.channel === "email") {
      // Email operator messages are injected into session history but not auto-delivered.
      // Email is async -- operators reply directly via their email client.
      trace.log("handoff", "Email operator message recorded in session (delivery via email client)");
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

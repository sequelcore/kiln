// Gateway: Outbound send routes -- Hono sub-app for business-initiated messages
// Generic mechanism: product backends call this to send messages through any channel.
// Kilvo (and future products) own the policy (when to send, to whom, compliance).

import { Hono } from "hono";
import { textParts } from "@kilnai/core";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import { dispatchChannelEgress } from "../channels/channel-egress-action-claim.js";
import { sendWhatsAppMessage, sendWhatsAppTemplate, WHATSAPP_GRAPH_API_VERSION } from "../channels/whatsapp-api.js";
import type { WhatsAppTemplateComponent, WhatsAppSendResult } from "../channels/whatsapp-api.js";
import { sendInstagramMessage, INSTAGRAM_GRAPH_API_VERSION } from "../channels/instagram-api.js";
import { sendMessengerMessage, MESSENGER_GRAPH_API_VERSION } from "../channels/messenger-api.js";
import type { GatewayAuthorityAdmissionPort } from "./gateway-authority-admission.js";
import { requireBearer } from "./auth-middleware.js";

function resolveEnvToken(token: string): string {
  return token.startsWith("$") ? (process.env[token.slice(1)] ?? token) : token;
}

export interface OutboundRoutesConfig {
  readonly tenantRegistry: TenantRegistry;
  readonly sessionRegistry: SessionRegistry;
  readonly gatewayAdmission: GatewayAuthorityAdmissionPort;
  readonly appName: string;
  readonly adminToken?: string;
  readonly evaluateOutboundPermission?: (
    request: OutboundPermissionRequest,
  ) => OutboundPermissionDecision | Promise<OutboundPermissionDecision>;
}

type OutboundDestination = "webhook";
type OutboundPermissionDecision = "allow" | "deny" | "redact";

interface OutboundPermissionRequest {
  readonly tenantId: string;
  readonly channel: "whatsapp" | "instagram" | "messenger";
  readonly destination: OutboundDestination;
  readonly type: "template" | "text";
  readonly to: string;
  readonly text?: string;
  readonly templateName?: string;
}

interface OutboundSendRequest {
  readonly tenantId: string;
  /** Stable caller-owned identity for the logical outbound request. */
  readonly callerId: string;
  /** Stable caller-owned idempotency key for this request. */
  readonly idempotencyKey: string;
  readonly channel: "whatsapp" | "instagram" | "messenger";
  readonly to: string;
  readonly type: "template" | "text";
  readonly template?: {
    readonly name: string;
    readonly language: string;
    readonly components?: readonly WhatsAppTemplateComponent[];
  };
  readonly text?: string;
}

const REDACTED_OUTBOUND_TEXT = "[REDACTED]";

function mapChannelToDestination(
  channel: OutboundSendRequest["channel"],
): OutboundDestination {
  // Current outbound channel sends leave the runtime over external HTTP APIs.
  // In policy terms for this slice, treat them as "webhook" destinations.
  if (channel === "whatsapp") return "webhook";
  if (channel === "instagram") return "webhook";
  return "webhook";
}

export function createOutboundRoutes(config: OutboundRoutesConfig): Hono {
  const app = new Hono();

  if (config.adminToken) {
    app.use("*", requireBearer(config.adminToken));
  }

  app.post("/send", async (c) => {
    let body: OutboundSendRequest;
    try {
      body = await c.req.json<OutboundSendRequest>();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    if (!body.tenantId || !body.channel || !body.to || !body.type) {
      return c.json({ success: false, error: "Missing required fields: tenantId, channel, to, type" }, 400);
    }
    if (!body.callerId || !body.idempotencyKey) {
      return c.json({ success: false, error: "Missing required fields: callerId, idempotencyKey" }, 400);
    }

    const supportedChannels = ["whatsapp", "instagram", "messenger"];
    if (!supportedChannels.includes(body.channel)) {
      return c.json({ success: false, error: `Unsupported channel: ${body.channel as string}` }, 400);
    }

    const tenant = config.tenantRegistry.get(body.tenantId);
    if (!tenant || tenant.appName !== config.appName) {
      return c.json({ success: false, error: "Tenant not found" }, 404);
    }

    const outboundDecision = config.evaluateOutboundPermission
      ? await config.evaluateOutboundPermission({
          tenantId: body.tenantId,
          channel: body.channel,
          destination: mapChannelToDestination(body.channel),
          type: body.type,
          to: body.to,
          text: body.text,
          templateName: body.template?.name,
        })
      : "allow";

    if (outboundDecision === "deny") {
      return c.json({ success: false, error: "Outbound send blocked by policy" }, 403);
    }

    if (outboundDecision === "redact" && body.type === "template") {
      return c.json(
        { success: false, error: "Template outbound send blocked: redact is not supported for templates" },
        403,
      );
    }

    const outboundText = outboundDecision === "redact" ? REDACTED_OUTBOUND_TEXT : body.text;

    try {
      const session = await config.sessionRegistry.getOrCreate({
        appName: config.appName,
        tenantId: body.tenantId,
        userId: `outbound:${body.callerId}`,
        systemPrompt: "",
      });
      return await config.gatewayAdmission.execute({
        ingressId: `outbound:${body.callerId}:${body.idempotencyKey}`,
        appName: config.appName,
        tenantId: body.tenantId,
        userId: session.userId,
        sessionId: session.id,
        channel: body.channel,
        userParts: textParts(outboundText ?? body.template?.name ?? "template"),
      }, async (admitted) => {
      if (body.channel === "whatsapp") {
        if (!tenant.whatsappPhoneNumberId || !tenant.whatsappAccessToken) {
          return c.json({ success: false, error: "Tenant has no WhatsApp credentials configured" }, 422);
        }

        const accessToken = resolveEnvToken(tenant.whatsappAccessToken);
        let result: WhatsAppSendResult;

        if (body.type === "template") {
          if (!body.template?.name || !body.template?.language) {
            return c.json({ success: false, error: "Template sends require template.name and template.language" }, 400);
          }
          const templatePayload = {
            messaging_product: "whatsapp",
            to: body.to,
            type: "template",
            template: {
              name: body.template.name,
              language: { code: body.template.language },
              ...(body.template.components ? { components: body.template.components } : {}),
            },
          };
          result = await dispatchChannelEgress({
            context: config.gatewayAdmission.channelEgressActionClaims,
            authorityAdmission: admitted.bundle,
            attemptId: admitted.runtimeModelRoundDispatch.attemptId,
            callerId: body.callerId,
            idempotencyKey: body.idempotencyKey,
            logicalSendSlot: "outbound-message",
            channel: body.channel,
            destination: `whatsapp:${tenant.whatsappPhoneNumberId}:${body.to}`,
            adapterIdentity: `whatsapp-cloud:${WHATSAPP_GRAPH_API_VERSION}:${tenant.whatsappPhoneNumberId}`,
            payload: templatePayload,
            send: () => sendWhatsAppTemplate(
              tenant.whatsappPhoneNumberId!,
              accessToken,
              body.to,
              body.template!.name,
              body.template!.language,
              body.template!.components,
            ),
          });
        } else {
          if (!outboundText) {
            return c.json({ success: false, error: "Text sends require text field" }, 400);
          }
          const payload = {
            messaging_product: "whatsapp",
            to: body.to,
            type: "text",
            text: { body: outboundText },
          };
          result = await dispatchChannelEgress({
            context: config.gatewayAdmission.channelEgressActionClaims,
            authorityAdmission: admitted.bundle,
            attemptId: admitted.runtimeModelRoundDispatch.attemptId,
            callerId: body.callerId,
            idempotencyKey: body.idempotencyKey,
            logicalSendSlot: "outbound-message",
            channel: body.channel,
            destination: `whatsapp:${tenant.whatsappPhoneNumberId}:${body.to}`,
            adapterIdentity: `whatsapp-cloud:${WHATSAPP_GRAPH_API_VERSION}:${tenant.whatsappPhoneNumberId}`,
            payload,
            send: async () => {
              const res = await sendWhatsAppMessage(tenant.whatsappPhoneNumberId!, accessToken, body.to, { type: "text", text: { body: outboundText } });
              const json = (await res.json()) as { messages?: Array<{ id: string }> };
              const messageId = json.messages?.[0]?.id;
              if (!messageId) throw new Error("WhatsApp API returned no message ID");
              return { whatsappMessageId: messageId };
            },
          });
        }

        return c.json({ success: true, messageId: result.whatsappMessageId });
      } else if (body.channel === "instagram") {
        if (!tenant.instagramPageId || !tenant.instagramAccessToken) {
          return c.json({ success: false, error: "Tenant has no Instagram credentials configured" }, 422);
        }
        if (!outboundText) {
          return c.json({ success: false, error: "Text sends require text field" }, 400);
        }

        const accessToken = resolveEnvToken(tenant.instagramAccessToken);
        const payload = { recipient: { id: body.to }, message: { text: outboundText } };
        const result = await dispatchChannelEgress({
          context: config.gatewayAdmission.channelEgressActionClaims,
          authorityAdmission: admitted.bundle,
          attemptId: admitted.runtimeModelRoundDispatch.attemptId,
          callerId: body.callerId,
          idempotencyKey: body.idempotencyKey,
          logicalSendSlot: "outbound-message",
          channel: body.channel,
          destination: `instagram:${tenant.instagramPageId}:${body.to}`,
          adapterIdentity: `instagram-graph:${INSTAGRAM_GRAPH_API_VERSION}:${tenant.instagramPageId}`,
          payload,
          send: () => sendInstagramMessage(tenant.instagramPageId!, accessToken, body.to, outboundText),
        });
        return c.json({ success: true, messageId: result.messageId });
      } else if (body.channel === "messenger") {
        if (!tenant.messengerAccessToken) {
          return c.json({ success: false, error: "Tenant has no Messenger credentials configured" }, 422);
        }
        if (!outboundText) {
          return c.json({ success: false, error: "Text sends require text field" }, 400);
        }

        const accessToken = resolveEnvToken(tenant.messengerAccessToken);
        const payload = { messaging_type: "RESPONSE", recipient: { id: body.to }, message: { text: outboundText } };
        const result = await dispatchChannelEgress({
          context: config.gatewayAdmission.channelEgressActionClaims,
          authorityAdmission: admitted.bundle,
          attemptId: admitted.runtimeModelRoundDispatch.attemptId,
          callerId: body.callerId,
          idempotencyKey: body.idempotencyKey,
          logicalSendSlot: "outbound-message",
          channel: body.channel,
          destination: `messenger:me:${body.to}`,
          adapterIdentity: `messenger-graph:${MESSENGER_GRAPH_API_VERSION}:me`,
          payload,
          send: () => sendMessengerMessage(accessToken, body.to, outboundText),
        });
        return c.json({ success: true, messageId: result.messageId });
      }
      throw new Error("Unsupported outbound channel");
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[outbound] Send failed tenant=${body.tenantId} channel=${body.channel} to=${body.to}: ${message}`);
      return c.json({ success: false, error: message }, 502);
    }
  });

  return app;
}

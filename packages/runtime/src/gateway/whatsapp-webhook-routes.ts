// Gateway: WhatsApp webhook routes -- Hono sub-app for Meta webhook verification and incoming messages
// Resolves tenant by phone number, processes messages via Mode B orchestrator, replies via Cloud API

import { Hono } from "hono";
import type { ContentPart } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";
import type { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import { sendWhatsAppMessage, whatsappMediaUrl } from "../channels/whatsapp-api.js";

export interface WhatsAppWebhookConfig {
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly verifyToken: string;
}

interface MetaWebhookMessage {
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
}

interface MetaWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
        messages?: MetaWebhookMessage[];
      };
    }>;
  }>;
}

/** Parse a WhatsApp message into ContentPart[] */
function parseWhatsAppMessageParts(msg: MetaWebhookMessage): readonly ContentPart[] | null {
  switch (msg.type) {
    case "text":
      return msg.text?.body ? textParts(msg.text.body) : null;
    case "image": {
      if (!msg.image) return null;
      const parts: ContentPart[] = [
        { type: "image", mimeType: msg.image.mime_type, url: whatsappMediaUrl(msg.image.id) },
      ];
      if (msg.image.caption) parts.push({ type: "text", text: msg.image.caption });
      return parts;
    }
    case "audio":
      if (!msg.audio) return null;
      return [{ type: "audio", mimeType: msg.audio.mime_type, url: whatsappMediaUrl(msg.audio.id) }];
    case "document": {
      if (!msg.document) return null;
      const parts: ContentPart[] = [
        { type: "file", mimeType: msg.document.mime_type, url: whatsappMediaUrl(msg.document.id), filename: msg.document.filename },
      ];
      if (msg.document.caption) parts.push({ type: "text", text: msg.document.caption });
      return parts;
    }
    default:
      return null;
  }
}

export function createWhatsAppWebhookRoutes(config: WhatsAppWebhookConfig): Hono {
  const app = new Hono();

  // GET /webhook -- Meta verification handshake
  app.get("/webhook", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");

    if (mode === "subscribe" && token === config.verifyToken) {
      return c.text(challenge ?? "", 200);
    }
    return c.text("Forbidden", 403);
  });

  // POST /webhook -- Incoming messages from Meta
  app.post("/webhook", async (c) => {
    let payload: MetaWebhookPayload;
    try {
      payload = await c.req.json<MetaWebhookPayload>();
    } catch {
      return c.text("OK", 200);
    }

    if (!payload.entry) {
      return c.text("OK", 200);
    }

    // Process each entry in the background
    const processPromises: Promise<void>[] = [];

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const phoneNumberId = change.value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const messages = change.value.messages;
        if (!messages) continue;

        // Resolve tenant by phone number
        const tenant = config.tenantRegistry.resolveByPhone(phoneNumberId, config.appName);
        if (!tenant) {
          console.warn(`[whatsapp] No tenant found for phone_number_id=${phoneNumberId} app=${config.appName}`);
          continue;
        }

        const contacts = change.value.contacts ?? [];

        for (const msg of messages) {
          const msgParts = parseWhatsAppMessageParts(msg);
          if (!msgParts) {
            console.warn(`[whatsapp] Unsupported message type=${msg.type} from=${msg.from}`);
            continue;
          }

          // Resolve canonical reply address from contacts; fall back to msg.from
          const contact = contacts.find((c) => c.wa_id === msg.from);
          const replyTo = contact?.wa_id ?? msg.from;

          console.log(`[whatsapp] Received message from=${replyTo} tenant=${tenant.tenantId} type=${msg.type}`);

          const promise = processWhatsAppMessage(
            config,
            tenant.tenantId,
            replyTo,
            msgParts,
            phoneNumberId,
            tenant.whatsappAccessToken,
          );
          processPromises.push(promise);
        }
      }
    }

    // Fire and forget -- log any failures from settled promises
    Promise.allSettled(processPromises).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn("[whatsapp] Message processing failed:", result.reason);
        }
      }
    });

    return c.text("OK", 200);
  });

  return app;
}

async function processWhatsAppMessage(
  config: WhatsAppWebhookConfig,
  tenantId: string,
  senderPhone: string,
  messageParts: readonly ContentPart[],
  phoneNumberId: string,
  accessTokenEnv?: string,
): Promise<void> {
  const tenant = config.tenantRegistry.get(tenantId);
  if (!tenant) return;

  const systemPrompt = buildTenantSystemPrompt(tenant);

  const session = config.sessionRegistry.getOrCreate({
    appName: config.appName,
    tenantId,
    userId: senderPhone,
    systemPrompt,
    idleTimeoutMs: tenant.idleTimeoutMs,
  });

  const result = await config.orchestrator.processMessage(session, messageParts);

  // Reply via WhatsApp Cloud API
  const accessToken = accessTokenEnv ? process.env[accessTokenEnv] ?? "" : "";
  const replyText = extractText(result.parts);

  try {
    await sendWhatsAppMessage(phoneNumberId, accessToken, senderPhone, {
      type: "text",
      text: { body: replyText },
    });
  } catch (err) {
    console.warn(
      `[whatsapp] Failed to send reply -- phoneNumberId=${phoneNumberId} recipient=${senderPhone} error=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

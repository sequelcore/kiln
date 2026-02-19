// Gateway: WhatsApp webhook routes -- Hono sub-app for Meta webhook verification and incoming messages
// Resolves tenant by phone number, processes messages via Mode B orchestrator, replies via Cloud API

import { Hono } from "hono";
import type { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";

export interface WhatsAppWebhookConfig {
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly verifyToken: string;
}

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
        }>;
      };
    }>;
  }>;
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
        if (!tenant) continue;

        for (const msg of messages) {
          // Only handle text messages
          if (msg.type !== "text" || !msg.text?.body) continue;

          const promise = processWhatsAppMessage(
            config,
            tenant.tenantId,
            msg.from,
            msg.text.body,
            phoneNumberId,
            tenant.whatsappAccessToken,
          );
          processPromises.push(promise);
        }
      }
    }

    // Fire and forget -- don't await (but handle errors)
    Promise.allSettled(processPromises).catch(() => {});

    return c.text("OK", 200);
  });

  return app;
}

async function processWhatsAppMessage(
  config: WhatsAppWebhookConfig,
  tenantId: string,
  senderPhone: string,
  messageText: string,
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

  const result = await config.orchestrator.processMessage(session, messageText);

  // Reply via WhatsApp Cloud API
  const accessToken = accessTokenEnv ? process.env[accessTokenEnv] ?? "" : "";
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: senderPhone,
        type: "text",
        text: { body: result.content },
      }),
    });
  } catch {
    // Fire and forget - errors are logged but not thrown
  }
}

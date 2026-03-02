// Gateway: WhatsApp webhook routes -- Hono sub-app for Meta webhook verification and incoming messages
// Resolves tenant by phone number, processes messages via Mode B orchestrator, replies via Cloud API

import { Hono } from "hono";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { ContentPart, ToolDefinition } from "@kilnai/core";
import { textParts, extractText, SqliteMemoryStore } from "@kilnai/core";
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
  /** Base path for per-tenant data (e.g. ~/.kiln/gateway/bonitas). Memory DBs stored under <basePath>/memory/ */
  readonly memoryBasePath?: string;
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

/** Lazily-opened per-tenant memory stores. Keyed by tenantId. */
const memoryStores = new Map<string, SqliteMemoryStore>();

function getMemoryStore(memoryBasePath: string, tenantId: string): SqliteMemoryStore {
  let store = memoryStores.get(tenantId);
  if (store) return store;

  const dir = join(memoryBasePath, "memory");
  mkdirSync(dir, { recursive: true });

  store = new SqliteMemoryStore({
    dbPath: join(dir, `${tenantId}.db`),
    layer: "user",
    tenantId,
  });
  memoryStores.set(tenantId, store);
  return store;
}

/** Tool definition for notify_owner -- injected when tenant has escalationContact */
const NOTIFY_OWNER_TOOL: ToolDefinition = {
  name: "notify_owner",
  description: "Send a WhatsApp notification to the business owner. Use this when a customer wants to schedule an appointment, needs escalation, or when the owner needs to be informed about something. Include a clear summary of what the customer needs.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The message to send to the owner. Include customer name (if known), requested service, date/time, and phone number.",
      },
    },
    required: ["message"],
  },
  tags: new Set(["builtin"]),
};

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
  accessToken?: string,
): Promise<void> {
  const tenant = config.tenantRegistry.get(tenantId);
  if (!tenant) return;

  const systemPrompt = buildTenantSystemPrompt(tenant);
  const resolvedAccessToken = accessToken
    ? (process.env[accessToken] ?? accessToken)
    : "";
  const messageText = extractText(messageParts);

  const session = config.sessionRegistry.getOrCreate({
    appName: config.appName,
    tenantId,
    userId: senderPhone,
    systemPrompt,
    idleTimeoutMs: tenant.idleTimeoutMs,
  });

  // --- Memory: recall past context about this user ---
  let recalledMemory: string | undefined;
  if (config.memoryBasePath) {
    try {
      const store = getMemoryStore(config.memoryBasePath, tenantId);
      const query = `${senderPhone} ${messageText}`;
      recalledMemory = await store.recall(query, 500) || undefined;
    } catch (err) {
      console.warn(`[whatsapp] Memory recall failed for tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Tools: build per-call builtin tools ---
  const callTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();

  if (tenant.escalationContact?.phone) {
    const ownerPhone = tenant.escalationContact.phone.replace(/\+/g, "");
    callTools.set("notify_owner", async (input: Record<string, unknown>) => {
      const msg = String(input.message ?? "");
      const fullMessage = `[Ale - Notificación automática]\n\nCliente: ${senderPhone}\n${msg}`;

      await sendWhatsAppMessage(phoneNumberId, resolvedAccessToken, ownerPhone, {
        type: "text",
        text: { body: fullMessage },
      });
      console.log(`[whatsapp] Owner notified for tenant=${tenantId} owner=${ownerPhone}`);
      return { success: true, message: "Owner has been notified." };
    });
  }

  // Register notify_owner tool definition on the orchestrator if not already present
  if (callTools.size > 0 && config.orchestrator.tools) {
    const hasNotifyTool = config.orchestrator.tools.some((t) => t.name === "notify_owner");
    if (!hasNotifyTool) {
      config.orchestrator.registerTools([NOTIFY_OWNER_TOOL]);
    }
  }

  const result = await config.orchestrator.processMessage(
    session,
    messageParts,
    recalledMemory,
    callTools.size > 0 ? callTools : undefined,
  );

  // Reply via WhatsApp Cloud API
  const replyText = extractText(result.parts);

  try {
    await sendWhatsAppMessage(phoneNumberId, resolvedAccessToken, senderPhone, {
      type: "text",
      text: { body: replyText },
    });
  } catch (err) {
    console.warn(
      `[whatsapp] Failed to send reply -- phoneNumberId=${phoneNumberId} recipient=${senderPhone} error=${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Memory: save what was learned from this exchange ---
  if (config.memoryBasePath && messageText.length > 5) {
    try {
      const store = getMemoryStore(config.memoryBasePath, tenantId);
      await store.save({
        layer: "user",
        content: `[${senderPhone}] User: ${messageText}\nAssistant: ${replyText}`,
        tags: [senderPhone],
      });
    } catch (err) {
      console.warn(`[whatsapp] Memory save failed for tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

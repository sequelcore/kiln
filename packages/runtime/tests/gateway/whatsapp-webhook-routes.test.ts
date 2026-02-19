import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter, TenantConfig } from "@kilnai/core";
import { createWhatsAppWebhookRoutes } from "../../src/gateway/whatsapp-webhook-routes.js";
import type { WhatsAppWebhookConfig } from "../../src/gateway/whatsapp-webhook-routes.js";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { SessionRegistry } from "../../src/session/session-registry.js";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
        }>;
      };
    }>;
  }>;
}

function makeMockProvider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      content: "mock response",
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
    orchestrator: new ModeBOrchestrator({ provider }),
    sessionRegistry: new SessionRegistry(),
    tenantRegistry,
    verifyToken: "my-verify-token",
    ...overrides,
  };
}

describe("createWhatsAppWebhookRoutes", () => {
  beforeEach(() => {
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
  });
});

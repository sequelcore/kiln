import { describe, it, expect, beforeEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import { createOutboundRoutes } from "../../src/gateway/outbound-routes.js";
import type { OutboundRoutesConfig } from "../../src/gateway/outbound-routes.js";
import type { TenantConfig } from "@kilnai/core";

const ADMIN_TOKEN = "test-admin-token";

function createTenant(registry: TenantRegistry): TenantConfig {
  return registry.create({
    tenantId: `tenant-${randomUUID().slice(0, 8)}`,
    appName: "test-app",
    name: "Test Business",
    enabled: true,
    whatsappPhoneNumberId: "123456789",
    whatsappAccessToken: "wa-test-token",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as TenantConfig);
}

describe("createOutboundRoutes", () => {
  let tenantRegistry: TenantRegistry;
  let config: OutboundRoutesConfig;

  beforeEach(() => {
    const storageDir = join(tmpdir(), `kiln-outbound-test-${randomUUID()}`);
    tenantRegistry = new TenantRegistry(storageDir);
    config = { tenantRegistry, appName: "test-app", adminToken: ADMIN_TOKEN };
  });

  function sendRequest(body: Record<string, unknown>, token = ADMIN_TOKEN) {
    const app = createOutboundRoutes(config);
    return app.request("/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  it("rejects requests without auth", async () => {
    const app = createOutboundRoutes(config);
    const res = await app.request("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid auth token", async () => {
    const res = await sendRequest({}, "wrong-token");
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON", async () => {
    const app = createOutboundRoutes(config);
    const res = await app.request("/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing required fields", async () => {
    const res = await sendRequest({ tenantId: "x" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Missing required fields");
  });

  it("rejects unsupported channel", async () => {
    const res = await sendRequest({
      tenantId: "x",
      channel: "sms",
      to: "+1234567890",
      type: "text",
      text: "Hello",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unsupported channel");
  });

  it("returns 404 for unknown tenant", async () => {
    const res = await sendRequest({
      tenantId: "nonexistent",
      channel: "whatsapp",
      to: "+1234567890",
      type: "text",
      text: "Hello",
    });
    expect(res.status).toBe(404);
  });

  it("returns 422 for tenant without WhatsApp credentials", async () => {
    const tenant = tenantRegistry.create({
      tenantId: "no-wa",
      appName: "test-app",
      name: "No WhatsApp",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as TenantConfig);

    const res = await sendRequest({
      tenantId: tenant.tenantId,
      channel: "whatsapp",
      to: "+1234567890",
      type: "text",
      text: "Hello",
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("WhatsApp credentials");
  });

  it("rejects template sends without template name/language", async () => {
    const tenant = createTenant(tenantRegistry);
    const res = await sendRequest({
      tenantId: tenant.tenantId,
      channel: "whatsapp",
      to: "+1234567890",
      type: "template",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("template.name");
  });

  it("rejects text sends without text field", async () => {
    const tenant = createTenant(tenantRegistry);
    const res = await sendRequest({
      tenantId: tenant.tenantId,
      channel: "whatsapp",
      to: "+1234567890",
      type: "text",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("text field");
  });

  it("returns 502 when WhatsApp API fails", async () => {
    // Mock fetch to simulate API failure
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request"),
    }));

    const tenant = createTenant(tenantRegistry);
    const res = await sendRequest({
      tenantId: tenant.tenantId,
      channel: "whatsapp",
      to: "+1234567890",
      type: "text",
      text: "Hello",
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);

    vi.unstubAllGlobals();
  });

  it("succeeds for text sends", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: "wamid.test123" }] }),
    }));

    const tenant = createTenant(tenantRegistry);
    const res = await sendRequest({
      tenantId: tenant.tenantId,
      channel: "whatsapp",
      to: "+1234567890",
      type: "text",
      text: "Hello from Kilvo",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.whatsappMessageId).toBe("wamid.test123");

    vi.unstubAllGlobals();
  });

  it("succeeds for template sends", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: "wamid.template456" }] }),
    }));

    const tenant = createTenant(tenantRegistry);
    const res = await sendRequest({
      tenantId: tenant.tenantId,
      channel: "whatsapp",
      to: "+1234567890",
      type: "template",
      template: {
        name: "appointment_reminder",
        language: "es_MX",
        components: [
          { type: "body", parameters: [{ type: "text", text: "Maria" }] },
        ],
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.whatsappMessageId).toBe("wamid.template456");

    vi.unstubAllGlobals();
  });

  it("works without admin token (open mode)", async () => {
    const openConfig: OutboundRoutesConfig = { tenantRegistry, appName: "test-app" };
    const app = createOutboundRoutes(openConfig);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: "wamid.open" }] }),
    }));

    const tenant = createTenant(tenantRegistry);
    const res = await app.request("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.tenantId,
        channel: "whatsapp",
        to: "+1234567890",
        type: "text",
        text: "Hello",
      }),
    });
    expect(res.status).toBe(200);

    vi.unstubAllGlobals();
  });
});

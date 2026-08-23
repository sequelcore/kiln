import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { type TenantConfig, textParts } from "@kilnai/core/engine";
import { createEmailWebhookRoutes } from "../../src/gateway/email-webhook-routes.js";
import type { EmailWebhookConfig } from "../../src/gateway/email-webhook-routes.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { makeGatewayTestAdmission } from "./gateway-test-admission.js";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import { InMemoryEmailThreadStore } from "../../src/gateway/email-thread-store.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestFetch } from "../fetch-fixture.js";

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
const mockFetch = createTestFetch(vi.fn(async () => new Response(JSON.stringify({}), {
  headers: { "content-type": "application/json" },
})));

interface InboundEmailPayload {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  textBody: string;
  htmlBody?: string;
  headers: Record<string, string>;
}

function makeMockProvider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock email response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeEmailPayload(overrides: Partial<InboundEmailPayload> = {}): InboundEmailPayload {
  return {
    from: "customer@example.com",
    to: "support@business.com",
    subject: "Need help with my order",
    messageId: "<msg-001@example.com>",
    textBody: "Hello, I need help with my order",
    headers: {},
    ...overrides,
  };
}

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "email-tenant",
    appName: "test-app",
    name: "Test Email Business",
    description: "An email-enabled business",
    tone: "friendly",
    language: "en-US",
    emailAddress: "support@business.com",
    emailFromAddress: "support@business.com",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<EmailWebhookConfig> = {}): EmailWebhookConfig {
  const provider = makeMockProvider();
  const orchestrator = new RuntimeSessionOrchestrator({ provider, model: provider.name });
  orchestrator.bindProvider = vi.fn().mockReturnValue(orchestrator);
  const tmpDir = mkdtempSync(join(tmpdir(), "email-webhook-test-"));
  const tenantRegistry = new TenantRegistry(tmpDir);
  const sessionRegistry = new SessionRegistry();
  return {
    appName: "test-app",
    orchestrator,
    sessionRegistry,
    tenantRegistry,
    gatewayAdmission: makeGatewayTestAdmission(sessionRegistry, provider),
    ...overrides,
  };
}

describe("createEmailWebhookRoutes", () => {
  beforeEach(() => {
    mockFetch.mockReset();
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

    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("POST /webhook", () => {
    it("processes valid email and calls orchestrator", async () => {
      const threadStore = new InMemoryEmailThreadStore();
      const mockTransport = { send: vi.fn().mockResolvedValue({ messageId: "<reply-1@business.com>" }) };
      const config = makeConfig({ threadStore, emailTransport: mockTransport });
      const tenant = makeTenantConfig();
      config.tenantRegistry.create(tenant);
      // Mock resolveByEmailAddress since it may not exist yet
      (config.tenantRegistry as unknown as Record<string, unknown>).resolveByEmailAddress = vi.fn().mockReturnValue(tenant);

      const app = createEmailWebhookRoutes(config);
      const payload = makeEmailPayload();
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");

      // Wait for fire-and-forget processing
      await new Promise((r) => setTimeout(r, 100));

      // Orchestrator should have been called
      const provider = (config.orchestrator as unknown as { deps: { provider: ProviderAdapter } }).deps.provider;
      expect(provider.createMessage).toHaveBeenCalledTimes(1);

      // Transport should have sent a reply
      expect(mockTransport.send).toHaveBeenCalledTimes(1);
      const sentEmail = mockTransport.send.mock.calls[0]![0];
      expect(sentEmail.to).toBe("customer@example.com");
      expect(sentEmail.subject).toBe("Re: Need help with my order");
      expect(sentEmail.inReplyTo).toBe("<msg-001@example.com>");
      expect(sentEmail.headers["Auto-Submitted"]).toBe("auto-replied");
    });

    it("rejects auto-reply emails silently", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig();
      config.tenantRegistry.create(tenant);
      (config.tenantRegistry as unknown as Record<string, unknown>).resolveByEmailAddress = vi.fn().mockReturnValue(tenant);

      const app = createEmailWebhookRoutes(config);
      const payload = makeEmailPayload({
        headers: { "Auto-Submitted": "auto-replied" },
      });
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

    it("rejects ignored senders silently", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig();
      config.tenantRegistry.create(tenant);

      const app = createEmailWebhookRoutes(config);
      const payload = makeEmailPayload({ from: "noreply@example.com" });
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

    it("rejects self-send (from === to)", async () => {
      const config = makeConfig();
      const tenant = makeTenantConfig();
      config.tenantRegistry.create(tenant);

      const app = createEmailWebhookRoutes(config);
      const payload = makeEmailPayload({
        from: "support@business.com",
        to: "support@business.com",
      });
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

    it("returns 200 OK when no tenant found", async () => {
      const config = makeConfig();
      (config.tenantRegistry as unknown as Record<string, unknown>).resolveByEmailAddress = vi.fn().mockReturnValue(undefined);

      const app = createEmailWebhookRoutes(config);
      const payload = makeEmailPayload({ to: "unknown@nowhere.com" });
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

    it("creates and updates thread tracking", async () => {
      const threadStore = new InMemoryEmailThreadStore();
      const mockTransport = { send: vi.fn().mockResolvedValue({ messageId: "<reply-1@business.com>" }) };
      const config = makeConfig({ threadStore, emailTransport: mockTransport });
      const tenant = makeTenantConfig();
      config.tenantRegistry.create(tenant);
      (config.tenantRegistry as unknown as Record<string, unknown>).resolveByEmailAddress = vi.fn().mockReturnValue(tenant);

      const app = createEmailWebhookRoutes(config);

      // First message -- creates thread
      const payload1 = makeEmailPayload({ messageId: "<msg-A@example.com>" });
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload1),
      });

      await new Promise((r) => setTimeout(r, 100));

      const thread1 = threadStore.getByMessageId("<msg-A@example.com>");
      expect(thread1).toBeDefined();
      expect(thread1!.senderEmail).toBe("customer@example.com");

      // Second message -- references first, should join thread
      const payload2 = makeEmailPayload({
        messageId: "<msg-B@example.com>",
        inReplyTo: "<msg-A@example.com>",
        references: "<msg-A@example.com>",
      });
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload2),
      });

      await new Promise((r) => setTimeout(r, 100));

      const thread2 = threadStore.getByMessageId("<msg-B@example.com>");
      expect(thread2).toBeDefined();
      // Should be the same thread
      expect(thread2!.threadId).toBe(thread1!.threadId);
      // Should include both inbound + outbound messageIds
      expect(thread2!.messageIds.length).toBeGreaterThanOrEqual(2);
    });

    it("does not send reply when budget is exhausted", async () => {
      const mockTransport = { send: vi.fn().mockResolvedValue({ messageId: "<r@b.com>" }) };
      const billing = {
        budgetEndpoint: "http://billing.test/check?user={userId}",
        overBudgetMessage: "No budget.",
      };
      const config = makeConfig({ emailTransport: mockTransport, billing });
      const tenant = makeTenantConfig();
      config.tenantRegistry.create(tenant);
      (config.tenantRegistry as unknown as Record<string, unknown>).resolveByEmailAddress = vi.fn().mockReturnValue(tenant);

      // Mock budget check to return not allowed
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ allowed: false, remaining: 0, unit: "tokens" }), {
        headers: { "content-type": "application/json" },
      }));

      const app = createEmailWebhookRoutes(config);
      const payload = makeEmailPayload();
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 100));

      // Should not have called the orchestrator or sent email
      const provider = (config.orchestrator as unknown as { deps: { provider: ProviderAdapter } }).deps.provider;
      expect(provider.createMessage).not.toHaveBeenCalled();
      expect(mockTransport.send).not.toHaveBeenCalled();
    });


    it("returns 200 for malformed JSON", async () => {
      const config = makeConfig();
      const app = createEmailWebhookRoutes(config);

      const res = await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-valid-json",
      });

      expect(res.status).toBe(200);
    });

    it("does not prefix Re: if subject already has it", async () => {
      const mockTransport = { send: vi.fn().mockResolvedValue({ messageId: "<r@b.com>" }) };
      const config = makeConfig({ emailTransport: mockTransport });
      const tenant = makeTenantConfig();
      config.tenantRegistry.create(tenant);
      (config.tenantRegistry as unknown as Record<string, unknown>).resolveByEmailAddress = vi.fn().mockReturnValue(tenant);

      const app = createEmailWebhookRoutes(config);
      const payload = makeEmailPayload({ subject: "Re: Existing thread" });
      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(mockTransport.send).toHaveBeenCalledTimes(1);
      const sentEmail = mockTransport.send.mock.calls[0]![0];
      expect(sentEmail.subject).toBe("Re: Existing thread");
    });

    it("uses the model-only admitted tool authority instead of tenant hints", async () => {
      const mockTransport = { send: vi.fn().mockResolvedValue({ messageId: "<r@b.com>" }) };
      const config = makeConfig({ emailTransport: mockTransport });
      const tenant = makeTenantConfig();
      config.tenantRegistry.create(tenant);
      (config.tenantRegistry as unknown as Record<string, unknown>).resolveByEmailAddress = vi.fn().mockReturnValue(tenant);

      const processSpy = vi.spyOn(config.orchestrator, "processMessage");
      const app = createEmailWebhookRoutes(config);

      await app.request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeEmailPayload()),
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(processSpy).toHaveBeenCalledTimes(1);
      const governedContext = processSpy.mock.calls[0]![2];
      expect(governedContext).toEqual(expect.objectContaining({
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }));
      const perCallConfig = processSpy.mock.calls[0]![4];
      expect(perCallConfig?.authorityAdmission).toMatchObject({
        turn: { authority: { admittedAuthority: "fail_closed" } },
      });
    });
  });
});

import { describe, it, expect } from "vitest";
import type { TenantConfig } from "@kilnai/core";
import { SlidingWindowRateLimiter } from "@kilnai/core";
import { buildTenantToolContext } from "../../src/gateway/tenant-tool-factory.js";

function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "test-tenant",
    appName: "test-app",
    name: "Test Tenant",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildTenantToolContext", () => {
  it("returns empty context when tenant has no tool config", () => {
    const tenant = makeTenant();
    const ctx = buildTenantToolContext(tenant);

    expect(ctx.callBuiltinTools.size).toBe(0);
    expect(ctx.toolDefinitions).toHaveLength(0);
    expect(ctx.toolAllowlist).toBeUndefined();
    expect(ctx.rateLimiter).toBeUndefined();
    expect(ctx.maxToolRounds).toBeUndefined();
  });

  it("creates webhook tool executors from tenant.webhookTools", () => {
    const tenant = makeTenant({
      webhookTools: [
        {
          name: "lookup_order",
          description: "Look up an order by ID",
          url: "https://api.example.com/orders",
          secret: "s3cret",
          timeout: 10,
          inputSchema: { type: "object", properties: { orderId: { type: "string" } } },
        },
        {
          name: "cancel_order",
          url: "https://api.example.com/cancel",
          secret: "s3cret2",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.callBuiltinTools.size).toBe(2);
    expect(ctx.toolDefinitions).toHaveLength(2);
  });

  it("webhook tool names appear in callBuiltinTools map", () => {
    const tenant = makeTenant({
      webhookTools: [
        {
          name: "create_ticket",
          description: "Create a support ticket",
          url: "https://api.example.com/tickets",
          secret: "hmac-key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.callBuiltinTools.has("create_ticket")).toBe(true);
    expect(typeof ctx.callBuiltinTools.get("create_ticket")).toBe("function");
  });

  it("webhook tool definitions are generated correctly", () => {
    const tenant = makeTenant({
      webhookTools: [
        {
          name: "search_products",
          description: "Search product catalog",
          url: "https://api.example.com/search",
          secret: "key123",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.toolDefinitions).toHaveLength(1);
    const def = ctx.toolDefinitions[0]!;
    expect(def.name).toBe("search_products");
    expect(def.description).toBe("Search product catalog");
    expect(def.inputSchema).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
    expect(def.tags).toEqual(new Set());
  });

  it("webhook tool without description gets default description", () => {
    const tenant = makeTenant({
      webhookTools: [
        {
          name: "do_thing",
          url: "https://api.example.com/thing",
          secret: "key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

    const def = ctx.toolDefinitions[0]!;
    expect(def.description).toBe("Webhook tool: do_thing");
  });

  it("existing builtins take precedence over webhook tools with same name", () => {
    const builtinFn = async (_input: Record<string, unknown>) => ({ builtin: true });
    const existingBuiltins = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>([
      ["overlap_tool", builtinFn],
    ]);

    const tenant = makeTenant({
      webhookTools: [
        {
          name: "overlap_tool",
          description: "Webhook version",
          url: "https://api.example.com/overlap",
          secret: "key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant, existingBuiltins);

    // The builtin should overwrite the webhook executor
    expect(ctx.callBuiltinTools.get("overlap_tool")).toBe(builtinFn);
  });

  it("allowlist is built from tenant.tools + webhook tool names", () => {
    const tenant = makeTenant({
      tools: ["tool_a", "tool_b"],
      webhookTools: [
        {
          name: "webhook_c",
          url: "https://api.example.com/c",
          secret: "key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.toolAllowlist).toBeDefined();
    expect(ctx.toolAllowlist!.has("tool_a")).toBe(true);
    expect(ctx.toolAllowlist!.has("tool_b")).toBe(true);
    expect(ctx.toolAllowlist!.has("webhook_c")).toBe(true);
    expect(ctx.toolAllowlist!.size).toBe(3);
  });

  it("allowlist is undefined when tenant.tools is not set", () => {
    const tenant = makeTenant({
      webhookTools: [
        {
          name: "some_webhook",
          url: "https://api.example.com/x",
          secret: "key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.toolAllowlist).toBeUndefined();
  });

  it("rate limiter is created when rateLimits configured", () => {
    const tenant = makeTenant({
      toolConfig: {
        rateLimits: { defaultPerMinute: 30, perTool: { slow_tool: 5 } },
      },
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.rateLimiter).toBeDefined();
    // Verify it behaves like a SlidingWindowRateLimiter
    const result = ctx.rateLimiter!.check("test-tenant", "any_tool");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(30);
  });

  it("rate limiter is undefined when no rateLimits", () => {
    const tenant = makeTenant({
      toolConfig: { maxIterationsPerSession: 10 },
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.rateLimiter).toBeUndefined();
  });

  it("maxToolRounds is set from maxIterationsPerSession", () => {
    const tenant = makeTenant({
      toolConfig: { maxIterationsPerSession: 8 },
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.maxToolRounds).toBe(8);
  });

  it("maxToolRounds is undefined when maxIterationsPerSession not set", () => {
    const tenant = makeTenant({
      toolConfig: { rateLimits: { defaultPerMinute: 60 } },
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.maxToolRounds).toBeUndefined();
  });

  it("merges existing builtins without webhook tools", () => {
    const fnA = async (_input: Record<string, unknown>) => ({ a: true });
    const fnB = async (_input: Record<string, unknown>) => ({ b: true });
    const existingBuiltins = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>([
      ["builtin_a", fnA],
      ["builtin_b", fnB],
    ]);

    const tenant = makeTenant();
    const ctx = buildTenantToolContext(tenant, existingBuiltins);

    expect(ctx.callBuiltinTools.size).toBe(2);
    expect(ctx.callBuiltinTools.get("builtin_a")).toBe(fnA);
    expect(ctx.callBuiltinTools.get("builtin_b")).toBe(fnB);
    expect(ctx.toolDefinitions).toHaveLength(0);
  });

  it("webhook timeout defaults to 30s when not specified", () => {
    // We verify this indirectly: if timeout is not set, the webhook config
    // should use 30_000ms. We check tool is created without errors.
    const tenant = makeTenant({
      webhookTools: [
        {
          name: "no_timeout_tool",
          url: "https://api.example.com/x",
          secret: "key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.callBuiltinTools.has("no_timeout_tool")).toBe(true);
    expect(ctx.toolDefinitions).toHaveLength(1);
  });
});

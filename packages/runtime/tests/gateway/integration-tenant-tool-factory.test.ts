import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTenantToolContext,
  configureIntegrationDeps,
  clearIntegrationDeps,
} from "../../src/gateway/tenant-tool-factory.js";
import { IntegrationRegistry } from "../../src/gateway/integration-registry.js";
import type {
  CredentialResolver,
  IntegrationAdapter,
  IntegrationResult,
  ResolvedCredential,
  TenantConfig,
} from "@kilnai/core/engine";

function baseTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "t1",
    appName: "app",
    name: "Test",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAdapter(provider: string, operations: string[]): IntegrationAdapter {
  return {
    provider,
    version: "1.0.0",
    operations: operations.map((name) => ({
      name,
      description: `${name} desc`,
      inputSchema: { type: "object" },
    })),
    execute: vi.fn(async (): Promise<IntegrationResult> => ({ data: { ok: true } })),
  };
}

function makeResolver(): CredentialResolver {
  return {
    resolve: vi.fn(async (): Promise<ResolvedCredential> => ({ type: "bearer", value: "tok" })),
    invalidate: vi.fn(),
  };
}

describe("buildTenantToolContext — integrations", () => {
  afterEach(() => {
    clearIntegrationDeps();
    vi.restoreAllMocks();
  });

  it("works without configureIntegrationDeps (backward compat)", () => {
    const ctx = buildTenantToolContext(baseTenant({ integrations: [{ provider: "cal", credentialKey: "k" }] }));
    expect(ctx.callBuiltinTools.size).toBe(0);
    expect(ctx.toolDefinitions).toHaveLength(0);
  });

  it("includes integration tools in callBuiltinTools and toolDefinitions", () => {
    const registry = new IntegrationRegistry();
    registry.register(makeAdapter("stripe", ["create_link"]));
    configureIntegrationDeps({ registry, credentialResolver: makeResolver() });

    const ctx = buildTenantToolContext(baseTenant({
      integrations: [{ provider: "stripe", credentialKey: "sk" }],
    }));

    expect(ctx.callBuiltinTools.has("stripe_create_link")).toBe(true);
    expect(ctx.toolDefinitions).toHaveLength(1);
    expect(ctx.toolDefinitions[0]!.name).toBe("stripe_create_link");
    expect(ctx.toolDefinitions[0]!.tags).toEqual(new Set(["integration", "stripe"]));
  });

  it("integration tool execution calls adapter with resolved credential", async () => {
    const adapter = makeAdapter("cal", ["book"]);
    const resolver = makeResolver();
    const registry = new IntegrationRegistry();
    registry.register(adapter);
    configureIntegrationDeps({ registry, credentialResolver: resolver });

    const ctx = buildTenantToolContext(baseTenant({
      integrations: [{ provider: "cal", credentialKey: "gc-tok" }],
    }));

    const result = await ctx.callBuiltinTools.get("cal_book")!({ date: "2026-03-10" });
    expect(result).toEqual({ ok: true });
    expect(resolver.resolve).toHaveBeenCalledWith("t1", "cal");
    expect(adapter.execute).toHaveBeenCalledWith(
      "book",
      { type: "bearer", value: "tok" },
      { date: "2026-03-10" },
      expect.anything(),
    );
  });

  it("adds integration tool names to allowlist when tenant.tools is set", () => {
    const registry = new IntegrationRegistry();
    registry.register(makeAdapter("stripe", ["pay"]));
    configureIntegrationDeps({ registry, credentialResolver: makeResolver() });

    const ctx = buildTenantToolContext(baseTenant({
      tools: ["some_other_tool"],
      integrations: [{ provider: "stripe", credentialKey: "k" }],
    }));

    expect(ctx.toolAllowlist!.has("stripe_pay")).toBe(true);
    expect(ctx.toolAllowlist!.has("some_other_tool")).toBe(true);
  });

  it("respects operation filter on TenantIntegration", () => {
    const registry = new IntegrationRegistry();
    registry.register(makeAdapter("cal", ["check", "book", "cancel"]));
    configureIntegrationDeps({ registry, credentialResolver: makeResolver() });

    const ctx = buildTenantToolContext(baseTenant({
      integrations: [{ provider: "cal", credentialKey: "k", operations: ["book"] }],
    }));

    expect(ctx.callBuiltinTools.has("cal_book")).toBe(true);
    expect(ctx.callBuiltinTools.has("cal_check")).toBe(false);
    expect(ctx.callBuiltinTools.has("cal_cancel")).toBe(false);
  });

  it("silently skips unregistered adapter providers", () => {
    const registry = new IntegrationRegistry();
    configureIntegrationDeps({ registry, credentialResolver: makeResolver() });

    const ctx = buildTenantToolContext(baseTenant({
      integrations: [{ provider: "nonexistent", credentialKey: "k" }],
    }));

    expect(ctx.callBuiltinTools.size).toBe(0);
  });

  it("works with empty integrations array", () => {
    const registry = new IntegrationRegistry();
    configureIntegrationDeps({ registry, credentialResolver: makeResolver() });

    const ctx = buildTenantToolContext(baseTenant({ integrations: [] }));
    expect(ctx.callBuiltinTools.size).toBe(0);
  });

  it("clearIntegrationDeps removes integration wiring", () => {
    const registry = new IntegrationRegistry();
    registry.register(makeAdapter("x", ["y"]));
    configureIntegrationDeps({ registry, credentialResolver: makeResolver() });
    clearIntegrationDeps();

    const ctx = buildTenantToolContext(baseTenant({
      integrations: [{ provider: "x", credentialKey: "k" }],
    }));
    expect(ctx.callBuiltinTools.size).toBe(0);
  });
});

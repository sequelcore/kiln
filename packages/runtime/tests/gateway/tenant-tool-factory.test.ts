import { describe, it, expect, afterEach } from "vitest";
import type {
  ActionEffectEnvelope,
  CredentialResolver,
  IntegrationAdapter,
  TenantConfig,
} from "@kilnai/core/engine";
import { buildTenantToolContext, clearIntegrationDeps, configureIntegrationDeps } from "../../src/gateway/tenant-tool-factory.js";
import { deriveRuntimeConvergencePolicyInput } from "../../src/session/runtime-execution-envelope.js";
import { IntegrationRegistry } from "../../src/gateway/integration-registry.js";

function makeTenantExecutionEnvelope(toolRounds: number) {
  return {
    convergence: deriveRuntimeConvergencePolicyInput({
      policyId: "kiln.tenant.tool-config",
      toolRounds,
    }),
  };
}

const READ_ONLY_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["external-system"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "authenticated",
  consequences: [],
  idempotency: "conditionally-idempotent",
};

const IDEMPOTENT_EFFECT: ActionEffectEnvelope = {
  ...READ_ONLY_EFFECT,
  idempotency: "idempotent",
};

const AUDITED_EFFECT: ActionEffectEnvelope = {
  ...READ_ONLY_EFFECT,
  dataEgress: "project-data",
};

const DESTRUCTIVE_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["external-system"],
  reversibility: "irreversible",
  dataEgress: "project-data",
  identityUse: "authenticated",
  consequences: ["external-state"],
  idempotency: "non-idempotent",
};

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
  afterEach(() => {
    clearIntegrationDeps();
  });

  it("returns empty context when tenant has no tool config", () => {
    const tenant = makeTenant();
    const ctx = buildTenantToolContext(tenant);

    expect(ctx.callBuiltinTools.size).toBe(0);
    expect(ctx.toolDefinitions).toHaveLength(0);
    expect(ctx.toolAuthority.size).toBe(0);
    expect(ctx.toolAuthorityClassification.size).toBe(0);
    expect(ctx.integrationAuthorityRollup.size).toBe(0);
    expect(ctx.toolAllowlist).toBeUndefined();
    expect(ctx.rateLimiter).toBeUndefined();
    expect(ctx.executionEnvelope).toBeUndefined();
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

  it("execution envelope is set from maxIterationsPerSession", () => {
    const tenant = makeTenant({
      toolConfig: { maxIterationsPerSession: 8 },
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.executionEnvelope).toEqual(makeTenantExecutionEnvelope(8));
  });

  it("execution envelope is undefined when maxIterationsPerSession not set", () => {
    const tenant = makeTenant({
      toolConfig: { rateLimits: { defaultPerMinute: 60 } },
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.executionEnvelope).toBeUndefined();
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

  it("derives canonical tool authority from integration capability effect envelopes", () => {
    const registry = new IntegrationRegistry();
    const resolver: CredentialResolver = {
      resolve: async () => ({ type: "bearer", value: "token" }),
      invalidate: () => undefined,
    };

    const adapter: IntegrationAdapter = {
      provider: "stripe",
      version: "1.0.0",
      operations: [
        {
          name: "list_customers",
          description: "List customers",
          inputSchema: {},
          effectEnvelope: IDEMPOTENT_EFFECT,
        },
        {
          name: "delete_customer",
          description: "Delete customer",
          inputSchema: {},
          effectEnvelope: DESTRUCTIVE_EFFECT,
        },
      ],
      execute: async () => ({ data: {} }),
    };
    registry.register(adapter);
    configureIntegrationDeps({ registry, credentialResolver: resolver });

    const tenant = makeTenant({
      integrations: [
        {
          provider: "stripe",
          credentialKey: "stripe_api_key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

expect(ctx.toolAuthority.get("stripe_list_customers")).toEqual({
      level: 2,
      allowed: true,
      requiresApproval: false,
      reason: "Observation with external access, audited execution",
    });
    expect(ctx.toolAuthority.get("stripe_delete_customer")).toEqual({
      level: 4,
      allowed: false,
      requiresApproval: true,
      reason: "Irreversible mutation with external impact or sensitive egress requires confirmation",
    });
  });

  it("derives tool authority classification precedence from integration capability effects", () => {
    const registry = new IntegrationRegistry();
    const resolver: CredentialResolver = {
      resolve: async () => ({ type: "bearer", value: "token" }),
      invalidate: () => undefined,
    };

    const adapter: IntegrationAdapter = {
      provider: "ops",
      version: "1.0.0",
      operations: [
        {
          name: "idempotent_read_op",
          description: "Idempotent read operation",
          inputSchema: {},
          effectEnvelope: IDEMPOTENT_EFFECT,
        },
        {
          name: "read_only_op",
          description: "Read operation",
          inputSchema: {},
          effectEnvelope: READ_ONLY_EFFECT,
        },
        {
          name: "destructive_op",
          description: "Destructive operation",
          inputSchema: {},
          effectEnvelope: DESTRUCTIVE_EFFECT,
        },
        {
          name: "audited_default_op",
          description: "Project-data observation means audited classification",
          inputSchema: {},
          effectEnvelope: AUDITED_EFFECT,
        },
      ],
      execute: async () => ({ data: {} }),
    };
    registry.register(adapter);
    configureIntegrationDeps({ registry, credentialResolver: resolver });

    const tenant = makeTenant({
      integrations: [
        {
          provider: "ops",
          credentialKey: "ops_key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

expect(ctx.toolAuthorityClassification.get("ops_idempotent_read_op")).toBe("idempotent");
    expect(ctx.toolAuthorityClassification.get("ops_read_only_op")).toBe("audited");
    expect(ctx.toolAuthorityClassification.get("ops_destructive_op")).toBe("destructive");
    expect(ctx.toolAuthorityClassification.get("ops_audited_default_op")).toBe("audited");
  });

  it("keeps classification precedence consistent with toolAuthority for the same tool", () => {
    const registry = new IntegrationRegistry();
    const resolver: CredentialResolver = {
      resolve: async () => ({ type: "bearer", value: "token" }),
      invalidate: () => undefined,
    };

    const adapter: IntegrationAdapter = {
      provider: "consistency",
      version: "1.0.0",
      operations: [
        {
          name: "audited_observe",
          description: "Audited observation to verify classification consistency",
          inputSchema: {},
          effectEnvelope: AUDITED_EFFECT,
        },
      ],
      execute: async () => ({ data: {} }),
    };
    registry.register(adapter);
    configureIntegrationDeps({ registry, credentialResolver: resolver });

    const tenant = makeTenant({
      integrations: [
        {
          provider: "consistency",
          credentialKey: "consistency_key",
        },
      ],
    });

    const ctx = buildTenantToolContext(tenant);
const toolName = "consistency_audited_observe";

    expect(ctx.toolAuthorityClassification.get(toolName)).toBe("audited");
    expect(ctx.toolAuthority.get(toolName)).toEqual({
      level: 2,
      allowed: true,
      requiresApproval: false,
      reason: "Observation with external access, audited execution",
    });
  });

  it("derives integration authority rollup across providers with conservative precedence", () => {
    const registry = new IntegrationRegistry();
    const resolver: CredentialResolver = {
      resolve: async () => ({ type: "bearer", value: "token" }),
      invalidate: () => undefined,
    };

    registry.register({
      provider: "ro",
      version: "1.0.0",
      operations: [
        {
          name: "list",
          description: "Read-only operation",
          inputSchema: {},
          effectEnvelope: READ_ONLY_EFFECT,
        },
      ],
      execute: async () => ({ data: {} }),
    });

    registry.register({
      provider: "idem",
      version: "1.0.0",
      operations: [
        {
          name: "get",
          description: "Read operation",
          inputSchema: {},
          effectEnvelope: READ_ONLY_EFFECT,
        },
        {
          name: "upsert",
          description: "Idempotent operation",
          inputSchema: {},
          effectEnvelope: IDEMPOTENT_EFFECT,
        },
      ],
      execute: async () => ({ data: {} }),
    });

    registry.register({
      provider: "audit",
      version: "1.0.0",
      operations: [
        {
          name: "default_policy",
          description: "Project-data observation defaults to audited classification",
          inputSchema: {},
          effectEnvelope: AUDITED_EFFECT,
        },
      ],
      execute: async () => ({ data: {} }),
    });

    registry.register({
      provider: "dest",
      version: "1.0.0",
      operations: [
        {
          name: "delete",
          description: "Destructive operation",
          inputSchema: {},
          effectEnvelope: DESTRUCTIVE_EFFECT,
        },
        {
          name: "list",
          description: "Read-only companion operation",
          inputSchema: {},
          effectEnvelope: READ_ONLY_EFFECT,
        },
      ],
      execute: async () => ({ data: {} }),
    });

    configureIntegrationDeps({ registry, credentialResolver: resolver });

    const tenant = makeTenant({
      integrations: [
        { provider: "ro", credentialKey: "k1" },
        { provider: "idem", credentialKey: "k2" },
        { provider: "audit", credentialKey: "k3" },
        { provider: "dest", credentialKey: "k4" },
      ],
    });

    const ctx = buildTenantToolContext(tenant);

expect(ctx.integrationAuthorityRollup.get("ro")).toBe("audited");
    expect(ctx.integrationAuthorityRollup.get("idem")).toBe("audited");
    expect(ctx.integrationAuthorityRollup.get("audit")).toBe("audited");
    expect(ctx.integrationAuthorityRollup.get("dest")).toBe("destructive");
  });

  it("rolls up to unknown when provider has tool definitions but missing classification", () => {
    const registry = new IntegrationRegistry();
    const resolver: CredentialResolver = {
      resolve: async () => ({ type: "bearer", value: "token" }),
      invalidate: () => undefined,
    };

    registry.register({
      provider: "unknown_case",
      version: "1.0.0",
      operations: [
        {
          name: "no_annotations",
          description: "Tool definition exists but no annotations for classification map",
          inputSchema: {},
        },
      ],
      execute: async () => ({ data: {} }),
    });

    configureIntegrationDeps({ registry, credentialResolver: resolver });

    const tenant = makeTenant({
      integrations: [{ provider: "unknown_case", credentialKey: "k" }],
    });

    const ctx = buildTenantToolContext(tenant);

    expect(ctx.integrationAuthorityRollup.get("unknown_case")).toBe("unknown");
  });
});

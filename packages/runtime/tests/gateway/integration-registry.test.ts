import { describe, expect, it } from "vitest";
import { IntegrationRegistry } from "../../src/gateway/integration-registry.js";
import type { IntegrationAdapter, IntegrationResult, ResolvedCredential } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

function makeAdapter(provider: string, operations: string[] = ["op_a", "op_b"]): IntegrationAdapter {
  return {
    provider,
    version: "1.0.0",
    operations: operations.map((name) => ({
      name,
      description: `${provider} ${name}`,
      inputSchema: { type: "object" },
    })),
    execute: async (_op: string, _cred: ResolvedCredential, _input: Record<string, unknown>): Promise<IntegrationResult> => ({
      data: { ok: true },
    }),
  };
}

describe("IntegrationRegistry", () => {
  it("register and get", () => {
    const registry = new IntegrationRegistry();
    const adapter = makeAdapter("stripe");
    registry.register(adapter);
    expect(registry.get("stripe")).toBe(adapter);
  });

  it("throws on duplicate provider", () => {
    const registry = new IntegrationRegistry();
    registry.register(makeAdapter("stripe"));
    expect(() => registry.register(makeAdapter("stripe"))).toThrow(KilnError);
  });

  it("has() returns correct boolean", () => {
    const registry = new IntegrationRegistry();
    registry.register(makeAdapter("cal"));
    expect(registry.has("cal")).toBe(true);
    expect(registry.has("nope")).toBe(false);
  });

  it("all() returns registered adapters", () => {
    const registry = new IntegrationRegistry();
    registry.register(makeAdapter("a"));
    registry.register(makeAdapter("b"));
    expect(registry.all()).toHaveLength(2);
  });

  describe("resolveOperation()", () => {
    it("resolves correct adapter+operation from tool name", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeAdapter("stripe", ["create_link"]));
      const resolved = registry.resolveOperation("stripe_create_link");
      expect(resolved).toBeDefined();
      expect(resolved!.adapter.provider).toBe("stripe");
      expect(resolved!.operation.name).toBe("create_link");
    });

    it("returns undefined for unknown tool name", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeAdapter("stripe", ["create_link"]));
      expect(registry.resolveOperation("unknown_tool")).toBeUndefined();
    });

    it("returns undefined for partial prefix match without operation", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeAdapter("stripe", ["create_link"]));
      expect(registry.resolveOperation("stripe_unknown")).toBeUndefined();
    });
  });

  describe("getToolDefinitions()", () => {
    it("returns tool definitions with correct naming and tags", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeAdapter("google_calendar", ["check_availability", "create_event"]));
      const defs = registry.getToolDefinitions("google_calendar");
      expect(defs).toHaveLength(2);
      expect(defs[0]!.name).toBe("google_calendar_check_availability");
      expect(defs[0]!.tags).toEqual(new Set(["integration", "google_calendar"]));
    });

    it("respects operation filter", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeAdapter("cal", ["op_a", "op_b", "op_c"]));
      const defs = registry.getToolDefinitions("cal", ["op_b"]);
      expect(defs).toHaveLength(1);
      expect(defs[0]!.name).toBe("cal_op_b");
    });

    it("returns empty for unknown provider", () => {
      const registry = new IntegrationRegistry();
      expect(registry.getToolDefinitions("nonexistent")).toEqual([]);
    });
  });

  describe("getCapabilities()", () => {
    it("returns capabilities for operations with annotations", () => {
      const registry = new IntegrationRegistry();
      const adapter: IntegrationAdapter = {
        provider: "stripe",
        version: "1.0.0",
        operations: [
          {
            name: "create_link",
            description: "Create payment link",
            inputSchema: { type: "object" },
            annotations: { readOnly: false, destructive: false, idempotent: true },
          },
          {
            name: "list_payments",
            description: "List payments",
            inputSchema: { type: "object" },
            annotations: { readOnly: true },
          },
        ],
        execute: async () => ({ data: {} }),
      };
      registry.register(adapter);

      const caps = registry.getCapabilities("stripe");
      expect(caps.size).toBe(2);
      expect(caps.get("stripe_create_link")!.annotations).toEqual({ readOnly: false, destructive: false, idempotent: true });
      expect(caps.get("stripe_list_payments")!.annotations).toEqual({ readOnly: true });
      expect(caps.get("stripe_create_link")!.tags).toEqual(["integration", "stripe"]);
    });

    it("skips operations without annotations", () => {
      const registry = new IntegrationRegistry();
      registry.register(makeAdapter("cal", ["op_a"]));
      const caps = registry.getCapabilities("cal");
      expect(caps.size).toBe(0);
    });

    it("respects operation filter", () => {
      const registry = new IntegrationRegistry();
      const adapter: IntegrationAdapter = {
        provider: "cal",
        version: "1.0.0",
        operations: [
          { name: "read", description: "Read", inputSchema: {}, annotations: { readOnly: true } },
          { name: "write", description: "Write", inputSchema: {}, annotations: { destructive: true } },
        ],
        execute: async () => ({ data: {} }),
      };
      registry.register(adapter);

      const caps = registry.getCapabilities("cal", ["read"]);
      expect(caps.size).toBe(1);
      expect(caps.has("cal_read")).toBe(true);
    });

    it("returns empty for unknown provider", () => {
      const registry = new IntegrationRegistry();
      expect(registry.getCapabilities("nope").size).toBe(0);
    });
  });
});

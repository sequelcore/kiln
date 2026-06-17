import { describe, it, expect } from "vitest";
import type { Capability } from "../../src/engine/domain/capability.js";

describe("Capability interface", () => {
  it("accepts a minimal capability", () => {
    const cap: Capability = {
      name: "memory_search",
      description: "Search memory scopes",
      schema: { type: "object", properties: { query: { type: "string" } } },
      tags: ["memory"],
    };
    expect(cap.name).toBe("memory_search");
    expect(cap.tags).toEqual(["memory"]);
  });

  it("accepts declared effect envelopes for safety policy input", () => {
    const cap: Capability = {
      name: "memory_delete",
      description: "Remove a memory entry",
      schema: { type: "object", properties: { id: { type: "string" } } },
      tags: ["memory"],
      effectEnvelope: {
        operation: "mutate",
        boundaries: ["process", "workspace"],
        reversibility: "irreversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: ["local-state"],
        idempotency: "non-idempotent",
      },
    };
    expect(cap.effectEnvelope?.operation).toBe("mutate");
    expect(cap.effectEnvelope?.consequences).toEqual(["local-state"]);
  });

  it("allows read-only declared effect envelopes", () => {
    const cap: Capability = {
      name: "cost_report",
      description: "Token usage breakdown",
      schema: {},
      tags: ["cost"],
      effectEnvelope: {
        operation: "observe",
        boundaries: ["process"],
        reversibility: "reversible",
        dataEgress: "metadata",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      },
    };
    expect(cap.effectEnvelope?.operation).toBe("observe");
    expect(cap.effectEnvelope?.idempotency).toBe("idempotent");
  });

  it("supports multiple tags", () => {
    const cap: Capability = {
      name: "verify_run",
      description: "Execute quality gates",
      schema: { type: "object" },
      tags: ["verification", "quality", "testing"],
    };
    expect(cap.tags).toHaveLength(3);
  });

  it("allows empty schema", () => {
    const cap: Capability = {
      name: "session_context",
      description: "Full session context",
      schema: {},
      tags: [],
    };
    expect(cap.schema).toEqual({});
    expect(cap.tags).toEqual([]);
  });
});

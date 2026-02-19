import { describe, it, expect } from "vitest";
import type {
  Capability,
  CapabilityAnnotations,
} from "../../src/engine/domain/capability.js";

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

  it("accepts annotations for safety policies", () => {
    const cap: Capability = {
      name: "memory_delete",
      description: "Remove a memory entry",
      schema: { type: "object", properties: { id: { type: "string" } } },
      tags: ["memory"],
      annotations: {
        destructive: true,
        readOnly: false,
        idempotent: true,
      },
    };
    expect(cap.annotations?.destructive).toBe(true);
    expect(cap.annotations?.readOnly).toBe(false);
    expect(cap.annotations?.idempotent).toBe(true);
  });

  it("allows partial annotations", () => {
    const annotations: CapabilityAnnotations = { readOnly: true };
    const cap: Capability = {
      name: "cost_report",
      description: "Token usage breakdown",
      schema: {},
      tags: ["cost"],
      annotations,
    };
    expect(cap.annotations?.readOnly).toBe(true);
    expect(cap.annotations?.destructive).toBeUndefined();
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

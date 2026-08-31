import { describe, expect, it } from "vitest";
import {
  JSON_SCHEMA_2020_12,
  compileNormalizedCapabilityJsonSchema,
  normalizeAndDigestCapabilityJsonSchema,
  validateJsonSchemaSafety,
} from "../../src/capabilities/capability-json-schema-safety.js";

interface TrapCounter {
  count: number;
}

function proxyWithReflectionTraps<T extends object>(value: T, counter: TrapCounter): T {
  return new Proxy(value, {
    getPrototypeOf() {
      counter.count += 1;
      throw new Error("getPrototypeOf must not execute");
    },
    ownKeys() {
      counter.count += 1;
      throw new Error("ownKeys must not execute");
    },
    getOwnPropertyDescriptor() {
      counter.count += 1;
      throw new Error("getOwnPropertyDescriptor must not execute");
    },
  });
}

describe("JSON Schema safety boundary", () => {
  it("rejects proxy roots and nested arrays before reflective traps run", () => {
    const objectCounter = { count: 0 };
    const objectProxy = proxyWithReflectionTraps({ type: "object" }, objectCounter);
    expect(validateJsonSchemaSafety(objectProxy, { requireObjectType: true })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(objectCounter.count).toBe(0);

    const arrayCounter = { count: 0 };
    const arrayProxy = proxyWithReflectionTraps([{ type: "string" }], arrayCounter);
    expect(validateJsonSchemaSafety({ type: "array", items: arrayProxy })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(arrayCounter.count).toBe(0);
  });

  it("compiles the normalized schema once and exposes only bounded validation diagnostics", () => {
    const source = {
      $schema: JSON_SCHEMA_2020_12,
      type: "object",
      properties: { name: { type: "string", minLength: 1 } },
      required: ["name"],
      additionalProperties: false,
    };
    const normalized = normalizeAndDigestCapabilityJsonSchema(source, "input", { requireObjectType: true });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok || !normalized.present) throw new Error("test schema was not normalized");

    const compiled = compileNormalizedCapabilityJsonSchema(normalized.value, "input", normalized.digest);
    expect(compiled.digest).toBe(normalized.digest);
    expect(compiled.validate({ name: "ready" })).toBe(true);
    expect(compiled.validate({ name: 42 })).toBe(false);
    expect(compiled.errors()).toEqual([
      expect.objectContaining({ instancePath: "/name", keyword: "type", message: "must be string" }),
    ]);
    expect(Object.keys(compiled.errors()[0] ?? {}).sort()).toEqual(["instancePath", "keyword", "message"]);
    expect(() => compileNormalizedCapabilityJsonSchema(normalized.value, "input", `sha256:${"f".repeat(64)}` as `sha256:${string}`)).toThrow(
      "does not match the expected declaration",
    );
  });

  it("rejects an unsafe schema before compilation", () => {
    expect(() => compileNormalizedCapabilityJsonSchema({
      $schema: JSON_SCHEMA_2020_12,
      type: "object",
      $ref: "https://example.invalid/secret-schema",
      additionalProperties: false,
    }, "input")).toThrow("not an admitted JSON Schema");
  });

  it("compiles repeated admitted schemas with the same $id independently", () => {
    const schema = {
      $id: "urn:kiln:test:portable-repeat",
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    } as const;
    const first = compileNormalizedCapabilityJsonSchema(schema, "input");
    const second = compileNormalizedCapabilityJsonSchema(schema, "input");
    expect(first.validate({ value: "one" })).toBe(true);
    expect(second.validate({ value: "two" })).toBe(true);
    expect(second.validate({ value: 2 })).toBe(false);
  });
});

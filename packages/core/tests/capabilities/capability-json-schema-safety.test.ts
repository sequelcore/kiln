import { describe, expect, it } from "vitest";
import { validateJsonSchemaSafety } from "../../src/capabilities/capability-json-schema-safety.js";

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
});

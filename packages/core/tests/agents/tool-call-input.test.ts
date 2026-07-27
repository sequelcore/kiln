import { describe, it, expect } from "vitest";
import type { ToolCall } from "../../src/agents/index.js";
import {
  SYNTHETIC_TOOL_CALL_ID_PREFIX,
  buildSyntheticToolCallId,
  assertValidToolCallIds,
} from "../../src/agents/tool-call-input.js";

function toolCall(id: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return { id, name: "read", input: {}, ...overrides };
}

describe("buildSyntheticToolCallId", () => {
  it("joins coordinates behind the versioned synthetic prefix", () => {
    expect(buildSyntheticToolCallId("resp_1", "0")).toBe(`${SYNTHETIC_TOOL_CALL_ID_PREFIX}resp_1:0`);
    expect(buildSyntheticToolCallId("a", "b", "c")).toBe(`${SYNTHETIC_TOOL_CALL_ID_PREFIX}a:b:c`);
  });

  it("is deterministic for identical coordinates", () => {
    expect(buildSyntheticToolCallId("resp_1", "2")).toBe(buildSyntheticToolCallId("resp_1", "2"));
  });

  it("produces distinct ids for distinct coordinates", () => {
    expect(buildSyntheticToolCallId("resp_1", "0")).not.toBe(buildSyntheticToolCallId("resp_1", "1"));
    expect(buildSyntheticToolCallId("resp_1", "0")).not.toBe(buildSyntheticToolCallId("resp_2", "0"));
  });
});

describe("assertValidToolCallIds", () => {
  it("accepts a collection of trimmed, unique, non-empty ids", () => {
    expect(() => assertValidToolCallIds(
      [toolCall("call_1"), toolCall("call_2")],
      { adapter: "test-adapter" },
    )).not.toThrow();
  });

  it("rejects a blank id", () => {
    expect(() => assertValidToolCallIds(
      [toolCall("")],
      { adapter: "test-adapter" },
    )).toThrow(/blank tool call id/);
  });

  it("rejects a whitespace-only id", () => {
    expect(() => assertValidToolCallIds(
      [toolCall("   ")],
      { adapter: "test-adapter" },
    )).toThrow(/blank tool call id/);
  });

  it("rejects duplicate ids within the same collection", () => {
    expect(() => assertValidToolCallIds(
      [toolCall("call_1"), toolCall("call_1")],
      { adapter: "test-adapter" },
    )).toThrow(/duplicate tool call id/);
  });

  it("rejects two blank ids rather than silently collapsing them (no dedupe-by-blank)", () => {
    // Two missing-id calls must not be treated as "the same call" -- assert throws
    // instead of allowing a downstream consumer to collapse them.
    expect(() => assertValidToolCallIds(
      [toolCall(""), toolCall("")],
      { adapter: "test-adapter" },
    )).toThrow(/blank tool call id/);
  });

  it("throws a KilnError with adapter/index/id context on blank ids", async () => {
    const { KilnError } = await import("../../src/engine/errors.js");
    try {
      assertValidToolCallIds([toolCall("ok"), toolCall("")], { adapter: "test-adapter" });
      expect.unreachable("expected assertValidToolCallIds to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(KilnError);
      expect((error as InstanceType<typeof KilnError>).code).toBe("TOOL_CALL_IDENTITY_INVALID");
      expect((error as InstanceType<typeof KilnError>).context).toMatchObject({
        adapter: "test-adapter",
        index: 1,
      });
    }
  });

  it("throws a KilnError with adapter/index/priorIndex/id context on duplicate ids", async () => {
    const { KilnError } = await import("../../src/engine/errors.js");
    try {
      assertValidToolCallIds([toolCall("dup"), toolCall("dup")], { adapter: "test-adapter" });
      expect.unreachable("expected assertValidToolCallIds to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(KilnError);
      expect((error as InstanceType<typeof KilnError>).code).toBe("TOOL_CALL_IDENTITY_INVALID");
      expect((error as InstanceType<typeof KilnError>).context).toMatchObject({
        adapter: "test-adapter",
        index: 1,
        priorIndex: 0,
        id: "dup",
      });
    }
  });

  it("detects legacy persisted blank/duplicate identities rather than silently rewriting them", () => {
    // Simulates a persisted transcript record hydrated with the historical bug (blank id).
    const legacyPersisted: readonly ToolCall[] = [
      { id: "", name: "read", input: { filePath: "a.txt" } },
    ];
    expect(() => assertValidToolCallIds(legacyPersisted, { adapter: "rehydrated-transcript" })).toThrow(
      /blank tool call id/,
    );
  });

  it("survives a JSON serialize/deserialize round trip with identity unchanged", () => {
    const original: readonly ToolCall[] = [toolCall("call_1"), toolCall("call_2")];
    const roundTripped = JSON.parse(JSON.stringify(original)) as ToolCall[];
    expect(roundTripped).toEqual(original);
    expect(() => assertValidToolCallIds(roundTripped, { adapter: "test-adapter" })).not.toThrow();
  });
});

import { describe, it, expect, vi } from "vitest";
import { validateJsonSchema, validateOutput, withGuardrail } from "../../src/orchestrator/guardrails.js";
import { KilnError } from "../../src/engine/errors.js";

describe("validateJsonSchema", () => {
  describe("type checking", () => {
    it("validates string type", () => {
      expect(validateJsonSchema("hello", { type: "string" }).passed).toBe(true);
      expect(validateJsonSchema(123, { type: "string" }).passed).toBe(false);
    });

    it("validates number type", () => {
      expect(validateJsonSchema(42, { type: "number" }).passed).toBe(true);
      expect(validateJsonSchema("42", { type: "number" }).passed).toBe(false);
    });

    it("validates integer type", () => {
      expect(validateJsonSchema(42, { type: "integer" }).passed).toBe(true);
      expect(validateJsonSchema(3.14, { type: "integer" }).passed).toBe(false);
    });

    it("validates boolean type", () => {
      expect(validateJsonSchema(true, { type: "boolean" }).passed).toBe(true);
      expect(validateJsonSchema("true", { type: "boolean" }).passed).toBe(false);
    });

    it("validates object type", () => {
      expect(validateJsonSchema({}, { type: "object" }).passed).toBe(true);
      expect(validateJsonSchema([], { type: "object" }).passed).toBe(false);
      expect(validateJsonSchema(null, { type: "object" }).passed).toBe(false);
    });

    it("validates array type", () => {
      expect(validateJsonSchema([], { type: "array" }).passed).toBe(true);
      expect(validateJsonSchema({}, { type: "array" }).passed).toBe(false);
    });

    it("validates null type", () => {
      expect(validateJsonSchema(null, { type: "null" }).passed).toBe(true);
      expect(validateJsonSchema(undefined, { type: "null" }).passed).toBe(false);
    });
  });

  describe("enum", () => {
    it("passes for value in enum", () => {
      const result = validateJsonSchema("active", { enum: ["active", "inactive"] });
      expect(result.passed).toBe(true);
    });

    it("fails for value not in enum", () => {
      const result = validateJsonSchema("unknown", { enum: ["active", "inactive"] });
      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain("must be one of");
    });
  });

  describe("string constraints", () => {
    it("validates minLength", () => {
      expect(validateJsonSchema("ab", { type: "string", minLength: 2 }).passed).toBe(true);
      expect(validateJsonSchema("a", { type: "string", minLength: 2 }).passed).toBe(false);
    });

    it("validates maxLength", () => {
      expect(validateJsonSchema("ab", { type: "string", maxLength: 3 }).passed).toBe(true);
      expect(validateJsonSchema("abcd", { type: "string", maxLength: 3 }).passed).toBe(false);
    });
  });

  describe("number constraints", () => {
    it("validates minimum", () => {
      expect(validateJsonSchema(5, { type: "number", minimum: 5 }).passed).toBe(true);
      expect(validateJsonSchema(4, { type: "number", minimum: 5 }).passed).toBe(false);
    });

    it("validates maximum", () => {
      expect(validateJsonSchema(10, { type: "number", maximum: 10 }).passed).toBe(true);
      expect(validateJsonSchema(11, { type: "number", maximum: 10 }).passed).toBe(false);
    });
  });

  describe("required properties", () => {
    it("passes when all required present", () => {
      const result = validateJsonSchema(
        { name: "test", age: 25 },
        { type: "object", required: ["name", "age"] },
      );
      expect(result.passed).toBe(true);
    });

    it("fails when required property missing", () => {
      const result = validateJsonSchema(
        { name: "test" },
        { type: "object", required: ["name", "age"] },
      );
      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain("age");
    });
  });

  describe("nested properties", () => {
    it("validates nested object properties", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number" },
        },
      };
      expect(validateJsonSchema({ name: "test", count: 5 }, schema).passed).toBe(true);
      expect(validateJsonSchema({ name: "test", count: "five" }, schema).passed).toBe(false);
    });

    it("skips validation for absent optional properties", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          optional: { type: "number" },
        },
      };
      expect(validateJsonSchema({ name: "test" }, schema).passed).toBe(true);
    });
  });

  describe("array items", () => {
    it("validates array items against schema", () => {
      const schema = {
        type: "array",
        items: { type: "number" },
      };
      expect(validateJsonSchema([1, 2, 3], schema).passed).toBe(true);
      expect(validateJsonSchema([1, "two", 3], schema).passed).toBe(false);
    });
  });

  describe("depth limit", () => {
    it("stops validating beyond depth 5", () => {
      const deepSchema = {
        type: "object",
        properties: {
          a: {
            type: "object",
            properties: {
              b: {
                type: "object",
                properties: {
                  c: {
                    type: "object",
                    properties: {
                      d: {
                        type: "object",
                        properties: {
                          e: {
                            type: "object",
                            properties: {
                              f: { type: "string" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
      // Value at depth 6 is wrong type but validation stops at depth 5
      const deepValue = { a: { b: { c: { d: { e: { f: 123 } } } } } };
      const result = validateJsonSchema(deepValue, deepSchema);
      expect(result.passed).toBe(true);
    });
  });

  describe("error messages", () => {
    it("includes path in error messages", () => {
      const schema = {
        type: "object",
        properties: {
          nested: {
            type: "object",
            properties: {
              value: { type: "string" },
            },
          },
        },
      };
      const result = validateJsonSchema({ nested: { value: 42 } }, schema);
      expect(result.errors[0]).toContain("$.nested.value");
    });

    it("provides retry feedback", () => {
      const result = validateJsonSchema(42, { type: "string" });
      expect(result.retryFeedback).toBeDefined();
      expect(result.retryFeedback).toContain("Validation failed");
    });
  });
});

describe("validateOutput", () => {
  it("delegates to validateJsonSchema", () => {
    const result = validateOutput({ name: "test" }, { type: "object", required: ["name"] });
    expect(result.passed).toBe(true);
  });
});

describe("withGuardrail", () => {
  it("returns result when validation passes on first try", async () => {
    const handler = vi.fn(async () => ({ status: "ok" }));
    const schema = { type: "object", required: ["status"] };

    const result = await withGuardrail(handler, schema);
    expect(result).toEqual({ status: "ok" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("retries with feedback when validation fails", async () => {
    let callCount = 0;
    const handler = vi.fn(async (_feedback?: string) => {
      callCount++;
      if (callCount === 1) {
        return "not-an-object"; // fails validation
      }
      return { status: "fixed" }; // passes on retry
    });

    const onRetry = vi.fn();
    const schema = { type: "object", required: ["status"] };

    const result = await withGuardrail(handler, schema, 3, onRetry);
    expect(result).toEqual({ status: "fixed" });
    expect(callCount).toBe(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("throws KilnError after exhausting retries", async () => {
    const handler = vi.fn(async () => "always-wrong");
    const schema = { type: "object" };

    await expect(withGuardrail(handler, schema, 2)).rejects.toThrow(KilnError);
    expect(handler).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("passes feedback to handler on retry", async () => {
    const feedbacks: (string | undefined)[] = [];
    let callCount = 0;
    const handler = vi.fn(async (feedback?: string) => {
      feedbacks.push(feedback);
      callCount++;
      if (callCount < 3) return "bad";
      return { ok: true };
    });

    const schema = { type: "object" };
    await withGuardrail(handler, schema, 3);

    expect(feedbacks[0]).toBeUndefined(); // first call has no feedback
    expect(feedbacks[1]).toBeDefined(); // second call has feedback
    expect(feedbacks[1]).toContain("Validation failed");
  });
});

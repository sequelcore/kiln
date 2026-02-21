// Tests for parseDatasetJsonl

import { describe, it, expect } from "vitest";
import { parseDatasetJsonl } from "../../src/eval/dataset-loader.js";
import { KilnError } from "../../src/engine/errors.js";

describe("parseDatasetJsonl", () => {
  it("parses valid JSONL correctly", () => {
    const content = `{"id": "1", "input": "question 1", "expected": "answer 1"}
{"id": "2", "input": "question 2", "context": ["ctx1", "ctx2"]}`;
    const result = parseDatasetJsonl("test", content);
    expect(result.name).toBe("test");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.id).toBe("1");
    expect(result.items[0]?.input).toBe("question 1");
    expect(result.items[0]?.expected).toBe("answer 1");
    expect(result.items[1]?.context).toEqual(["ctx1", "ctx2"]);
  });

  it("throws EVAL_DATASET_NOT_FOUND for empty content", () => {
    expect(() => parseDatasetJsonl("test", "")).toThrow(KilnError);
    try {
      parseDatasetJsonl("test", "");
    } catch (e) {
      expect((e as KilnError).code).toBe("EVAL_DATASET_NOT_FOUND");
    }
  });

  it("throws with line number for invalid JSON", () => {
    expect(() => parseDatasetJsonl("test", '{"id": "1", "input": "q"}\ninvalid json')).toThrow(KilnError);
    try {
      parseDatasetJsonl("test", '{"id": "1", "input": "q"}\ninvalid json');
    } catch (e) {
      expect((e as KilnError).code).toBe("EVAL_DATASET_INVALID");
      expect((e as KilnError).message).toContain("line 2");
    }
  });

  it("skips comment lines and blank lines", () => {
    const content = `# comment
{"id": "1", "input": "q1"}

// another comment
{"id": "2", "input": "q2"}`;
    const result = parseDatasetJsonl("test", content);
    expect(result.items).toHaveLength(2);
  });

  it("throws for duplicate IDs", () => {
    const content = `{"id": "dup", "input": "q1"}
{"id": "dup", "input": "q2"}`;
    expect(() => parseDatasetJsonl("test", content)).toThrow(KilnError);
    try {
      parseDatasetJsonl("test", content);
    } catch (e) {
      expect((e as KilnError).code).toBe("EVAL_DATASET_INVALID");
      expect((e as KilnError).message).toContain("Duplicate id");
    }
  });

  it("throws for missing id field", () => {
    expect(() => parseDatasetJsonl("test", '{"input": "q"}')).toThrow(KilnError);
    try {
      parseDatasetJsonl("test", '{"input": "q"}');
    } catch (e) {
      expect((e as KilnError).code).toBe("EVAL_DATASET_INVALID");
      expect((e as KilnError).message).toContain('"id"');
    }
  });

  it("throws for missing input field", () => {
    expect(() => parseDatasetJsonl("test", '{"id": "1"}')).toThrow(KilnError);
    try {
      parseDatasetJsonl("test", '{"id": "1"}');
    } catch (e) {
      expect((e as KilnError).code).toBe("EVAL_DATASET_INVALID");
      expect((e as KilnError).message).toContain('"input"');
    }
  });
});

import { describe, expect, it } from "vitest";
import { normalizeTaskShapeKey } from "../../src/memory/task-shape.js";

describe("normalizeTaskShapeKey", () => {
  it("normalizes text to a kebab-case key", () => {
    expect(normalizeTaskShapeKey("  Build API + UI  ")).toBe("build-api-ui");
  });

  it("respects max length", () => {
    expect(normalizeTaskShapeKey("a".repeat(120), 10)).toBe("aaaaaaaaaa");
  });

  it("falls back to interactive for empty input", () => {
    expect(normalizeTaskShapeKey("___", 10)).toBe("interactive");
  });
});

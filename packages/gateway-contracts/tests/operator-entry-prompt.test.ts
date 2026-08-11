import { describe, expect, it } from "vitest";
import { OPERATOR_ENTRY_PROMPT } from "../src/operator-entry-prompt.js";

describe("operator entry prompt", () => {
  it("provides one stable task-oriented prompt across operator surfaces", () => {
    expect(OPERATOR_ENTRY_PROMPT).toBe("What should Kiln work on?");
  });
});

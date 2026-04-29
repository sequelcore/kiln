import { describe, expect, it } from "vitest";
import {
  OPERATOR_EMPTY_STATE_PHRASES,
  operatorEmptyStatePhraseAt,
} from "../src/operator-empty-state.js";

describe("operator empty state copy", () => {
  it("keeps a shared cyberpunk Kiln phrase catalog", () => {
    expect(OPERATOR_EMPTY_STATE_PHRASES).toHaveLength(10);
    expect(OPERATOR_EMPTY_STATE_PHRASES).toContain("Job's live. Run it clean.");
    expect(OPERATOR_EMPTY_STATE_PHRASES).toContain("No masters in the loop. Ship it.");
  });

  it("selects phrases by normalized index", () => {
    expect(operatorEmptyStatePhraseAt(0)).toBe("Job's live. Run it clean.");
    expect(operatorEmptyStatePhraseAt(10)).toBe("Job's live. Run it clean.");
    expect(operatorEmptyStatePhraseAt(-1)).toBe("Signal's hot. Take control.");
    expect(operatorEmptyStatePhraseAt(Number.NaN)).toBe("Job's live. Run it clean.");
  });
});

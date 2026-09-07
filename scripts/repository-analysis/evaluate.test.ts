import { expect, test } from "vitest";
import { lexicalKeys, scoreLocations } from "./evaluate.js";

test("scorer penalizes missed aliases and false same-spelling references", () => {
  expect(scoreLocations(["declaration", "comment"], ["declaration", "alias"])).toEqual({
    precision: 0.5,
    recall: 0.5,
    falsePositives: ["comment"],
    falseNegatives: ["alias"],
  });
  expect(scoreLocations([], ["declaration"]).recall).toBe(0);
});

test("empty direct-reference oracle accepts absence but penalizes invented test impact", () => {
  expect(scoreLocations([], [])).toEqual({ precision: 1, recall: 1, falsePositives: [], falseNegatives: [] });
  expect(scoreLocations(["indirect-test"], [])).toEqual({
    precision: 0,
    recall: 1,
    falsePositives: ["indirect-test"],
    falseNegatives: [],
  });
});

test("rg UTF-8 byte offsets become UTF-16 coordinates", () => {
  const output = JSON.stringify({
    type: "match",
    data: {
      path: { text: "a.ts" },
      lines: { text: "😀 score\n" },
      line_number: 2,
      submatches: [{ start: 5, end: 10 }],
    },
  });
  expect(lexicalKeys(output)).toEqual(["a.ts:1:3:5"]);
  expect(() => lexicalKeys(JSON.stringify({ type: "match", data: {} }))).toThrow();
});

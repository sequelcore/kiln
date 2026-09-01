import { describe, expect, it } from "bun:test";
import { normalizeRelativeSourcePath } from "../src/normalize.js";

describe("normalizeRelativeSourcePath", () => {
  it("normalizes safe repository-relative source paths", () => {
    expect(normalizeRelativeSourcePath("./src\\domain//order.ts")).toBe("src/domain/order.ts");
    expect(normalizeRelativeSourcePath("src///index.ts")).toBe("src/index.ts");
  });

  it.each(["", "/etc/passwd", "C:\\private\\file.ts", "src/../secret.ts", "../outside.ts"])(
    "rejects unsafe input %s",
    (input) => {
      expect(() => normalizeRelativeSourcePath(input)).toThrow("safe repository-relative source path");
    },
  );
});

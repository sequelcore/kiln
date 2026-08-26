import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ASSETS = [
  {
    path: "../src/assets/verification-engines/dafny.svg",
    sha256: "4d840c4f4120d4d3f7dafd8ac2705bf8dc129729aaff05d0866196f9fe7335d8",
  },
  {
    path: "../src/assets/verification-engines/gentle-ai.png",
    sha256: "e80b71af4449a14b6458c336addcd425f1448e1e2dc1ca29149965e76dd2efcf",
  },
] as const;

describe("verification engine assets", () => {
  it.each(ASSETS)("keeps the attributed $path bytes pinned", ({ path, sha256 }) => {
    const bytes = readFileSync(fileURLToPath(new URL(path, import.meta.url)));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });

  it("keeps the Dafny SVG self-contained", () => {
    const svg = readFileSync(fileURLToPath(new URL(ASSETS[0].path, import.meta.url)), "utf8");
    expect(svg).not.toMatch(/<script|<foreignObject|(?:href|xlink:href)\s*=/iu);
  });
});

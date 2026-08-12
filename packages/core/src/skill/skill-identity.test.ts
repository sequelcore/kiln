import { describe, expect, it } from "vitest";
import { canonicalSkillIdentity, digestSkillPackage } from "./skill-identity.js";

describe("skill identity", () => {
  it("uses one portable lowercase identity on every operating system", () => {
    expect(canonicalSkillIdentity("BuildTools")).toBe("buildtools");
  });

  it("digests sorted normalized paths and bytes for the complete package", () => {
    const first = digestSkillPackage([
      { path: "refs\\guide.md", content: Buffer.from("guide") },
      { path: "SKILL.md", content: Buffer.from("skill") },
    ]);
    const reordered = digestSkillPackage([
      { path: "SKILL.md", content: Buffer.from("skill") },
      { path: "refs/guide.md", content: Buffer.from("guide") },
    ]);
    const changedAsset = digestSkillPackage([
      { path: "SKILL.md", content: Buffer.from("skill") },
      { path: "refs/guide.md", content: Buffer.from("changed") },
    ]);
    expect(first).toBe(reordered);
    expect(first).not.toBe(changedAsset);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

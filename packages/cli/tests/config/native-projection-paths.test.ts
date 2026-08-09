import { describe, expect, it } from "vitest";
import {
  canonicalSkillKey,
  isSafeProjectionPathComponent,
  isSafeProjectionRelativePath,
  resolveProjectionPathWithin,
} from "../../src/config/native-projection-paths.js";

describe("native projection path safety", () => {
  it("canonicalizes skill keys only for Windows semantics", () => {
    expect(canonicalSkillKey("BuildTools", "win32")).toBe("buildtools");
    expect(canonicalSkillKey("BuildTools", "linux")).toBe("BuildTools");
  });

  it("rejects unsafe skill path components", () => {
    for (const name of ["", ".", "..", "../escape", "nested/name", "nested\\name", "C:escape", "CON", "report."]) {
      expect(isSafeProjectionPathComponent(name, "win32"), name).toBe(false);
    }
    expect(isSafeProjectionPathComponent("BuildTools", "win32")).toBe(true);
    expect(isSafeProjectionPathComponent("report.md", "win32")).toBe(true);
  });

  it("allows only safe relative resource paths", () => {
    expect(isSafeProjectionRelativePath("docs/guide.md", "win32")).toBe(true);
    expect(isSafeProjectionRelativePath("../escape.md", "win32")).toBe(false);
    expect(isSafeProjectionRelativePath("C:/escape.md", "win32")).toBe(false);
    expect(isSafeProjectionRelativePath("docs/../escape.md", "win32")).toBe(false);
  });

  it("resolves candidates only below the harness root", () => {
    expect(resolveProjectionPathWithin("C:/home/.codex/skills", "C:/home/.codex/skills", "win32"))
      .toBeUndefined();
    expect(resolveProjectionPathWithin("C:/home/.codex/skills", "C:/home/.codex/skills/build/SKILL.md", "win32"))
      .toBe("C:/home/.codex/skills/build/SKILL.md");
    expect(resolveProjectionPathWithin("C:/home/.codex/skills", "C:/home/.codex/escape.md", "win32"))
      .toBeUndefined();
  });
});

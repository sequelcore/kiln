import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSkillMd, parseSkillMdIndex, loadSkillMd, loadSkillMdIndex, SkillMdError } from "../../src/skill/md-parser.js";

const fullSkillMd = `---
name: code-review
description: Automated code review skill
tools:
  - read_file
  - search_code
triggers:
  - event: task_started
    filter:
      phase: review
tags:
  - review
  - quality
handler: handlers/code-review.ts
---

# Code Review Skill

Review the code for quality issues.

## Checklist
1. Check for logic errors
2. Verify error handling
`;

const minimalSkillMd = `---
name: summarizer
description: Summarizes content
---

Summarize the provided content.
`;

describe("parseSkillMd", () => {
  it("parses full SKILL.md with all frontmatter fields", () => {
    const config = parseSkillMd(fullSkillMd);
    expect(config.name).toBe("code-review");
    expect(config.description).toBe("Automated code review skill");
    expect(config.tools).toEqual(["read_file", "search_code"]);
    expect(config.triggers).toHaveLength(1);
    expect(config.triggers[0]!.event).toBe("task_started");
    expect(config.triggers[0]!.filter).toEqual({ phase: "review" });
    expect(config.tags).toEqual(["review", "quality"]);
    expect(config.handler).toBe("handlers/code-review.ts");
    expect(config.instructions).toContain("# Code Review Skill");
    expect(config.instructions).toContain("Check for logic errors");
  });

  it("parses minimal SKILL.md with defaults", () => {
    const config = parseSkillMd(minimalSkillMd);
    expect(config.name).toBe("summarizer");
    expect(config.description).toBe("Summarizes content");
    expect(config.tools).toEqual([]);
    expect(config.triggers).toEqual([]);
    expect(config.tags).toEqual([]);
    expect(config.handler).toBeUndefined();
    expect(config.instructions).toBe("Summarize the provided content.");
  });

  it("throws SkillMdError for missing frontmatter", () => {
    expect(() => parseSkillMd("# No frontmatter")).toThrow(SkillMdError);
  });

  it("throws SkillMdError for missing name", () => {
    const md = `---
description: Has desc
---

Body here.
`;
    expect(() => parseSkillMd(md)).toThrow(SkillMdError);
  });

  it("throws SkillMdError for missing description", () => {
    const md = `---
name: test
---

Body here.
`;
    expect(() => parseSkillMd(md)).toThrow(SkillMdError);
  });

  it("throws SkillMdError for empty body", () => {
    const md = `---
name: test
description: Test skill
---
`;
    expect(() => parseSkillMd(md)).toThrow(SkillMdError);
  });

  it("throws SkillMdError for unknown event type in trigger", () => {
    const md = `---
name: test
description: Test skill
triggers:
  - event: unknown_event_xyz
---

Body here.
`;
    try {
      parseSkillMd(md);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillMdError);
      expect((err as SkillMdError).errors.some((e) => e.field.includes("triggers[0].event"))).toBe(true);
    }
  });

  it("accepts known event types in triggers", () => {
    const md = `---
name: test
description: Test skill
triggers:
  - event: task_started
  - event: task_completed
  - event: tool_called
---

Body here.
`;
    const config = parseSkillMd(md);
    expect(config.triggers).toHaveLength(3);
  });

  it("includes filePath in error when provided", () => {
    try {
      parseSkillMd("# No frontmatter", "skills/bad.md");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillMdError);
      expect((err as SkillMdError).filePath).toBe("skills/bad.md");
    }
  });

  it("SkillMdError has correct code", () => {
    try {
      parseSkillMd("# No frontmatter");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillMdError);
      expect((err as SkillMdError).code).toBe("SKILL_MD_INVALID");
    }
  });

  it("handles frontmatter with only one delimiter", () => {
    const md = `---
name: test
description: incomplete
`;
    expect(() => parseSkillMd(md)).toThrow(SkillMdError);
  });

  it("rejects non-string tools items", () => {
    const md = `---
name: test
description: Test
tools:
  - 123
---

Body.
`;
    expect(() => parseSkillMd(md)).toThrow(SkillMdError);
  });

  it("rejects non-array triggers", () => {
    const md = `---
name: test
description: Test
triggers: not-array
---

Body.
`;
    expect(() => parseSkillMd(md)).toThrow(SkillMdError);
  });

  it("trigger without filter has no filter property", () => {
    const md = `---
name: test
description: Test
triggers:
  - event: task_started
---

Body.
`;
    const config = parseSkillMd(md);
    expect(config.triggers[0]!.filter).toBeUndefined();
  });
});

describe("parseSkillMdIndex", () => {
  it("parses only frontmatter, ignores body", () => {
    const index = parseSkillMdIndex(fullSkillMd);
    expect(index.name).toBe("code-review");
    expect(index.description).toBe("Automated code review skill");
    expect(index.tools).toEqual(["read_file", "search_code"]);
    expect("instructions" in index).toBe(false);
  });

  it("throws for missing frontmatter", () => {
    expect(() => parseSkillMdIndex("# No frontmatter")).toThrow(SkillMdError);
  });

  it("throws for missing required fields", () => {
    const md = `---
name: test
---

Body.
`;
    expect(() => parseSkillMdIndex(md)).toThrow(SkillMdError);
  });
});

describe("loadSkillMd", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-skill-md-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads and parses SKILL.md from disk", () => {
    const filePath = join(tmpDir, "SKILL.md");
    writeFileSync(filePath, minimalSkillMd, "utf-8");

    const config = loadSkillMd(filePath);
    expect(config.name).toBe("summarizer");
    expect(config.filePath).toBe(filePath);
    expect(config.instructions).toBe("Summarize the provided content.");
  });

  it("throws for non-existent file", () => {
    expect(() => loadSkillMd(join(tmpDir, "missing.md"))).toThrow();
  });

  it("throws SkillMdError for invalid content", () => {
    const filePath = join(tmpDir, "bad.md");
    writeFileSync(filePath, "# No frontmatter", "utf-8");
    expect(() => loadSkillMd(filePath)).toThrow(SkillMdError);
  });
});

describe("loadSkillMdIndex", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-skill-idx-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads index only from disk", () => {
    const filePath = join(tmpDir, "SKILL.md");
    writeFileSync(filePath, fullSkillMd, "utf-8");

    const index = loadSkillMdIndex(filePath);
    expect(index.name).toBe("code-review");
    expect(index.filePath).toBe(filePath);
    expect("instructions" in index).toBe(false);
  });
});

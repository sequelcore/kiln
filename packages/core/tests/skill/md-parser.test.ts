import { describe, it, expect } from "vitest";
import { parseSkillMd, parseSkillMdIndex, SkillMdError } from "../../src/skill/md-parser.js";

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

const portableSkillMd = `---
name: portable-review
description: Reviews portable agent skill packages. Use when validating a skill before admission.
license: Apache-2.0
compatibility: Requires a filesystem-backed Agent Skills host.
metadata:
  author: kiln
  version: "1.2.0"
---

Review the complete package before admission.
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

  it("preserves portable Agent Skills package metadata", () => {
    const config = parseSkillMd(portableSkillMd);
    expect(config.license).toBe("Apache-2.0");
    expect(config.compatibility).toBe("Requires a filesystem-backed Agent Skills host.");
    expect(config.metadata).toEqual({ author: "kiln", version: "1.2.0" });
  });

  it("rejects invalid portable metadata and compatibility limits", () => {
    expect(() => parseSkillMd(`---\nname: valid-name\ndescription: Valid description\ncompatibility: ${"x".repeat(501)}\nmetadata:\n  version:\n    nested: invalid\n---\n\nBody.`))
      .toThrow(SkillMdError);
  });

  it("preserves host-extension metadata primitives for later compatibility inspection", () => {
    const parsed = parseSkillMd(`---\nname: host-extension\ndescription: Host extension\nmetadata:\n  opencode/autoinvoke: false\n---\n\nBody.`);
    expect(parsed.metadata).toEqual({ "opencode/autoinvoke": "false" });
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { SkillGenerator, SkillRegistry } from "@kilnai/core/skill";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill generated from a session
tools:
  - read_file
  - write_file
tags:
  - testing
  - example
---

# Test Skill

This skill captures the key technique demonstrated.
Step 1: Analyze the codebase.
Step 2: Apply the fix.
Step 3: Verify the result.
`;

const mockProvider = (): ProviderAdapter => {
  const parts = [{ type: "text" as const, text: VALID_SKILL_MD }];
  return {
    name: "mock",
    createMessage: vi.fn<() => Promise<{
      parts: readonly { type: "text"; text: string }[];
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      toolCalls: readonly never[];
      stopReason: string;
    }>>().mockResolvedValue({
      parts,
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "end_turn",
    }),
    streamMessage: vi.fn(),
  };
};

describe("SkillGenerator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-sg-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("maybeGenerate", () => {
    it("returns false when complexity < threshold", async () => {
      const provider = mockProvider();
      const registry = new SkillRegistry();
      const generator = new SkillGenerator({
        provider,
        registry,
        skillsDir: join(tmpDir, "skills"),
        complexityThreshold: 0.8,
      });

      const result = await generator.maybeGenerate(
        "simple task",
        "output",
        0,
        0,
      );

      expect(result).toBe(false);
      expect(provider.createMessage).not.toHaveBeenCalled();
    });

    it("calls provider.createMessage when complexity >= threshold", async () => {
      const provider = mockProvider();
      const registry = new SkillRegistry();
      const generator = new SkillGenerator({
        provider,
        registry,
        skillsDir: join(tmpDir, "skills"),
        complexityThreshold: 0.1,
      });

      await generator.maybeGenerate(
        "Analyze the codebase architecture and explain how the components interact",
        "The codebase uses a modular architecture with...",
        3,
        5,
      );

      expect(provider.createMessage).toHaveBeenCalledOnce();
      const call = vi.mocked(provider.createMessage).mock.calls[0]![0];
      expect(call.system).toContain("skill extractor");
      expect(call.maxTokens).toBe(1024);
    });

    it("returns false when LLM output has no frontmatter", async () => {
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockResolvedValue({
          parts: [{ type: "text" as const, text: "No frontmatter here" }],
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
        streamMessage: vi.fn(),
      };
      const registry = new SkillRegistry();
      const generator = new SkillGenerator({
        provider,
        registry,
        skillsDir: join(tmpDir, "skills"),
        complexityThreshold: 0.1,
      });

      const result = await generator.maybeGenerate(
        "Analyze the codebase",
        "detailed output summary",
        2,
        3,
      );

      expect(result).toBe(false);
    });

    it("writes file and returns true on valid SKILL.md output", async () => {
      const provider = mockProvider();
      const registry = new SkillRegistry();
      const skillsDir = join(tmpDir, "skills");
      const generator = new SkillGenerator({
        provider,
        registry,
        skillsDir,
        complexityThreshold: 0.1,
      });

      const result = await generator.maybeGenerate(
        "Analyze the codebase",
        "detailed output summary",
        2,
        3,
      );

      expect(result).toBe(true);

      const { mkdir, writeFile } = await import("node:fs/promises");
      expect(vi.mocked(mkdir)).toHaveBeenCalled();
      expect(vi.mocked(writeFile)).toHaveBeenCalledOnce();

      const skillPath = vi.mocked(writeFile).mock.calls[0]![0];
      expect(skillPath).toContain("test-skill");
      expect(skillPath).toContain("SKILL.md");
    });
  });
});

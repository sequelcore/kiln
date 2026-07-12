import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BashTool } from "../../../src/tools/infrastructure/bash-tool.js";
import { GlobTool } from "../../../src/tools/infrastructure/glob-tool.js";
import { GrepTool } from "../../../src/tools/infrastructure/grep-tool.js";
import { TreeTool } from "../../../src/tools/infrastructure/tree-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("shared output verbosity", () => {
  it("formats bash structured output without changing command metadata", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "ok\n",
      stderr: "warn\n",
    }));
    const tool = new BashTool({ commandRunner });

    const result = await tool.execute({
      name: "bash",
      input: { command: "echo ok", verbosity: "structured" },
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({
      stdout: "ok\n",
      stderr: "warn\n",
      exitCode: 0,
      timedOut: false,
      truncated: false,
    });
    expect(result.metadata).toMatchObject({
      toolName: "bash",
      kind: "command",
      command: "echo ok",
      stdout: "ok\n",
      stderr: "warn\n",
      verbosity: "structured",
    });
  });

  it("formats bash summary output from byte metadata", async () => {
    const tool = new BashTool({
      commandRunner: async () => ({
        stdout: "alpha\nbeta\n",
        stderr: "",
      }),
    });

    const result = await tool.execute({
      name: "bash",
      input: { command: "printf", verbosity: "summary" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("Command succeeded");
    expect(result.output).toContain("stdout 11 bytes");
    expect(result.metadata?.["verbosity"]).toBe("summary");
  });

  it("formats glob structured output while keeping raw as the default", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      await writeFile(join(tempDir, "src", "match.ts"), "const x = 1;\n", "utf8");
      await writeFile(join(tempDir, "src", "skip.js"), "const y = 2;\n", "utf8");

      const tool = new GlobTool({
        environmentProvider: async () => ({}),
        vendoredToolResolver: () => undefined,
      });
      const raw = await tool.execute(
        { name: "glob", input: { pattern: "**/*.ts", path: tempDir } },
        makeSandbox(tempDir),
      );
      const structured = await tool.execute(
        { name: "glob", input: { pattern: "**/*.ts", path: tempDir, verbosity: "structured" } },
        makeSandbox(tempDir),
      );

      expect(raw.output).toBe("src/match.ts");
      expect(raw.metadata?.["verbosity"]).toBe("raw");
      expect(JSON.parse(structured.output)).toEqual({
        matches: ["src/match.ts"],
        count: 1,
      });
      expect(structured.metadata).toMatchObject({
        toolName: "glob",
        kind: "search",
        strategy: "fallback",
        count: 1,
        verbosity: "structured",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("bounds broad raw glob output and asks for narrower follow-up inspection", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      const fixturePaths = Array.from(
        { length: 205 },
        (_, index) => join(tempDir, "src", `match-${String(index).padStart(3, "0")}.ts`),
      );
      await Promise.all(fixturePaths.map((path) => writeFile(path, "export {};\n", "utf8")));

      const tool = new GlobTool({
        environmentProvider: async () => ({}),
        vendoredToolResolver: () => undefined,
      });
      const result = await tool.execute(
        { name: "glob", input: { pattern: "**/*.ts", path: tempDir, verbosity: "raw" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("src/match-000.ts");
      expect(result.output).toContain("src/match-199.ts");
      expect(result.output).not.toContain("src/match-200.ts");
      expect(result.output).toContain("[glob raw output truncated: showing 200 of 205 matches.");
      expect(result.output).toContain("read concrete files before using this as evidence");
      expect(result.metadata).toMatchObject({
        toolName: "glob",
        kind: "search",
        strategy: "fallback",
        count: 205,
        truncated: true,
        visibleMatches: 200,
        verbosity: "raw",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("formats grep summary output without overloading grep outputMode", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "a.txt"), "one\nneedle line\nthree", "utf8");

      const tool = new GrepTool({
        commandRunner: async () => ({
          stdout: "a.txt:2:needle line\n",
          stderr: "",
        }),
        searchRuntimeProvider: async () => ({
          path: "rg-bin",
          version: "ripgrep 15.0.0",
          source: "system",
        }),
      });
      const result = await tool.execute(
        {
          name: "grep",
          input: {
            pattern: "needle",
            path: tempDir,
            outputMode: "content",
            verbosity: "summary",
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("1 content result");
      expect(result.metadata).toMatchObject({
        toolName: "grep",
        kind: "search",
        outputMode: "content",
        verbosity: "summary",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("formats tree structured output with bounded entry data", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src", "nested"), { recursive: true });
      await writeFile(join(tempDir, "src", "index.ts"), "index", "utf8");
      await writeFile(join(tempDir, "README.md"), "readme", "utf8");

      const tool = new TreeTool();
      const result = await tool.execute(
        { name: "tree", input: { path: ".", depth: 2, includeFiles: true, verbosity: "structured" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toEqual({
        root: tempDir,
        entries: [
          { name: "src", type: "directory", depth: 1 },
          { name: "nested", type: "directory", depth: 2 },
          { name: "index.ts", type: "file", depth: 2 },
          { name: "README.md", type: "file", depth: 1 },
        ],
        entryCount: 4,
        truncated: false,
      });
      expect(result.metadata?.["verbosity"]).toBe("structured");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

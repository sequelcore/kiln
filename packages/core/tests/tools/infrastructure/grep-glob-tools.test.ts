import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GlobTool } from "../../../src/tools/infrastructure/glob-tool.js";
import { GrepTool } from "../../../src/tools/infrastructure/grep-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("GrepTool", () => {
  it("uses fallback scanner when rg is unavailable", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "a.txt"), "one\nneedle line\nthree", "utf8");

      const tool = new GrepTool({
        environmentProvider: async () => ({}),
      });

      const result = await tool.execute(
        {
          name: "grep",
          input: { pattern: "needle", path: tempDir, outputMode: "content" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("a.txt:2:needle line");
      expect(result.metadata?.["strategy"]).toBe("fallback");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("uses rg fast path when available", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/file.ts:12:match here\n",
      stderr: "",
    }));
    const tool = new GrepTool({
      environmentProvider: async () => ({
        rg: { path: "rg-bin", version: "15.0.0" },
      }),
      commandRunner,
    });

    const result = await tool.execute({
      name: "grep",
      input: { pattern: "match", path: ".", outputMode: "content" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/file.ts:12:match here");
    expect(result.metadata?.["strategy"]).toBe("rg");
    expect(commandRunner).toHaveBeenCalledWith(
      "rg-bin",
      ["--no-heading", "--line-number", "match", "."],
      process.cwd(),
      30_000,
    );
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it("respects sandbox read validation for search root", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new GrepTool({
        environmentProvider: async () => ({}),
      });

      const result = await tool.execute(
        {
          name: "grep",
          input: { pattern: "needle", path: tempDir, outputMode: "content" },
        },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

describe("GlobTool", () => {
  it("uses fallback walker when fd is unavailable", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      await writeFile(join(tempDir, "src", "match.ts"), "const x = 1;\n", "utf8");
      await writeFile(join(tempDir, "src", "skip.js"), "const y = 2;\n", "utf8");

      const tool = new GlobTool({
        environmentProvider: async () => ({}),
      });

      const result = await tool.execute(
        {
          name: "glob",
          input: { pattern: "**/*.ts", path: tempDir },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("src/match.ts");
      expect(result.output).not.toContain("skip.js");
      expect(result.metadata?.["strategy"]).toBe("fallback");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("uses fd fast path when available", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/one.ts\nsrc/two.ts\n",
      stderr: "",
    }));
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "fd-bin", version: "10.0.0" },
      }),
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: { pattern: "**/*.ts", path: "." },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/one.ts");
    expect(result.metadata?.["strategy"]).toBe("fd");
    expect(commandRunner).toHaveBeenCalledWith(
      "fd-bin",
      ["--glob", "--type", "f", "**/*.ts", "."],
      process.cwd(),
      30_000,
    );
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it("treats fd exit code 1 as a no-match success", async () => {
    const commandRunner = vi.fn(
      async () =>
        await Promise.reject({
          code: 1,
          stdout: "",
          stderr: "",
          message: "no matches",
        }),
    );
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "fd-bin", version: "10.0.0" },
      }),
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: { pattern: "**/*.missing", path: "." },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toBe("");
    expect(result.metadata?.["strategy"]).toBe("fd");
    expect(result.metadata?.["noMatches"]).toBe(true);
  });

  it("respects sandbox read validation for search root", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new GlobTool({
        environmentProvider: async () => ({}),
      });

      const result = await tool.execute(
        {
          name: "glob",
          input: { pattern: "**/*.ts", path: tempDir },
        },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

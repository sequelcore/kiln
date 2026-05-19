import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReadManyTool } from "../../../src/tools/infrastructure/read-many-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("ReadManyTool", () => {
  it("returns a deterministic bounded multi-file context packet", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      await mkdir(join(tempDir, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(tempDir, "README.md"), "# Demo\n", "utf8");
      await writeFile(join(tempDir, "src", "index.ts"), "export const value = 1;\n", "utf8");
      await writeFile(join(tempDir, "src", "index.test.ts"), "test('x', () => {});\n", "utf8");
      await writeFile(join(tempDir, "src", "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
      await writeFile(join(tempDir, "node_modules", "pkg", "ignored.ts"), "ignored\n", "utf8");

      const tool = new ReadManyTool();
      const result = await tool.execute(
        {
          name: "read_many",
          input: {
            paths: ["."],
            include: ["**/*.ts", "**/*.png", "*.md"],
            exclude: ["**/*.test.ts"],
            recursive: true,
            verbosity: "structured",
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toMatchObject({
        root: tempDir,
        files: [
          { path: join(tempDir, "README.md"), content: "# Demo\n", bytes: 7, truncated: false },
          { path: join(tempDir, "src", "index.ts"), content: "export const value = 1;\n", bytes: 24, truncated: false },
        ],
        skipped: expect.arrayContaining([
          expect.objectContaining({ path: join(tempDir, "src", "index.test.ts"), reason: "excluded" }),
          expect.objectContaining({ path: join(tempDir, "src", "image.png"), reason: "binary" }),
        ]),
        fileCount: 2,
        truncated: false,
      });
      expect(result.output).not.toContain("node_modules");
      expect(result.metadata).toMatchObject({
        toolName: "read_many",
        kind: "file",
        operation: "read_many",
        fileCount: 2,
        skippedCount: expect.any(Number),
        totalBytes: 31,
        truncated: false,
        verbosity: "structured",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("respects gitignore when requested", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, ".gitignore"), "ignored.txt\n", "utf8");
      await writeFile(join(tempDir, "kept.txt"), "kept\n", "utf8");
      await writeFile(join(tempDir, "ignored.txt"), "ignored\n", "utf8");

      const tool = new ReadManyTool();
      const result = await tool.execute(
        {
          name: "read_many",
          input: {
            paths: ["."],
            recursive: true,
            respectGitIgnore: true,
            verbosity: "structured",
          },
        },
        makeSandbox(tempDir),
      );

      const output = JSON.parse(result.output);
      expect(output.files.map((file: { path: string }) => file.path)).toEqual([join(tempDir, ".gitignore"), join(tempDir, "kept.txt")]);
      expect(output.skipped).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: join(tempDir, "ignored.txt"), reason: "gitignored" }),
      ]));
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("bounds max files and max bytes with skipped-file reasons", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "a.txt"), "12345", "utf8");
      await writeFile(join(tempDir, "b.txt"), "67890", "utf8");
      await writeFile(join(tempDir, "c.txt"), "abcde", "utf8");

      const tool = new ReadManyTool();
      const result = await tool.execute(
        {
          name: "read_many",
          input: {
            paths: ["."],
            recursive: true,
            maxFiles: 2,
            maxBytes: 8,
            verbosity: "structured",
          },
        },
        makeSandbox(tempDir),
      );

      expect(JSON.parse(result.output)).toMatchObject({
        files: [
          { path: join(tempDir, "a.txt"), content: "12345", truncated: false },
          { path: join(tempDir, "b.txt"), content: "678", truncated: true },
        ],
        skipped: expect.arrayContaining([
          expect.objectContaining({ path: join(tempDir, "c.txt"), reason: "max_files" }),
        ]),
        totalBytes: 8,
        truncated: true,
      });
      expect(result.metadata).toMatchObject({
        fileCount: 2,
        totalBytes: 8,
        truncated: true,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("validates sandbox read access before reading files", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "a.txt"), "secret", "utf8");

      const tool = new ReadManyTool();
      const result = await tool.execute(
        { name: "read_many", input: { paths: ["a.txt"] } },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("");
      expect(result.metadata).toMatchObject({
        toolName: "read_many",
        skippedCount: 1,
        fileCount: 0,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("treats null include and exclude filters as omitted", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "a.txt"), "alpha", "utf8");

      const tool = new ReadManyTool();
      const result = await tool.execute(
        {
          name: "read_many",
          input: {
            paths: ["a.txt"],
            include: null,
            exclude: null,
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("alpha");
      expect(result.metadata).toMatchObject({
        toolName: "read_many",
        fileCount: 1,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

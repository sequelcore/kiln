import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StatTool } from "../../../src/tools/infrastructure/stat-tool.js";
import { TreeTool } from "../../../src/tools/infrastructure/tree-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("StatTool", () => {
  it("returns file metadata with optional sha256 hash", async () => {
    const tempDir = await makeTempDir();
    try {
      const filePath = join(tempDir, "sample.txt");
      await writeFile(filePath, "hello\n", "utf8");

      const tool = new StatTool();
      const result = await tool.execute(
        { name: "stat", input: { path: "sample.txt", hash: "sha256" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toMatchObject({
        path: filePath,
        type: "file",
        size: 6,
        hash: {
          algorithm: "sha256",
          value: "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
        },
      });
      expect(result.metadata).toMatchObject({
        toolName: "stat",
        kind: "inspection",
        operation: "stat",
        path: filePath,
        type: "file",
        size: 6,
        hashAlgorithm: "sha256",
        hash: "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("returns directory metadata without hashing", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });

      const tool = new StatTool();
      const result = await tool.execute(
        { name: "stat", input: { path: "src" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toMatchObject({
        path: join(tempDir, "src"),
        type: "directory",
      });
      expect(result.metadata).toMatchObject({
        toolName: "stat",
        kind: "inspection",
        operation: "stat",
        path: join(tempDir, "src"),
        type: "directory",
        hashAlgorithm: "none",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("respects sandbox read validation", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "sample.txt"), "hello", "utf8");

      const tool = new StatTool();
      const result = await tool.execute(
        { name: "stat", input: { path: "sample.txt" } },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

describe("TreeTool", () => {
  it("returns a deterministic bounded tree and skips nuisance directories", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src", "nested"), { recursive: true });
      await mkdir(join(tempDir, "node_modules", "pkg"), { recursive: true });
      await mkdir(join(tempDir, ".git", "objects"), { recursive: true });
      await writeFile(join(tempDir, "src", "nested", "deep.ts"), "deep", "utf8");
      await writeFile(join(tempDir, "src", "index.ts"), "index", "utf8");
      await writeFile(join(tempDir, "README.md"), "readme", "utf8");
      await writeFile(join(tempDir, "node_modules", "pkg", "ignored.js"), "ignored", "utf8");

      const tool = new TreeTool();
      const result = await tool.execute(
        { name: "tree", input: { path: ".", depth: 2, includeFiles: true } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe([
        ".",
        "src/",
        "  nested/",
        "  index.ts",
        "README.md",
      ].join("\n"));
      expect(result.output).not.toContain("node_modules");
      expect(result.output).not.toContain(".git");
      expect(result.output).not.toContain("deep.ts");
      expect(result.metadata).toMatchObject({
        toolName: "tree",
        kind: "inspection",
        operation: "tree",
        path: tempDir,
        depth: 2,
        includeFiles: true,
        entryCount: 4,
        truncated: false,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("can return directory-only orientation", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src", "nested"), { recursive: true });
      await writeFile(join(tempDir, "src", "index.ts"), "index", "utf8");
      await writeFile(join(tempDir, "README.md"), "readme", "utf8");

      const tool = new TreeTool();
      const result = await tool.execute(
        { name: "tree", input: { path: ".", depth: 3, includeFiles: false } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe([
        ".",
        "src/",
        "  nested/",
      ].join("\n"));
      expect(result.metadata).toMatchObject({
        includeFiles: false,
        entryCount: 2,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("includes bounded path samples in summary output", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "packages", "gui"), { recursive: true });
      await mkdir(join(tempDir, "packages", "runtime"), { recursive: true });
      await writeFile(join(tempDir, "packages", "gui", "package.json"), "{}", "utf8");

      const tool = new TreeTool();
      const result = await tool.execute(
        { name: "tree", input: { path: ".", depth: 3, includeFiles: true, verbosity: "summary" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("packages/");
      expect(result.output).toContain("gui/");
      expect(result.output).toContain("package.json");
      expect(result.metadata).toMatchObject({
        verbosity: "summary",
        entryCount: 4,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("respects sandbox read validation for the root", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new TreeTool();
      const result = await tool.execute(
        { name: "tree", input: { path: "." } },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

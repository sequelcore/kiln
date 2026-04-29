import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PatchTool } from "../../../src/tools/infrastructure/patch-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("PatchTool", () => {
  it("applies add, update, delete, and move operations in one patch", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "existing.txt"), "alpha\nunchanged\n", "utf8");
      await writeFile(join(tempDir, "delete-me.txt"), "remove me\n", "utf8");
      await writeFile(join(tempDir, "move-me.txt"), "old name\n", "utf8");

      const tool = new PatchTool();
      const result = await tool.execute(
        {
          name: "patch",
          input: {
            patch: [
              "*** Begin Patch",
              "*** Add File: added.txt",
              "+hello",
              "+world",
              "*** Update File: existing.txt",
              "@@",
              "-alpha",
              "+beta",
              " unchanged",
              "*** Delete File: delete-me.txt",
              "*** Update File: move-me.txt",
              "*** Move to: renamed.txt",
              "@@",
              "-old name",
              "+new name",
              "*** End Patch",
            ].join("\n"),
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(await readFile(join(tempDir, "added.txt"), "utf8")).toBe("hello\nworld");
      expect(await readFile(join(tempDir, "existing.txt"), "utf8")).toBe("beta\nunchanged\n");
      await expect(readFile(join(tempDir, "delete-me.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(tempDir, "renamed.txt"), "utf8")).toBe("new name\n");
      await expect(readFile(join(tempDir, "move-me.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(result.metadata).toMatchObject({
        toolName: "patch",
        kind: "file",
        operation: "patch",
        dryRun: false,
        operationCount: 4,
        files: [
          {
            operation: "write",
            filePath: join(tempDir, "added.txt"),
            changeType: "created",
            linesAdded: 2,
          },
          {
            operation: "edit",
            filePath: join(tempDir, "existing.txt"),
            changeType: "modified",
            linesAdded: 1,
            linesRemoved: 1,
          },
          {
            operation: "delete",
            filePath: join(tempDir, "delete-me.txt"),
            changeType: "deleted",
            linesRemoved: 1,
          },
          {
            operation: "move",
            previousFilePath: join(tempDir, "move-me.txt"),
            filePath: join(tempDir, "renamed.txt"),
            changeType: "modified",
            linesAdded: 1,
            linesRemoved: 1,
          },
        ],
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("validates dry-run patches without changing disk", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "existing.txt"), "before\n", "utf8");

      const tool = new PatchTool();
      const result = await tool.execute(
        {
          name: "patch",
          input: {
            dryRun: true,
            patch: [
              "*** Begin Patch",
              "*** Update File: existing.txt",
              "@@",
              "-before",
              "+after",
              "*** Add File: planned.txt",
              "+planned",
              "*** End Patch",
            ].join("\n"),
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(await readFile(join(tempDir, "existing.txt"), "utf8")).toBe("before\n");
      await expect(readFile(join(tempDir, "planned.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(result.output).toContain("Dry run validated 2 patch operations");
      expect(result.metadata).toMatchObject({
        toolName: "patch",
        kind: "file",
        operation: "patch",
        dryRun: true,
        operationCount: 2,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("fails atomically when an update hunk does not match", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "existing.txt"), "alpha\n", "utf8");

      const tool = new PatchTool();
      const result = await tool.execute(
        {
          name: "patch",
          input: {
            patch: [
              "*** Begin Patch",
              "*** Add File: should-not-exist.txt",
              "+created",
              "*** Update File: existing.txt",
              "@@",
              "-missing",
              "+replacement",
              "*** End Patch",
            ].join("\n"),
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Hunk did not match");
      expect(await readFile(join(tempDir, "existing.txt"), "utf8")).toBe("alpha\n");
      await expect(readFile(join(tempDir, "should-not-exist.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("rejects sandbox-denied target paths before applying any operation", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "existing.txt"), "alpha\n", "utf8");

      const tool = new PatchTool();
      const result = await tool.execute(
        {
          name: "patch",
          input: {
            patch: [
              "*** Begin Patch",
              "*** Update File: existing.txt",
              "@@",
              "-alpha",
              "+beta",
              "*** Add File: ../outside.txt",
              "+outside",
              "*** End Patch",
            ].join("\n"),
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Write access denied");
      expect(await readFile(join(tempDir, "existing.txt"), "utf8")).toBe("alpha\n");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("rejects malformed patch documents", async () => {
    const tool = new PatchTool();

    const result = await tool.execute({
      name: "patch",
      input: { patch: "*** Begin Patch\n*** Add File: bad.txt\nmissing-prefix\n*** End Patch" },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid patch");
  });
});

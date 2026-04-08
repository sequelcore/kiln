import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EditTool } from "../../../src/tools/infrastructure/edit-tool.js";
import { ReadTool } from "../../../src/tools/infrastructure/read-tool.js";
import { WriteTool } from "../../../src/tools/infrastructure/write-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("ReadTool", () => {
  it("reads file content with offset and limit", async () => {
    const tempDir = await makeTempDir();
    try {
      const write = new WriteTool();
      const read = new ReadTool();

      await write.execute(
        {
          name: "write",
          input: { filePath: "sample.txt", content: "line0\nline1\nline2\nline3\nline4" },
        },
        makeSandbox(tempDir),
      );

      const result = await read.execute(
        {
          name: "read",
          input: { filePath: "sample.txt", offset: 1, limit: 2 },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("line1\nline2");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("returns an error when sandbox denies read access", async () => {
    const tempDir = await makeTempDir();
    try {
      const write = new WriteTool();
      await write.execute(
        {
          name: "write",
          input: { filePath: "sample.txt", content: "secret" },
        },
        makeSandbox(tempDir),
      );

      const read = new ReadTool();
      const deniedSandbox = makeSandbox(tempDir, { fsPolicy: "none" });
      const result = await read.execute(
        {
          name: "read",
          input: { filePath: "sample.txt" },
        },
        deniedSandbox,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

describe("WriteTool", () => {
  it("overwrites full file content", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new WriteTool();

      await tool.execute(
        {
          name: "write",
          input: { filePath: "overwrite.txt", content: "first content" },
        },
        makeSandbox(tempDir),
      );

      const result = await tool.execute(
        {
          name: "write",
          input: { filePath: "overwrite.txt", content: "replaced" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      const content = await readFile(join(tempDir, "overwrite.txt"), "utf8");
      expect(content).toBe("replaced");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("writes file content and allows empty string content", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new WriteTool();
      const result = await tool.execute(
        {
          name: "write",
          input: { filePath: "nested/empty.txt", content: "" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      const content = await readFile(join(tempDir, "nested", "empty.txt"), "utf8");
      expect(content).toBe("");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("returns an error when sandbox denies write access", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new WriteTool();
      const deniedSandbox = makeSandbox(tempDir, { fsPolicy: "read-only" });

      const result = await tool.execute(
        {
          name: "write",
          input: { filePath: "denied.txt", content: "x" },
        },
        deniedSandbox,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Write access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

describe("EditTool", () => {
  it("edits the first match by default", async () => {
    const tempDir = await makeTempDir();
    try {
      const write = new WriteTool();
      const edit = new EditTool();
      const read = new ReadTool();

      await write.execute(
        {
          name: "write",
          input: { filePath: "sample.txt", content: "foo foo foo" },
        },
        makeSandbox(tempDir),
      );

      const editResult = await edit.execute(
        {
          name: "edit",
          input: { filePath: "sample.txt", oldString: "foo", newString: "bar" },
        },
        makeSandbox(tempDir),
      );

      expect(editResult.isError).toBe(false);
      const readResult = await read.execute(
        {
          name: "read",
          input: { filePath: "sample.txt" },
        },
        makeSandbox(tempDir),
      );
      expect(readResult.output).toBe("bar foo foo");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("edits all matches when replaceAll=true", async () => {
    const tempDir = await makeTempDir();
    try {
      const write = new WriteTool();
      const edit = new EditTool();
      const read = new ReadTool();

      await write.execute(
        {
          name: "write",
          input: { filePath: "sample.txt", content: "foo foo foo" },
        },
        makeSandbox(tempDir),
      );

      const editResult = await edit.execute(
        {
          name: "edit",
          input: {
            filePath: "sample.txt",
            oldString: "foo",
            newString: "",
            replaceAll: true,
          },
        },
        makeSandbox(tempDir),
      );

      expect(editResult.isError).toBe(false);
      const readResult = await read.execute(
        {
          name: "read",
          input: { filePath: "sample.txt" },
        },
        makeSandbox(tempDir),
      );
      expect(readResult.output).toBe("  ");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("returns an error when oldString is missing", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new EditTool();
      const result = await tool.execute(
        {
          name: "edit",
          input: { filePath: "sample.txt", newString: "x" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain('"oldString"');
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

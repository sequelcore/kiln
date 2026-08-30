import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EditTool as CoreEditTool } from "../../../src/tools/infrastructure/edit-tool.js";
import { ReadTool as CoreReadTool } from "../../../src/tools/infrastructure/read-tool.js";
import { WriteTool as CoreWriteTool } from "../../../src/tools/infrastructure/write-tool.js";
import { makeSandbox, makeTempDir, nodeTestFilesystem, removeTempDir } from "./test-utils.js";

class EditTool extends CoreEditTool { constructor() { super(nodeTestFilesystem); } }
class ReadTool extends CoreReadTool { constructor() { super(nodeTestFilesystem); } }
class WriteTool extends CoreWriteTool { constructor() { super(nodeTestFilesystem); } }

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
      expect(result.metadata).toMatchObject({
        toolName: "read",
        kind: "file",
        operation: "read",
        filePath: join(tempDir, "sample.txt"),
        offset: 1,
        limit: 2,
        totalLines: 5,
      });
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

  it("suggests existing sibling files when the requested file is missing", async () => {
    const tempDir = await makeTempDir();
    try {
      const write = new WriteTool();
      await write.execute(
        {
          name: "write",
          input: { filePath: "src/index.css", content: "body { color: white; }" },
        },
        makeSandbox(tempDir),
      );
      await write.execute(
        {
          name: "write",
          input: { filePath: "src/app.tsx", content: "export const App = () => null;" },
        },
        makeSandbox(tempDir),
      );

      const read = new ReadTool();
      const result = await read.execute(
        {
          name: "read",
          input: { filePath: "src/style.css" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Did you mean one of these existing files?");
      expect(result.output).toContain(join(tempDir, "src", "index.css"));
      expect(result.metadata).toMatchObject({
        toolName: "read",
        kind: "file",
        operation: "read",
        filePath: join(tempDir, "src", "style.css"),
        code: "ENOENT",
        suggestions: [join(tempDir, "src", "index.css"), join(tempDir, "src", "app.tsx")],
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("suggests matching basenames under the nearest existing ancestor when parent directories are missing", async () => {
    const tempDir = await makeTempDir();
    try {
      const write = new WriteTool();
      await write.execute(
        {
          name: "write",
          input: {
            filePath: "frontend/src/components/dashboard/layout/dashboard-layout.tsx",
            content: "export const DashboardLayout = () => null;",
          },
        },
        makeSandbox(tempDir),
      );

      const read = new ReadTool();
      const result = await read.execute(
        {
          name: "read",
          input: { filePath: "frontend/components/dashboard/layout/dashboard-layout.tsx" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Did you mean one of these existing files?");
      expect(result.output).toContain(join(tempDir, "frontend", "src", "components", "dashboard", "layout", "dashboard-layout.tsx"));
      expect(result.metadata).toMatchObject({
        toolName: "read",
        kind: "file",
        operation: "read",
        filePath: join(tempDir, "frontend", "components", "dashboard", "layout", "dashboard-layout.tsx"),
        code: "ENOENT",
        suggestions: [join(tempDir, "frontend", "src", "components", "dashboard", "layout", "dashboard-layout.tsx")],
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("rejects binary image files instead of returning decoded text", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "screenshot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

      const read = new ReadTool();
      const result = await read.execute(
        {
          name: "read",
          input: { filePath: "screenshot.png" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Binary file cannot be read as text");
      expect(result.output).toContain("Use view_image");
      expect(result.metadata).toMatchObject({
        toolName: "read",
        kind: "file",
        operation: "read",
        filePath: join(tempDir, "screenshot.png"),
        code: "BINARY_FILE",
      });
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
      expect(result.metadata).toMatchObject({
        toolName: "write",
        kind: "file",
        operation: "write",
        filePath: join(tempDir, "overwrite.txt"),
        changeType: "modified",
        linesAdded: 1,
        linesRemoved: 1,
        diffPreview: "- first content\n+ replaced",
        diffTruncated: false,
      });
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
      expect(result.output).toBe(`Wrote 0 characters to ${join(tempDir, "nested", "empty.txt")}`);
      expect(result.metadata).toMatchObject({
        toolName: "write",
        kind: "file",
        operation: "write",
        filePath: join(tempDir, "nested", "empty.txt"),
        bytesWritten: 0,
      });
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
      expect(editResult.output).toBe(`Applied 1 replacement in ${join(tempDir, "sample.txt")}`);
      expect(editResult.metadata).toMatchObject({
        toolName: "edit",
        kind: "file",
        operation: "edit",
        filePath: join(tempDir, "sample.txt"),
        changeType: "modified",
        replacements: 1,
        replaceAll: false,
        linesAdded: 1,
        linesRemoved: 1,
        diffPreview: "- foo\n+ bar",
        diffTruncated: false,
      });
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
      expect(editResult.metadata).toMatchObject({
        toolName: "edit",
        kind: "file",
        operation: "edit",
        filePath: join(tempDir, "sample.txt"),
        changeType: "modified",
        replacements: 3,
        replaceAll: true,
        linesAdded: 0,
        linesRemoved: 3,
        diffPreview: "- foo\n+ (empty file)",
        diffTruncated: false,
      });
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

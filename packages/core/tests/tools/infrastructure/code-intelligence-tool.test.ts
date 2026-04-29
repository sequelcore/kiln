import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  CodeIntelligenceAdapter,
  CodeIntelligenceRequest,
  CodeIntelligenceResult,
} from "../../../src/tools/domain/code-intelligence.js";
import { CodeIntelligenceTool } from "../../../src/tools/infrastructure/code-intelligence-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

class RecordingCodeIntelligenceAdapter implements CodeIntelligenceAdapter {
  readonly name = "recording-lsp";
  requests: CodeIntelligenceRequest[] = [];

  async query(request: CodeIntelligenceRequest): Promise<CodeIntelligenceResult> {
    this.requests.push(request);
    return {
      operation: request.operation,
      language: "typescript",
      entries: [
        {
          kind: "location",
          path: request.path ?? "src/index.ts",
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 13 },
          },
          symbol: "run",
          detail: "function run(): void",
        },
      ],
    };
  }
}

describe("CodeIntelligenceTool", () => {
  it("fails closed when no language-server adapter is configured", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "index.ts"), "const value = 1;\n", "utf8");
      const tool = new CodeIntelligenceTool();

      const result = await tool.execute(
        { name: "code_intelligence", input: { operation: "diagnostics", path: "index.ts" } },
        makeSandbox(tempDir),
      );

      expect(result).toMatchObject({
        isError: true,
        metadata: {
          toolName: "code_intelligence",
          kind: "code",
          operation: "diagnostics",
          adapter: "unconfigured",
          resultCount: 0,
          errorCode: "adapter_not_configured",
        },
      });
      expect(result.output).toContain("No code intelligence adapter is configured");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("validates workspace paths before querying the adapter", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "index.ts"), "const value = 1;\n", "utf8");
      const adapter = new RecordingCodeIntelligenceAdapter();
      const tool = new CodeIntelligenceTool({ adapter });

      const result = await tool.execute(
        { name: "code_intelligence", input: { operation: "diagnostics", path: "index.ts" } },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
      expect(adapter.requests).toHaveLength(0);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("normalizes requests and returns bounded structured adapter results", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "index.ts"), "function run() {}\n", "utf8");
      const adapter = new RecordingCodeIntelligenceAdapter();
      const tool = new CodeIntelligenceTool({ adapter });

      const result = await tool.execute(
        {
          name: "code_intelligence",
          input: {
            operation: "definition",
            path: "index.ts",
            position: { line: 0, character: 9 },
            verbosity: "structured",
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(adapter.requests).toEqual([
        expect.objectContaining({
          operation: "definition",
          path: join(tempDir, "index.ts"),
          position: { line: 0, character: 9 },
          workspaceRoot: tempDir,
          limit: 50,
        }),
      ]);
      expect(JSON.parse(result.output)).toMatchObject({
        operation: "definition",
        language: "typescript",
        entries: [
          {
            kind: "location",
            symbol: "run",
          },
        ],
      });
      expect(result.metadata).toMatchObject({
        toolName: "code_intelligence",
        kind: "code",
        operation: "definition",
        path: join(tempDir, "index.ts"),
        adapter: "recording-lsp",
        language: "typescript",
        resultCount: 1,
        verbosity: "structured",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("requires position for position-based operations", async () => {
    const tool = new CodeIntelligenceTool({ adapter: new RecordingCodeIntelligenceAdapter() });

    const result = await tool.execute({
      name: "code_intelligence",
      input: { operation: "hover", path: "index.ts" },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('"position" is required');
  });
});

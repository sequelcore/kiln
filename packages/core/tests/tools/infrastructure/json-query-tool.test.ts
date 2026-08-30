import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultBuiltinToolSurface } from "../../../src/tools/default-tool-surface.js";
import { JsonQueryTool } from "../../../src/tools/infrastructure/json-query-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("JsonQueryTool", () => {
  it("queries inline JSON through jq stdin", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "\"Kiln\"\n",
      stderr: "",
    }));
    const tool = new JsonQueryTool({
      commandRunner,
      defaultCwd: process.cwd(),
      vendoredToolResolver: (binary) =>
        binary === "jq" ? { path: "jq-bin", version: "1.8.2" } : undefined,
    });

    const result = await tool.execute({
      name: "json_query",
      input: {
        json: "{\"name\":\"Kiln\"}",
        filter: ".name",
      },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toBe("\"Kiln\"");
    expect(result.metadata).toMatchObject({
      toolName: "json_query",
      kind: "structured_data",
      operation: "query",
      source: "inline",
      strategy: "jq",
      runtimeSource: "bundled",
      runtimePath: "jq-bin",
      runtimeVersion: "1.8.2",
      filter: ".name",
      lineCount: 1,
    });
    expect(commandRunner).toHaveBeenCalledWith(
      "jq-bin",
      ["-c", ".name"],
      process.cwd(),
      30_000,
      "{\"name\":\"Kiln\"}",
    );
  });

  it("queries a JSON file after sandbox read validation", async () => {
    const tempDir = await makeTempDir();
    try {
      const filePath = join(tempDir, "package.json");
      await writeFile(filePath, "{\"scripts\":{\"test\":\"vitest\"}}\n", "utf8");
      const commandRunner = vi.fn(async () => ({
        stdout: "\"vitest\"\n",
        stderr: "",
      }));
      const tool = new JsonQueryTool({
        commandRunner,
        vendoredToolResolver: (binary) =>
          binary === "jq" ? { path: "jq-bin", version: "1.8.2" } : undefined,
      });

      const result = await tool.execute(
        {
          name: "json_query",
          input: {
            path: filePath,
            filter: ".scripts.test",
          },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("\"vitest\"");
      expect(result.metadata).toMatchObject({
        toolName: "json_query",
        kind: "structured_data",
        operation: "query",
        source: "file",
        path: filePath,
        strategy: "jq",
        runtimeSource: "bundled",
      });
      expect(commandRunner).toHaveBeenCalledWith(
        "jq-bin",
        ["-c", ".scripts.test", filePath],
        tempDir,
        30_000,
      );
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("fails fast when jq runtime is unavailable", async () => {
    const tool = new JsonQueryTool({
      vendoredToolResolver: () => undefined,
      environmentProvider: async () => ({}),
    });

    const result = await tool.execute({
      name: "json_query",
      input: {
        json: "{\"ok\":true}",
        filter: ".ok",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("jq runtime is required");
    expect(result.metadata).toMatchObject({
      toolName: "json_query",
      kind: "structured_data",
      operation: "query",
      source: "inline",
      strategy: "jq",
      runtimeSource: "unavailable",
    });
  });

  it("requires exactly one JSON source", async () => {
    const tool = new JsonQueryTool({
      vendoredToolResolver: (binary) =>
        binary === "jq" ? { path: "jq-bin", version: "1.8.2" } : undefined,
    });

    const missing = await tool.execute({
      name: "json_query",
      input: { filter: "." },
    });
    const duplicate = await tool.execute({
      name: "json_query",
      input: { json: "{}", path: "package.json", filter: "." },
    });

    expect(missing.isError).toBe(true);
    expect(missing.output).toContain("exactly one of");
    expect(duplicate.isError).toBe(true);
    expect(duplicate.output).toContain("exactly one of");
  });

  it("is available through the canonical registry and hidden deferred catalog", async () => {
    const surface = createDefaultBuiltinToolSurface({
      toolProjection: {
        mode: "deferred",
        alwaysOnTools: ["read"],
      },
    });

    expect(surface.toolNames).not.toContain("json_query");
    expect(surface.registry.has("json_query")).toBe(true);

    await expect(surface.bridge.execute({
      name: "tool_catalog_search",
      input: { exact: "json_query", verbosity: "structured" },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        metadata: expect.objectContaining({
          resultCount: 1,
        }),
      },
    });
  });
});

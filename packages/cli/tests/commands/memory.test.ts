import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { memoryCommand } from "../../src/commands/memory.js";
import type { KilnAppConfig } from "../../src/config.js";

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry not called in memory tests");
  },
  buildSystemPrompt: () => "",
  kilnYaml: { version: "1" },
};

describe("memoryCommand", () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-memory-"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  it("prints help when no subcommand given", async () => {
    await memoryCommand(MOCK_APP_CONFIG, "", [], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Usage: kiln memory");
    expect(output).toContain("graph");
    expect(output).not.toContain("stats");
  });

  it("reads the Memory Lattice graph through the shared resource plane", async () => {
    const projectScope = `project:${basename(tempDir)}`;
    await memoryCommand(MOCK_APP_CONFIG, "graph", ["--scope", projectScope, "--query", "lattice", "--limit", "25"], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    const payload = JSON.parse(output);
    expect(payload.snapshot).toMatchObject({
      nodes: [],
      edges: [],
      limits: { maxNodes: 25, maxEdges: 50 },
      truncated: false,
    });
    expect(payload.filters).toMatchObject({
      scope: { kind: "project", id: basename(tempDir) },
      query: "lattice",
    });
  });

  it("lists Memory Lattice resource templates for CLI and MCP parity", async () => {
    await memoryCommand(MOCK_APP_CONFIG, "templates", [], tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    const templates = JSON.parse(output) as { uriTemplate: string }[];
    expect(templates.map((template) => template.uriTemplate)).toEqual(expect.arrayContaining([
      "kiln://memory/graph{?scope,scopeKind,scopeId,layer,query,depth,limit}",
      "kiln://memory/nodes/{id}{?scope,scopeKind,scopeId}",
      "kiln://memory/admissions{?sessionId,recordId,scope,scopeKind,scopeId,layer,limit}",
    ]));
  });
});

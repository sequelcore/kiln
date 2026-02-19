import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { memoryCommand } from "../../src/commands/memory.js";
import type { KilnAppConfig } from "../../src/config.js";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => {
    throw new Error("createRegistry not called in memory tests");
  },
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
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

  it("prints help when no subcommand given", () => {
    memoryCommand(MOCK_APP_CONFIG, "", [], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: kiln memory");
    expect(output).toContain("search");
    expect(output).toContain("show");
    expect(output).toContain("stats");
  });

  it("search prints placeholder message", () => {
    memoryCommand(MOCK_APP_CONFIG, "search", ["test query"], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Memory search requires a running session.");
  });

  it("stats shows file count when memory directory exists", () => {
    mkdirSync(join(tempDir, ".kiln", "memory"), { recursive: true });
    writeFileSync(join(tempDir, ".kiln", "memory", "chunk1.jsonl"), "{}\n");
    writeFileSync(join(tempDir, ".kiln", "memory", "chunk2.jsonl"), "{}\n");

    memoryCommand(MOCK_APP_CONFIG, "stats", [], tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Files:     2");
  });
});

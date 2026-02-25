import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { statusCommand } from "../../src/commands/status.js";
import type { ProjectConfig } from "../../src/commands/init.js";
import type { KilnAppConfig } from "../../src/config.js";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => {
    throw new Error("createRegistry not called in status tests");
  },
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

describe("statusCommand", () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-status-"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  it("prints error when not initialized", () => {
    statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Not initialized");
    expect(output).toContain("kiln init");
  });

  it("prints domain when initialized", () => {
    const config: ProjectConfig = {
      domain: "python",
      channels: ["cli", "web"],
      teamMode: "sequential",
      requireApproval: true,
      maxDepth: 3,
      parallelWorkers: 2,
      provider: "claude",
      mode: "api-key",
    };

    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
    writeFileSync(join(tempDir, ".kiln", "config.json"), JSON.stringify(config));

    statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("python");
  });

  it("shows all config values", () => {
    const config: ProjectConfig = {
      domain: "react-typescript",
      channels: ["cli", "web"],
      teamMode: "sequential",
      requireApproval: false,
      maxDepth: 5,
      parallelWorkers: 4,
      provider: "openai",
      mode: "api-key",
    };

    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
    writeFileSync(join(tempDir, ".kiln", "config.json"), JSON.stringify(config));

    statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("react-typescript");
    expect(output).toContain("false");
    expect(output).toContain("5");
    expect(output).toContain("4");
    expect(output).toContain("openai");
    expect(output).toContain("api-key");
  });

  it("shows memory file count", () => {
    const config: ProjectConfig = {
      domain: "python",
      channels: ["cli", "web"],
      teamMode: "sequential",
      requireApproval: true,
      maxDepth: 3,
      parallelWorkers: 2,
      provider: "claude",
      mode: "api-key",
    };

    mkdirSync(join(tempDir, ".kiln", "memory"), { recursive: true });
    writeFileSync(join(tempDir, ".kiln", "config.json"), JSON.stringify(config));
    writeFileSync(join(tempDir, ".kiln", "memory", "chunk1.jsonl"), "{}");
    writeFileSync(join(tempDir, ".kiln", "memory", "chunk2.jsonl"), "{}");

    statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Memory files:     2");
  });
});

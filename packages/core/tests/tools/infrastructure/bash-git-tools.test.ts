import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BashTool } from "../../../src/tools/infrastructure/bash-tool.js";
import { GitTool } from "../../../src/tools/infrastructure/git-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("BashTool", () => {
  it("validates timeout shape", async () => {
    const tool = new BashTool();
    const result = await tool.execute({
      name: "bash",
      input: { command: "echo hi", timeout: "1000" },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("\"timeout\"");
  });

  it("enforces sandbox execution validation", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new BashTool();
      const result = await tool.execute(
        {
          name: "bash",
          input: { command: "rm -rf /" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Dangerous command blocked");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("runs commands through injected runner with resolved cwd", async () => {
    const tempDir = await makeTempDir();
    try {
      const nested = join(tempDir, "workspace");
      await mkdir(nested, { recursive: true });

      const commandRunner = vi.fn(async () => ({
        stdout: "ok\n",
        stderr: "",
      }));
      const tool = new BashTool({ commandRunner });
      const result = await tool.execute(
        {
          name: "bash",
          input: { command: "echo ok", timeout: 5_000, cwd: "workspace" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("ok");
      expect(commandRunner).toHaveBeenCalledWith("echo ok", nested, 5_000);
      expect(result.metadata?.["cwd"]).toBe(nested);
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

describe("GitTool", () => {
  it("validates args shape", async () => {
    const tool = new GitTool();
    const result = await tool.execute({
      name: "git",
      input: { subcommand: "status", args: [1] },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("\"args\"");
  });

  it("runs git subcommands through injected runner", async () => {
    const tempDir = await makeTempDir();
    try {
      const commandRunner = vi.fn(async () => ({
        stdout: "On branch main\n",
        stderr: "",
      }));

      const tool = new GitTool({ commandRunner });
      const result = await tool.execute(
        {
          name: "git",
          input: { subcommand: "status", args: ["--short"] },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("On branch main");
      expect(commandRunner).toHaveBeenCalledWith(["status", "--short"], tempDir, 30_000);
      expect(result.metadata?.["cwd"]).toBe(tempDir);
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

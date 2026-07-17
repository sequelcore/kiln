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
      expect(result.metadata?.["toolName"]).toBe("bash");
      expect(result.metadata?.["kind"]).toBe("command");
      expect(result.metadata?.["cwd"]).toBe(nested);
      expect(result.metadata?.["command"]).toBe("echo ok");
      expect(result.metadata?.["timeoutMs"]).toBe(5_000);
      expect(result.metadata?.["stdout"]).toBe("ok\n");
      expect(result.metadata?.["stderr"]).toBe("");
      expect(result.metadata?.["stdoutBytes"]).toBe(Buffer.byteLength("ok\n"));
      expect(result.metadata?.["stderrBytes"]).toBe(0);
      expect(result.metadata?.["exitCode"]).toBe(0);
      expect(result.metadata?.["timedOut"]).toBe(false);
      expect(result.metadata?.["truncated"]).toBe(false);
      expect(result.metadata?.["durationMs"]).toEqual(expect.any(Number));
      expect(result.metadata?.["durationMs"]).toBeGreaterThanOrEqual(0);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("runs real bash commands through the detected exact executable path", async () => {
    const tempDir = await makeTempDir();
    try {
      const start = vi.fn((request, sink) => {
        sink.output({ stream: "stdout", text: "ok\n" });
        sink.finish({ exitCode: 0 });
        return { pid: 42, completed: Promise.resolve({ exitCode: 0 }), stop: vi.fn(async () => {}) };
      });
      const processRunner = { start };
      const tool = new BashTool({
        environmentProvider: async () => ({
          bash: { path: "C:\\Program Files\\Git\\bin\\bash.exe", version: "GNU bash 5.2" },
        }),
        processRunner,
      });
      const result = await tool.execute(
        {
          name: "bash",
          input: { command: "echo ok", timeout: 5_000 },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          executable: "C:\\Program Files\\Git\\bin\\bash.exe",
          args: ["-c", "echo ok"],
          cwd: tempDir,
          timeoutMs: 5_000,
        }),
        expect.any(Object),
      );
      expect(result.metadata?.["cwd"]).toBe(tempDir);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("streams ordered stdout and stderr through the execution context while retaining terminal output", async () => {
    const tempDir = await makeTempDir();
    try {
      const controller = new AbortController();
      const start = vi.fn((request, sink) => {
        sink.output({ stream: "stdout", text: "building\n" });
        sink.output({ stream: "stderr", text: "warning\n" });
        sink.output({ stream: "stdout", text: "done\n" });
        sink.finish({ exitCode: 0 });
        return { pid: 42, completed: Promise.resolve({ exitCode: 0 }), stop: vi.fn(async () => {}) };
      });
      const onOutput = vi.fn();
      const tool = new BashTool({
        environmentProvider: async () => ({ bash: { path: "bash", version: "test" } }),
        processRunner: { start },
      });

      const result = await tool.execute(
        { name: "bash", input: { command: "build" } },
        makeSandbox(tempDir),
        { abortSignal: controller.signal, onOutput },
      );

      expect(onOutput.mock.calls.map(([delta]) => delta)).toEqual([
        { stream: "stdout", delta: "building\n" },
        { stream: "stderr", delta: "warning\n" },
        { stream: "stdout", delta: "done\n" },
      ]);
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ signal: controller.signal }),
        expect.any(Object),
      );
      expect(result).toMatchObject({ isError: false, output: "building\ndone\nwarning" });
      expect(result.metadata).toMatchObject({ status: "succeeded" });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("fails fast when no bash executable is available", async () => {
    const tempDir = await makeTempDir();
    try {
      const start = vi.fn();
      const processRunner = { start };
      const tool = new BashTool({
        environmentProvider: async () => ({}),
        processRunner,
      });
      const result = await tool.execute(
        {
          name: "bash",
          input: { command: "echo ok", timeout: 5_000 },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("bash executable is not available");
      expect(result.metadata?.["code"]).toBe("BASH_NOT_FOUND");
      expect(start).not.toHaveBeenCalled();
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("normalizes Windows shell cwd paths before sandbox validation and execution", async () => {
    const windowsWorkspace = "C:\\workspace\\kiln";
    const commandRunner = vi.fn(async () => ({
      stdout: "ok\n",
      stderr: "",
    }));
    const tool = new BashTool({ commandRunner, platform: "win32" });
    const result = await tool.execute(
      {
        name: "bash",
        input: {
          command: "git rev-parse --show-toplevel",
          timeout: 5_000,
          cwd: "/mnt/c/workspace/kiln",
        },
      },
      makeSandbox(windowsWorkspace),
    );

    expect(result.isError).toBe(false);
    expect(commandRunner).toHaveBeenCalledWith(
      "git rev-parse --show-toplevel",
      windowsWorkspace,
      5_000,
    );
    expect(result.metadata?.["cwd"]).toBe(windowsWorkspace);
  });

  it("normalizes MSYS drive cwd paths before sandbox validation and execution", async () => {
    const windowsWorkspace = "C:\\workspace\\kiln";
    const commandRunner = vi.fn(async () => ({
      stdout: "ok\n",
      stderr: "",
    }));
    const tool = new BashTool({ commandRunner, platform: "win32" });
    const result = await tool.execute(
      {
        name: "bash",
        input: {
          command: "pwd",
          timeout: 5_000,
          cwd: "/c/workspace/kiln",
        },
      },
      makeSandbox(windowsWorkspace),
    );

    expect(result.isError).toBe(false);
    expect(commandRunner).toHaveBeenCalledWith("pwd", windowsWorkspace, 5_000);
    expect(result.metadata?.["cwd"]).toBe(windowsWorkspace);
  });

  it("preserves failed execution output and metadata when injected runner rejects", async () => {
    const tempDir = await makeTempDir();
    try {
      const nested = join(tempDir, "workspace");
      await mkdir(nested, { recursive: true });

      const commandRunner = vi.fn(async () => {
        throw Object.assign(new Error("bash command failed"), {
          stdout: "partial output\n",
          stderr: "permission denied\n",
          code: 17,
          signal: "SIGTERM" as NodeJS.Signals,
        });
      });
      const tool = new BashTool({ commandRunner });
      const result = await tool.execute(
        {
          name: "bash",
          input: { command: "cat secret.txt", timeout: 1_500, cwd: "workspace" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toBe("permission denied\npartial output");
      expect(commandRunner).toHaveBeenCalledWith("cat secret.txt", nested, 1_500);
      expect(result.metadata?.["toolName"]).toBe("bash");
      expect(result.metadata?.["kind"]).toBe("command");
      expect(result.metadata?.["cwd"]).toBe(nested);
      expect(result.metadata?.["command"]).toBe("cat secret.txt");
      expect(result.metadata?.["timeoutMs"]).toBe(1_500);
      expect(result.metadata?.["stdout"]).toBe("partial output\n");
      expect(result.metadata?.["stderr"]).toBe("permission denied\n");
      expect(result.metadata?.["stdoutBytes"]).toBe(Buffer.byteLength("partial output\n"));
      expect(result.metadata?.["stderrBytes"]).toBe(Buffer.byteLength("permission denied\n"));
      expect(result.metadata?.["exitCode"]).toBe(17);
      expect(result.metadata?.["code"]).toBe(17);
      expect(result.metadata?.["signal"]).toBe("SIGTERM");
      expect(result.metadata?.["timedOut"]).toBe(false);
      expect(result.metadata?.["truncated"]).toBe(false);
      expect(result.metadata?.["durationMs"]).toEqual(expect.any(Number));
      expect(result.metadata?.["durationMs"]).toBeGreaterThanOrEqual(0);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("marks real command timeouts without reporting truncation", async () => {
    const tool = new BashTool();
    const result = await tool.execute({
      name: "bash",
      input: { command: "sleep 1", timeout: 50 },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("bash command timed out");
    expect(result.metadata?.["timedOut"]).toBe(true);
    expect(result.metadata?.["status"]).toBe("timed_out");
    expect(result.metadata?.["truncated"]).toBe(false);
    expect(result.metadata?.["signal"]).toBe("SIGTERM");
    expect(result.metadata?.["stdout"]).toBe("");
    expect(result.metadata?.["stderr"]).toBe("");
    expect(result.metadata?.["durationMs"]).toEqual(expect.any(Number));
    expect(result.metadata?.["durationMs"]).toBeGreaterThanOrEqual(0);
  });

  it("marks max buffer failures as truncated without reporting timeout", async () => {
    const maxBufferOutput = "x".repeat(2 * 1024 * 1024);
    const tool = new BashTool({
      commandRunner: async () => {
        throw Object.assign(new Error("stdout maxBuffer length exceeded"), {
          stdout: maxBufferOutput,
          stderr: "",
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
      },
    });
    const result = await tool.execute({
      name: "bash",
      input: { command: "yes x | head -c 2200000", timeout: 5_000 },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toBe(maxBufferOutput);
    expect(result.metadata?.["toolName"]).toBe("bash");
    expect(result.metadata?.["kind"]).toBe("command");
    expect(result.metadata?.["code"]).toBe("ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
    expect(result.metadata?.["timedOut"]).toBe(false);
    expect(result.metadata?.["truncated"]).toBe(true);
    expect(result.metadata?.["maxBufferBytes"]).toBe(2 * 1024 * 1024);
    expect(result.metadata?.["stdout"]).toBe("x".repeat(8 * 1024));
    expect(result.metadata?.["stdoutTruncated"]).toBe(true);
    expect(result.metadata?.["stdoutBytes"]).toBe(2 * 1024 * 1024);
    expect(result.metadata?.["stderrBytes"]).toBe(0);
    expect(result.metadata?.["durationMs"]).toEqual(expect.any(Number));
    expect(result.metadata?.["durationMs"]).toBeGreaterThanOrEqual(0);
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
      expect(result.metadata?.["toolName"]).toBe("git");
      expect(result.metadata?.["kind"]).toBe("command");
      expect(result.metadata?.["cwd"]).toBe(tempDir);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("denies mutating git subcommands", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "should not run\n",
      stderr: "",
    }));
    const tool = new GitTool({ commandRunner });

    for (const subcommand of ["checkout", "add", "reset", "commit", "push"]) {
      const result = await tool.execute({
        name: "git",
        input: { subcommand, args: ["--help"] },
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain("read-only git inspection");
    }

    expect(commandRunner).not.toHaveBeenCalled();
  });
});

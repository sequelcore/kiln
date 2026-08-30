import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { nodeQualityGateCommandExecutor } from "../../src/tools/quality-gate-command-executor.js";

describe("nodeQualityGateCommandExecutor", () => {
  it("runs a shell command with merged stdout/stderr output", async () => {
    const result = await nodeQualityGateCommandExecutor.execute({
      command: "node -e \"process.stdout.write('stdout'); process.stderr.write('stderr')\"",
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("stdout");
    expect(result.output).toContain("stderr");
  });

  it("returns a nonzero exit code for a failed shell command", async () => {
    const result = await nodeQualityGateCommandExecutor.execute({
      command: "node -e \"process.stdout.write('failed'); process.exit(1)\"",
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("failed");
  });

  it("waits for shell descendants to settle before projecting a timeout", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kiln-quality-gate-"));
    let pid: number | undefined;

    try {
      const startedAt = Date.now();
      const result = await nodeQualityGateCommandExecutor.execute({
        command: "node -e \"require('node:fs').writeFileSync('pid', String(process.pid)); setTimeout(() => {}, 10000)\"",
        cwd,
        timeoutMs: 100,
      });
      pid = Number(readFileSync(join(cwd, "pid"), "utf8"));

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(result).toEqual({
        exitCode: 1,
        output: "timeout after 100ms",
      });
      expect(isProcessAlive(pid)).toBe(false);
    } finally {
      if (pid !== undefined) terminateProcess(pid);
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 5_000);

  it("reports bounded settlement failure separately from timeout", async () => {
    const result = await executeWithUnsettledChild();

    expect(result).toEqual({
      exitCode: 1,
      output: "timeout after 10ms; process settlement failed after 1000ms",
    });
  });

  it("preserves the timeout projection after a settled tree", async () => {
    const startedAt = Date.now();
    const result = await nodeQualityGateCommandExecutor.execute({
      command: "node -e \"setTimeout(() => {}, 10000)\"",
      cwd: process.cwd(),
      timeoutMs: 100,
    });

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result).toEqual({
      exitCode: 1,
      output: "timeout after 100ms",
    });
  }, 5_000);

  it("rejects when the shell process cannot be started", async () => {
    await expect(nodeQualityGateCommandExecutor.execute({
      command: "echo unavailable",
      cwd: "C:/path/that/does/not/exist/kiln",
      timeoutMs: 5_000,
    })).rejects.toBeInstanceOf(Error);
  });
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcess(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process may already have been terminated by the executor.
  }
}

async function executeWithUnsettledChild(): Promise<{ exitCode: number; output: string }> {
  vi.useFakeTimers();
  vi.resetModules();

  const child = Object.assign(new EventEmitter(), {
    pid: 91_337,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exitCode: null,
    kill: vi.fn(() => false),
  }) as unknown as ChildProcess;
  const spawn = vi.fn(() => child);
  const execFile = vi.fn(() => new EventEmitter() as unknown as ChildProcess);
  vi.doMock("node:child_process", () => ({ execFile, spawn }));

  try {
    const { nodeQualityGateCommandExecutor: mockedExecutor } = await import(
      "../../src/tools/quality-gate-command-executor.js"
    );
    const pending = mockedExecutor.execute({
      command: "never settles",
      cwd: process.cwd(),
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(1_010);
    return await pending;
  } finally {
    vi.doUnmock("node:child_process");
    vi.resetModules();
    vi.useRealTimers();
  }
}

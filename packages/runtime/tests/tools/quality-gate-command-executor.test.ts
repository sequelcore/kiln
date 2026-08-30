import { describe, expect, it } from "vitest";
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

  it("resolves the timeout projection immediately", async () => {
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

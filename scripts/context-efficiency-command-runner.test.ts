import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { createContextEfficiencyCommandRunner } from "./context-efficiency-command-runner.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

describe.sequential("diagnostic subprocess lifecycle", () => {
  it("captures a nonzero terminal exit without calling it a timeout and hides its console", async () => {
    const runner = createContextEfficiencyCommandRunner();
    const result = await runner.run({
      command: [process.execPath, "-e", "process.stdout.write('partial'); process.stderr.write('failed'); process.exitCode = 7;"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ exitCode: 7, stdout: "partial", stderr: "failed" });
    expect(execFile).toHaveBeenLastCalledWith(process.execPath, expect.any(Array),
      expect.objectContaining({ windowsHide: true, encoding: "utf8" }), expect.any(Function));
  });

  it("joins a forcibly terminated process and explicitly retains timeout uncertainty", async () => {
    const result = await createContextEfficiencyCommandRunner().run({
      command: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      timeoutMs: 100,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("rejects a launch failure rather than inventing a process outcome", async () => {
    await expect(createContextEfficiencyCommandRunner().run({
      command: ["kiln-nonexistent-test-executable"], cwd: process.cwd(), timeoutMs: 5_000,
    })).rejects.toMatchObject({ code: "ENOENT" });
  });
});

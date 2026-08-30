import { describe, expect, it, vi } from "vitest";
import { GateRunner } from "../../src/quality-gates/gate-runner.js";
import type {
  QualityGateCommandExecutor,
  QualityGateCommandExecutionResult,
} from "../../src/quality-gates/index.js";
import type { QualityGate } from "../../src/domain/index.js";

function gate(overrides: Partial<QualityGate> & { command: string }): QualityGate {
  return { name: "test-gate", description: "test", required: true, ...overrides };
}

function executor(
  result: QualityGateCommandExecutionResult = { exitCode: 0, output: "" },
): QualityGateCommandExecutor & { execute: ReturnType<typeof vi.fn> } {
  return { execute: vi.fn().mockResolvedValue(result) };
}

const cwd = process.cwd();

describe("GateRunner", () => {
  it("runs a passing gate through the injected executor", async () => {
    const commandExecutor = executor({ exitCode: 0, output: "hello\n" });
    const runner = new GateRunner({ cwd, commandExecutor });
    const result = await runner.run(gate({ command: "echo hello" }));

    expect(result.passed).toBe(true);
    expect(result.name).toBe("test-gate");
    expect(commandExecutor.execute).toHaveBeenCalledWith({
      command: "echo hello",
      cwd,
      timeoutMs: 60_000,
    });
  });

  it("runs a failing gate", async () => {
    const runner = new GateRunner({
      cwd,
      commandExecutor: executor({ exitCode: 1, output: "failed\n" }),
    });
    const result = await runner.run(gate({ command: "node -e process.exit(1)" }));

    expect(result.passed).toBe(false);
    expect(result.output).toBe("failed\n");
  });

  it("captures executor output", async () => {
    const runner = new GateRunner({
      cwd,
      commandExecutor: executor({ exitCode: 0, output: "hello\n" }),
    });
    const result = await runner.run(gate({ command: "echo hello" }));

    expect(result.output).toContain("hello");
  });

  it("truncates long output to 2000 chars", async () => {
    const runner = new GateRunner({
      cwd,
      commandExecutor: executor({ exitCode: 0, output: "x".repeat(3000) }),
    });
    const result = await runner.run(gate({ command: "long-output" }));

    expect(result.output.length).toBeLessThanOrEqual(2000);
  });

  it("projects executor timeout failure immediately", async () => {
    const commandExecutor = executor({ exitCode: 1, output: "timeout after 200ms" });
    const runner = new GateRunner({ cwd, timeoutMs: 200, commandExecutor });
    const result = await runner.run(gate({ command: "sleep forever" }));

    expect(result.passed).toBe(false);
    expect(result.output).toContain("timeout");
    expect(commandExecutor.execute).toHaveBeenCalledWith({
      command: "sleep forever",
      cwd,
      timeoutMs: 200,
    });
  });

  it("runAll returns all results sequentially", async () => {
    const commandExecutor = {
      execute: vi.fn()
        .mockResolvedValueOnce({ exitCode: 0, output: "ok" })
        .mockResolvedValueOnce({ exitCode: 1, output: "failed" }),
    } satisfies QualityGateCommandExecutor;
    const runner = new GateRunner({ cwd, commandExecutor });
    const gates: QualityGate[] = [
      gate({ name: "pass", command: "pass" }),
      gate({ name: "fail", command: "fail" }),
    ];

    const results = await runner.runAll(gates);

    expect(results).toHaveLength(2);
    expect(results[0]!.name).toBe("pass");
    expect(results[0]!.passed).toBe(true);
    expect(results[1]!.name).toBe("fail");
    expect(results[1]!.passed).toBe(false);
    expect(commandExecutor.execute.mock.calls.map(([request]) => request.command)).toEqual(["pass", "fail"]);
  });

  it("runRequired only checks required gates for passed status", async () => {
    const commandExecutor = {
      execute: vi.fn()
        .mockResolvedValueOnce({ exitCode: 0, output: "ok" })
        .mockResolvedValueOnce({ exitCode: 1, output: "optional failure" }),
    } satisfies QualityGateCommandExecutor;
    const runner = new GateRunner({ cwd, commandExecutor });
    const gates: QualityGate[] = [
      gate({ name: "required-pass", command: "required-pass", required: true }),
      gate({ name: "optional-fail", command: "optional-fail", required: false }),
    ];

    const result = await runner.runRequired(gates);

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(2);
    expect(result.checks[1]!.passed).toBe(false);
  });

  it("marks the aggregate as failed when a required gate fails", async () => {
    const commandExecutor = {
      execute: vi.fn()
        .mockResolvedValueOnce({ exitCode: 0, output: "ok" })
        .mockResolvedValueOnce({ exitCode: 1, output: "required failure" }),
    } satisfies QualityGateCommandExecutor;
    const runner = new GateRunner({ cwd, commandExecutor });
    const gates: QualityGate[] = [
      gate({ name: "required-pass", command: "required-pass", required: true }),
      gate({ name: "required-fail", command: "required-fail", required: true }),
    ];

    const result = await runner.runRequired(gates);

    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.checks[1]!.passed).toBe(false);
  });

  it("measures duration", async () => {
    const runner = new GateRunner({
      cwd,
      commandExecutor: executor({ exitCode: 0, output: "hello" }),
    });
    const result = await runner.run(gate({ command: "echo hello" }));

    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("handles executor errors gracefully", async () => {
    const commandExecutor: QualityGateCommandExecutor = {
      execute: vi.fn().mockRejectedValue(new Error("spawn failed")),
    };
    const runner = new GateRunner({ cwd, commandExecutor });
    const result = await runner.run(gate({ command: "missing-command" }));

    expect(result.passed).toBe(false);
    expect(result.output).toBe("spawn failed");
  });
});

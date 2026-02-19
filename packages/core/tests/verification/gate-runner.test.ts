import { describe, it, expect } from "vitest";
import { GateRunner } from "../../src/verification/gate-runner.js";
import type { QualityGate } from "../../src/domain/index.js";

function gate(overrides: Partial<QualityGate> & { command: string }): QualityGate {
  return { name: "test-gate", description: "test", required: true, ...overrides };
}

const cwd = process.cwd();

describe("GateRunner", () => {
  it("runs a passing gate", async () => {
    const runner = new GateRunner({ cwd });
    const result = await runner.run(gate({ command: "echo hello" }));
    expect(result.passed).toBe(true);
    expect(result.name).toBe("test-gate");
  });

  it("runs a failing gate", async () => {
    const runner = new GateRunner({ cwd });
    const result = await runner.run(gate({ command: 'node -e "process.exit(1)"' }));
    expect(result.passed).toBe(false);
  });

  it("captures stdout output", async () => {
    const runner = new GateRunner({ cwd });
    const result = await runner.run(gate({ command: "echo hello" }));
    expect(result.output).toContain("hello");
  });

  it("truncates long output to 2000 chars", async () => {
    const runner = new GateRunner({ cwd });
    const result = await runner.run(
      gate({ command: `node -e "console.log('x'.repeat(3000))"` }),
    );
    expect(result.output.length).toBeLessThanOrEqual(2000);
  });

  it("timeout kills process and returns failure", async () => {
    const runner = new GateRunner({ cwd, timeoutMs: 200 });
    const result = await runner.run(
      gate({ command: `node -e "setTimeout(() => {}, 10000)"` }),
    );
    expect(result.passed).toBe(false);
    expect(result.output).toContain("timeout");
  }, 5000);

  it("runAll returns all results sequentially", async () => {
    const runner = new GateRunner({ cwd });
    const gates: QualityGate[] = [
      gate({ name: "pass", command: "echo ok" }),
      gate({ name: "fail", command: 'node -e "process.exit(1)"' }),
    ];
    const results = await runner.runAll(gates);
    expect(results).toHaveLength(2);
    expect(results[0]!.name).toBe("pass");
    expect(results[0]!.passed).toBe(true);
    expect(results[1]!.name).toBe("fail");
    expect(results[1]!.passed).toBe(false);
  });

  it("runRequired only checks required gates for passed status", async () => {
    const runner = new GateRunner({ cwd });
    const gates: QualityGate[] = [
      gate({ name: "required-pass", command: "echo ok", required: true }),
      gate({ name: "required-fail", command: 'node -e "process.exit(1)"', required: true }),
    ];
    const result = await runner.runRequired(gates);
    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(2);
  });

  it("non-required failure does not affect overall passed", async () => {
    const runner = new GateRunner({ cwd });
    const gates: QualityGate[] = [
      gate({ name: "required-pass", command: "echo ok", required: true }),
      gate({ name: "optional-fail", command: 'node -e "process.exit(1)"', required: false }),
    ];
    const result = await runner.runRequired(gates);
    expect(result.passed).toBe(true);
    expect(result.checks[1]!.passed).toBe(false);
  });

  it("measures duration (> 0)", async () => {
    const runner = new GateRunner({ cwd });
    const result = await runner.run(gate({ command: "echo hello" }));
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("handles spawn errors gracefully", async () => {
    const runner = new GateRunner({ cwd });
    const result = await runner.run(
      gate({ command: "this-command-does-not-exist-xyz-123" }),
    );
    expect(result.passed).toBe(false);
    expect(result.output.length).toBeGreaterThan(0);
  });
});

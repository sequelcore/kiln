import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type { QualityGate } from "../../src/domain/index.js";
import type { VerificationResultEvent } from "../../src/events/index.js";
import type { QualityGateCommandExecutor } from "../../src/quality-gates/index.js";

function passingGate(name = "echo-test"): QualityGate {
  return {
    name,
    command: "echo hello",
    description: "Always passes",
    required: true,
  };
}

function failingGate(name = "fail-test"): QualityGate {
  return {
    name,
    command: "node -e \"process.exit(1)\"",
    description: "Always fails",
    required: true,
  };
}

function commandExecutor(): QualityGateCommandExecutor & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn(async ({ command }: { readonly command: string }) => ({
      exitCode: command.includes("process.exit(1)") ? 1 : 0,
      output: command.includes("process.exit(1)") ? "failed" : "hello\n",
    })),
  };
}

describe("Orchestrator verification integration", () => {
  it("runVerification returns passed result when all gates pass", async () => {
    const orch = new Orchestrator({ requireApproval: false });
    orch.start("test task");
    const executor = commandExecutor();

    const result = await orch.runVerification(
      [passingGate()],
      process.cwd(),
      executor,
    );

    expect(result.passed).toBe(true);
    expect(result.checks.length).toBeGreaterThanOrEqual(1);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.iteration).toBe(1);
    expect(executor.execute).toHaveBeenCalledWith({
      command: "echo hello",
      cwd: process.cwd(),
      timeoutMs: 60_000,
    });
  });

  it("runVerification returns failed result when a gate fails", async () => {
    const orch = new Orchestrator({ requireApproval: false });
    orch.start("test task");
    const executor = commandExecutor();

    const result = await orch.runVerification(
      [passingGate("pass"), failingGate("fail")],
      process.cwd(),
      executor,
    );

    expect(result.passed).toBe(false);
    const failedCheck = result.checks.find((c) => c.name === "fail");
    expect(failedCheck).toBeDefined();
    expect(failedCheck!.passed).toBe(false);
  });

  it("verificationResult getter returns null before any run", () => {
    const orch = new Orchestrator({ requireApproval: false });

    expect(orch.verificationResult).toBeNull();
  });

  it("verificationResult getter returns last result after run", async () => {
    const orch = new Orchestrator({ requireApproval: false });
    orch.start("test task");
    const executor = commandExecutor();

    expect(orch.verificationResult).toBeNull();

    const result = await orch.runVerification(
      [passingGate()],
      process.cwd(),
      executor,
    );

    expect(orch.verificationResult).toBe(result);
    expect(orch.verificationResult!.passed).toBe(true);
  });

  it("emits verification_result event during run", async () => {
    const orch = new Orchestrator({ requireApproval: false });
    orch.start("test task");
    const executor = commandExecutor();

    const handler = vi.fn();
    orch.eventBus.on("verification_result", handler);

    await orch.runVerification(
      [passingGate()],
      process.cwd(),
      executor,
    );

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as VerificationResultEvent;
    expect(event.type).toBe("verification_result");
    expect(event.passed).toBe(true);
    expect(event.iteration).toBe(1);
    expect(event.checks.length).toBeGreaterThanOrEqual(1);
  });
});

import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/event-bus.js";
import type { VerificationResultEvent } from "../../src/events/index.js";
import type { VerificationCheck, VerificationConfig } from "../../src/verification/index.js";
import type { GateRunnerPort } from "../../src/verification/verification-loop.js";
import { VerificationLoop } from "../../src/verification/verification-loop.js";

function createMockGateRunner(
  results: { passed: boolean; checks: VerificationCheck[] }[],
): GateRunnerPort {
  let callIndex = 0;
  return {
    async runRequired() {
      return results[callIndex++] ?? results[results.length - 1]!;
    },
  };
}

const baseConfig: VerificationConfig = {
  maxIterations: 3,
  checks: [],
  screenshotEnabled: false,
  coverageThreshold: 0,
};

function makeCheck(name: string, passed: boolean, output = ""): VerificationCheck {
  return { name, passed, output, duration: 100 };
}

describe("VerificationLoop", () => {
  it("single iteration passes when all gates pass", async () => {
    const gateRunner = createMockGateRunner([
      { passed: true, checks: [makeCheck("lint", true), makeCheck("test", true)] },
    ]);
    const eventBus = new EventBus();
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: baseConfig,
      gates: [],
    });

    const result = await loop.run();

    expect(result.passed).toBe(true);
    expect(result.iteration).toBe(1);
    expect(result.maxIterations).toBe(3);
    expect(result.checks).toHaveLength(2);
  });

  it("returns failure when gates fail and no fixHandler", async () => {
    const gateRunner = createMockGateRunner([
      { passed: false, checks: [makeCheck("lint", false, "error: unused var")] },
    ]);
    const eventBus = new EventBus();
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: baseConfig,
      gates: [],
    });

    const result = await loop.run();

    expect(result.passed).toBe(false);
    expect(result.iteration).toBe(1);
  });

  it("retries with fixHandler on failure (mock returns fail then pass)", async () => {
    const gateRunner = createMockGateRunner([
      { passed: false, checks: [makeCheck("lint", false, "error")] },
      { passed: true, checks: [makeCheck("lint", true)] },
    ]);
    const eventBus = new EventBus();
    const fixHandler = vi.fn().mockResolvedValue(undefined);
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: baseConfig,
      gates: [],
    });

    const result = await loop.run(fixHandler);

    expect(result.passed).toBe(true);
    expect(result.iteration).toBe(2);
    expect(fixHandler).toHaveBeenCalledOnce();
  });

  it("stops retrying after maxIterations", async () => {
    const gateRunner = createMockGateRunner([
      { passed: false, checks: [makeCheck("lint", false, "error")] },
    ]);
    const eventBus = new EventBus();
    const fixHandler = vi.fn().mockResolvedValue(undefined);
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: { ...baseConfig, maxIterations: 2 },
      gates: [],
    });

    const result = await loop.run(fixHandler);

    expect(result.passed).toBe(false);
    expect(result.iteration).toBe(2);
    expect(fixHandler).toHaveBeenCalledOnce(); // called after iteration 1, not after 2
  });

  it("emits verification_result event per iteration", async () => {
    const gateRunner = createMockGateRunner([
      { passed: false, checks: [makeCheck("test", false, "1 failed")] },
      { passed: true, checks: [makeCheck("test", true, "all passed")] },
    ]);
    const eventBus = new EventBus();
    const handler = vi.fn();
    eventBus.on("verification_result", handler);
    const fixHandler = vi.fn().mockResolvedValue(undefined);
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: baseConfig,
      gates: [],
    });

    await loop.run(fixHandler);

    expect(handler).toHaveBeenCalledTimes(2);
    const firstEvent = handler.mock.calls[0]![0] as VerificationResultEvent;
    expect(firstEvent.passed).toBe(false);
    expect(firstEvent.iteration).toBe(1);
    const secondEvent = handler.mock.calls[1]![0] as VerificationResultEvent;
    expect(secondEvent.passed).toBe(true);
    expect(secondEvent.iteration).toBe(2);
  });

  it("coverage check fails when below threshold", async () => {
    const gateRunner = createMockGateRunner([
      {
        passed: true,
        checks: [makeCheck("test", true, "TOTAL    100    40    60%")],
      },
    ]);
    const eventBus = new EventBus();
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: { ...baseConfig, coverageThreshold: 80 },
      gates: [],
    });

    const result = await loop.run();

    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(2);
    const coverageCheck = result.checks.find((c) => c.name === "coverage");
    expect(coverageCheck).toBeDefined();
    expect(coverageCheck!.passed).toBe(false);
    expect(coverageCheck!.output).toContain("60%");
    expect(coverageCheck!.output).toContain("80%");
  });

  it("coverage check passes when above threshold", async () => {
    const gateRunner = createMockGateRunner([
      {
        passed: true,
        checks: [makeCheck("test", true, "TOTAL    100    20    80%")],
      },
    ]);
    const eventBus = new EventBus();
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: { ...baseConfig, coverageThreshold: 80 },
      gates: [],
    });

    const result = await loop.run();

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(1); // no synthetic coverage check added
  });

  it("fix handler is called with failed checks only", async () => {
    const gateRunner = createMockGateRunner([
      {
        passed: false,
        checks: [
          makeCheck("lint", true, "ok"),
          makeCheck("test", false, "2 failed"),
          makeCheck("typecheck", false, "TS2322"),
        ],
      },
      { passed: true, checks: [makeCheck("lint", true), makeCheck("test", true), makeCheck("typecheck", true)] },
    ]);
    const eventBus = new EventBus();
    const fixHandler = vi.fn().mockResolvedValue(undefined);
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: baseConfig,
      gates: [],
    });

    await loop.run(fixHandler);

    expect(fixHandler).toHaveBeenCalledOnce();
    const failedChecks = fixHandler.mock.calls[0]![0] as VerificationCheck[];
    expect(failedChecks).toHaveLength(2);
    expect(failedChecks[0]!.name).toBe("test");
    expect(failedChecks[1]!.name).toBe("typecheck");
  });

  it("succeeds on second iteration after fix", async () => {
    const gateRunner = createMockGateRunner([
      { passed: false, checks: [makeCheck("test", false, "FAIL")] },
      { passed: true, checks: [makeCheck("test", true, "PASS")] },
    ]);
    const eventBus = new EventBus();
    const fixHandler = vi.fn().mockResolvedValue(undefined);
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: baseConfig,
      gates: [],
    });

    const result = await loop.run(fixHandler);

    expect(result.passed).toBe(true);
    expect(result.iteration).toBe(2);
    expect(result.checks[0]!.output).toBe("PASS");
  });

  it("does not call fixHandler when all pass on first try", async () => {
    const gateRunner = createMockGateRunner([
      { passed: true, checks: [makeCheck("lint", true), makeCheck("test", true)] },
    ]);
    const eventBus = new EventBus();
    const fixHandler = vi.fn().mockResolvedValue(undefined);
    const loop = new VerificationLoop({
      gateRunner,
      eventBus,
      config: baseConfig,
      gates: [],
    });

    const result = await loop.run(fixHandler);

    expect(result.passed).toBe(true);
    expect(result.iteration).toBe(1);
    expect(fixHandler).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/event-bus.js";
import { PhaseMachine } from "../../src/orchestrator/phase-machine.js";
import type {
  OrchestratorConfig,
  Phase,
  PhaseGateResult,
} from "../../src/orchestrator/index.js";
import type {
  PhaseChangedEvent,
  ErrorEvent,
  ApprovalRequestedEvent,
  ApprovalReceivedEvent,
} from "../../src/events/index.js";

function makeConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    requireApproval: false,
    maxDepth: 3,
    parallelWorkers: 2,
    phases: ["analyze", "research", "architect", "implement", "verify", "synthesize"],
    ...overrides,
  };
}

function makeGateResult(passed: boolean, violations: string[] = []): PhaseGateResult {
  return { passed, phase: "analyze", violations };
}

describe("PhaseMachine", () => {
  it("starts at analyze phase with idle status", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());

    expect(machine.currentPhase).toBe("analyze");
    expect(machine.status).toBe("idle");
  });

  it("cannot advance when idle (not started)", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());

    expect(machine.advance()).toBeNull();
    expect(machine.currentPhase).toBe("analyze");
  });

  it("advances through all 6 phases in order", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();

    const expected: Phase[] = ["research", "architect", "implement", "verify", "synthesize"];
    for (const phase of expected) {
      const result = machine.advance();
      expect(result).toBe(phase);
      expect(machine.currentPhase).toBe(phase);
    }
  });

  it("emits phase_changed event on each transition", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("phase_changed", handler);

    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();
    machine.advance(); // analyze -> research

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as PhaseChangedEvent;
    expect(event.type).toBe("phase_changed");
    expect(event.phase).toBe("research");
    expect(event.phaseName).toBe("Research");
  });

  it("blocks on failed gate result and returns null", () => {
    const bus = new EventBus();
    const errorHandler = vi.fn();
    bus.on("error", errorHandler);

    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();

    const gate = makeGateResult(false, ["missing tests", "lint errors"]);
    const result = machine.advance(gate);

    expect(result).toBeNull();
    expect(machine.currentPhase).toBe("analyze"); // did not advance
    expect(errorHandler).toHaveBeenCalledOnce();
    const event = errorHandler.mock.calls[0]![0] as ErrorEvent;
    expect(event.message).toContain("missing tests");
    expect(event.message).toContain("lint errors");
  });

  it("advances on passing gate result", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();

    const gate = makeGateResult(true);
    const result = machine.advance(gate);
    expect(result).toBe("research");
  });

  it("cannot advance past synthesize (returns null and sets completed)", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();

    // Advance to synthesize
    for (let i = 0; i < 5; i++) machine.advance();
    expect(machine.currentPhase).toBe("synthesize");

    // Try to advance past synthesize
    const result = machine.advance();
    expect(result).toBeNull();
    expect(machine.status).toBe("completed");
  });

  it("cannot advance after completed", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();

    // Advance to completion
    for (let i = 0; i < 5; i++) machine.advance();
    machine.advance(); // sets completed

    expect(machine.advance()).toBeNull();
    expect(machine.status).toBe("completed");
  });

  // --- Approval flow ---

  it("pauses at architect when requireApproval is true", async () => {
    const bus = new EventBus();
    const approvalHandler = vi.fn();
    bus.on("approval_requested", approvalHandler);

    const machine = new PhaseMachine(bus, makeConfig({ requireApproval: true }));
    machine.start();

    machine.advance(); // analyze -> research
    machine.advance(); // research -> architect

    // Now at architect, try to advance
    const result = machine.advance();
    expect(result).toBeInstanceOf(Promise);
    expect(machine.status).toBe("awaiting_approval");
    expect(machine.currentPhase).toBe("architect");
    expect(approvalHandler).toHaveBeenCalledOnce();
    const event = approvalHandler.mock.calls[0]![0] as ApprovalRequestedEvent;
    expect(event.type).toBe("approval_requested");
  });

  it("approve() resolves the approval promise and advances to implement", async () => {
    const bus = new EventBus();
    const phaseHandler = vi.fn();
    const approvalReceivedHandler = vi.fn();
    bus.on("phase_changed", phaseHandler);
    bus.on("approval_received", approvalReceivedHandler);

    const machine = new PhaseMachine(bus, makeConfig({ requireApproval: true }));
    machine.start();
    machine.advance(); // -> research
    machine.advance(); // -> architect

    const promise = machine.advance() as Promise<Phase | null>;
    machine.approve();

    const result = await promise;
    expect(result).toBe("implement");
    expect(machine.currentPhase).toBe("implement");
    expect(machine.status).toBe("running");

    // Should have emitted approval_received (approved: true)
    expect(approvalReceivedHandler).toHaveBeenCalledOnce();
    const event = approvalReceivedHandler.mock.calls[0]![0] as ApprovalReceivedEvent;
    expect(event.approved).toBe(true);

    // Should have emitted phase_changed for implement
    const lastPhaseEvent = phaseHandler.mock.calls.at(-1)![0] as PhaseChangedEvent;
    expect(lastPhaseEvent.phase).toBe("implement");
  });

  it("reject() keeps phase at architect and resolves promise with null", async () => {
    const bus = new EventBus();
    const approvalReceivedHandler = vi.fn();
    bus.on("approval_received", approvalReceivedHandler);

    const machine = new PhaseMachine(bus, makeConfig({ requireApproval: true }));
    machine.start();
    machine.advance(); // -> research
    machine.advance(); // -> architect

    const promise = machine.advance() as Promise<Phase | null>;
    machine.reject("plan is incomplete");

    const result = await promise;
    expect(result).toBeNull();
    expect(machine.currentPhase).toBe("architect");
    expect(machine.status).toBe("running");

    const event = approvalReceivedHandler.mock.calls[0]![0] as ApprovalReceivedEvent;
    expect(event.approved).toBe(false);
  });

  it("can re-enter approval flow after rejection", async () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig({ requireApproval: true }));
    machine.start();
    machine.advance(); // -> research
    machine.advance(); // -> architect

    // First attempt: rejected
    const promise1 = machine.advance() as Promise<Phase | null>;
    machine.reject("needs more detail");
    const result1 = await promise1;
    expect(result1).toBeNull();
    expect(machine.currentPhase).toBe("architect");

    // Second attempt: approved
    const promise2 = machine.advance() as Promise<Phase | null>;
    machine.approve();
    const result2 = await promise2;
    expect(result2).toBe("implement");
    expect(machine.currentPhase).toBe("implement");
  });

  it("skips approval gate when requireApproval is false", () => {
    const bus = new EventBus();
    const approvalHandler = vi.fn();
    bus.on("approval_requested", approvalHandler);

    const machine = new PhaseMachine(bus, makeConfig({ requireApproval: false }));
    machine.start();
    machine.advance(); // -> research
    machine.advance(); // -> architect

    const result = machine.advance(); // should advance directly to implement
    expect(result).toBe("implement");
    expect(machine.currentPhase).toBe("implement");
    expect(approvalHandler).not.toHaveBeenCalled();
  });

  // --- fail / cancel / reset ---

  it("fail() sets status to failed and emits error", () => {
    const bus = new EventBus();
    const errorHandler = vi.fn();
    bus.on("error", errorHandler);

    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();
    machine.advance(); // -> research

    machine.fail("something went wrong");

    expect(machine.status).toBe("failed");
    expect(errorHandler).toHaveBeenCalledOnce();
    const event = errorHandler.mock.calls[0]![0] as ErrorEvent;
    expect(event.message).toBe("something went wrong");
  });

  it("cannot advance after fail()", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();
    machine.fail("error");

    expect(machine.advance()).toBeNull();
    expect(machine.currentPhase).toBe("analyze");
  });

  it("cancel() sets status to cancelled", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();
    machine.cancel();

    expect(machine.status).toBe("cancelled");
  });

  it("cannot advance after cancel()", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();
    machine.advance(); // -> research
    machine.cancel();

    expect(machine.advance()).toBeNull();
    expect(machine.currentPhase).toBe("research");
  });

  it("reset() returns to initial state", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();
    machine.advance(); // -> research
    machine.advance(); // -> architect

    machine.reset();

    expect(machine.currentPhase).toBe("analyze");
    expect(machine.status).toBe("idle");
  });

  it("reset() clears pending approval promise", async () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig({ requireApproval: true }));
    machine.start();
    machine.advance(); // -> research
    machine.advance(); // -> architect
    machine.advance(); // returns promise, sets awaiting_approval

    machine.reset();

    expect(machine.currentPhase).toBe("analyze");
    expect(machine.status).toBe("idle");

    // Can start fresh
    machine.start();
    expect(machine.advance()).toBe("research");
  });

  it("approve() is a no-op when not awaiting approval", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("approval_received", handler);

    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();
    machine.approve(); // should not throw or emit

    expect(handler).not.toHaveBeenCalled();
    expect(machine.currentPhase).toBe("analyze");
  });

  it("reject() is a no-op when not awaiting approval", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("approval_received", handler);

    const machine = new PhaseMachine(bus, makeConfig());
    machine.start();
    machine.reject("no reason"); // should not throw or emit

    expect(handler).not.toHaveBeenCalled();
  });

  it("start() sets status to running", () => {
    const bus = new EventBus();
    const machine = new PhaseMachine(bus, makeConfig());

    expect(machine.status).toBe("idle");
    machine.start();
    expect(machine.status).toBe("running");
  });

  it("emits events with correct sessionId", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("phase_changed", handler);

    const machine = new PhaseMachine(bus, makeConfig());
    machine.setSessionId("my-session");
    machine.start();
    machine.advance();

    const event = handler.mock.calls[0]![0] as PhaseChangedEvent;
    expect(event.sessionId).toBe("my-session");
  });
});

import { describe, it, expect, vi } from "vitest";
import { DevOrchestrator } from "../../src/gateway/dev-orchestrator.js";
import { ApprovalGateRegistry } from "../../src/gateway/approval-registry.js";
import { EventBus } from "@kilnai/core";
import type { KilnEvent } from "@kilnai/core";

function createSetup(requireApproval = true) {
  const eventBus = new EventBus(100);
  const approvalRegistry = new ApprovalGateRegistry();
  const devOrch = new DevOrchestrator({ eventBus, approvalRegistry, requireApproval });
  return { eventBus, approvalRegistry, devOrch };
}

describe("DevOrchestrator", () => {
  it("start() returns a sessionId", () => {
    const { devOrch } = createSetup();
    const sessionId = devOrch.start("Build a feature");
    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe("string");
  });

  it("start() registers ApprovalTarget with registry", async () => {
    const { devOrch, approvalRegistry } = createSetup(true);
    const sessionId = devOrch.start("Build a feature");

    // Wait for approval gate
    await vi.waitFor(() => {
      expect(devOrch.orchestrator.status).toBe("awaiting_approval");
    }, { timeout: 2000 });

    // The target should be registered -- approve should succeed
    const result = approvalRegistry.approve(sessionId);
    expect(result.ok).toBe(true);
  });

  it("start() throws when already running", async () => {
    const { devOrch } = createSetup(true);
    devOrch.start("Task 1");

    // Wait for approval gate so we know it's still running
    await vi.waitFor(() => {
      expect(devOrch.orchestrator.status).toBe("awaiting_approval");
    }, { timeout: 2000 });

    expect(() => devOrch.start("Task 2")).toThrow("A run is already in progress");
  });

  it("bridges orchestrator events to gateway EventBus", () => {
    const { devOrch, eventBus } = createSetup(false);
    const received: KilnEvent[] = [];
    eventBus.onAny((event) => received.push(event));

    devOrch.start("Bridge test");

    // The orchestrator emits phase_changed on start()
    const phaseEvents = received.filter((e) => e.type === "phase_changed");
    expect(phaseEvents.length).toBeGreaterThan(0);
  });

  it("completes all phases when requireApproval is false", async () => {
    const { devOrch } = createSetup(false);
    devOrch.start("Complete all phases");

    // Allow the fire-and-forget loop to complete
    await vi.waitFor(() => {
      expect(devOrch.isRunning).toBe(false);
    }, { timeout: 2000 });

    expect(devOrch.orchestrator.status).toBe("completed");
  });

  it("pauses at approval gate when requireApproval is true", async () => {
    const { devOrch } = createSetup(true);
    devOrch.start("Need approval");

    // Wait for the orchestrator to reach approval gate
    await vi.waitFor(() => {
      expect(devOrch.orchestrator.status).toBe("awaiting_approval");
    }, { timeout: 2000 });

    expect(devOrch.isRunning).toBe(true);
  });

  it("approvalRegistry.approve() resumes phase loop past gate", async () => {
    const { devOrch, approvalRegistry } = createSetup(true);
    const sessionId = devOrch.start("Approve me");

    await vi.waitFor(() => {
      expect(devOrch.orchestrator.status).toBe("awaiting_approval");
    }, { timeout: 2000 });

    approvalRegistry.approve(sessionId);

    await vi.waitFor(() => {
      expect(devOrch.isRunning).toBe(false);
    }, { timeout: 2000 });

    expect(devOrch.orchestrator.status).toBe("completed");
  });

  it("approvalRegistry.reject() stops loop", async () => {
    const { devOrch, approvalRegistry } = createSetup(true);
    const sessionId = devOrch.start("Reject me");

    await vi.waitFor(() => {
      expect(devOrch.orchestrator.status).toBe("awaiting_approval");
    }, { timeout: 2000 });

    approvalRegistry.reject("Bad plan", sessionId);

    await vi.waitFor(() => {
      expect(devOrch.isRunning).toBe(false);
    }, { timeout: 2000 });

    // After rejection, DevOrchestrator cancels the orchestrator
    expect(devOrch.orchestrator.status).toBe("cancelled");
  });

  it("isRunning reflects live status", () => {
    const { devOrch } = createSetup(false);
    expect(devOrch.isRunning).toBe(false);
    devOrch.start("Check running");
    // Right after start, the orchestrator is running
    expect(devOrch.orchestrator.status === "running" || devOrch.orchestrator.status === "completed").toBe(true);
  });

  it("unregisters from approval registry on completion", async () => {
    const { devOrch, approvalRegistry } = createSetup(false);
    const sessionId = devOrch.start("Cleanup test");

    await vi.waitFor(() => {
      expect(devOrch.isRunning).toBe(false);
    }, { timeout: 2000 });

    // After completion, the registry should not find the session
    const result = approvalRegistry.approve(sessionId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Session not found");
  });

  it("removes event bridge on completion", async () => {
    const { devOrch } = createSetup(false);
    const offAny = vi.spyOn(devOrch.orchestrator.eventBus, "offAny");

    devOrch.start("Bridge cleanup test");

    await vi.waitFor(() => {
      expect(devOrch.isRunning).toBe(false);
    }, { timeout: 2000 });

    expect(offAny).toHaveBeenCalled();
  });

  it("exposes inner orchestrator", () => {
    const { devOrch } = createSetup();
    expect(devOrch.orchestrator).toBeDefined();
    expect(devOrch.orchestrator.status).toBe("idle");
  });

  it("can start a new run after previous completes", async () => {
    const { devOrch } = createSetup(false);
    devOrch.start("First run");

    await vi.waitFor(() => {
      expect(devOrch.isRunning).toBe(false);
    }, { timeout: 2000 });

    // DevOrchestrator creates a single Orchestrator in constructor,
    // so a second start on the same orchestrator should work since
    // Orchestrator.start() resets state via PhaseMachine.reset()
    const sessionId2 = devOrch.start("Second run");
    expect(sessionId2).toBeTruthy();

    await vi.waitFor(() => {
      expect(devOrch.isRunning).toBe(false);
    }, { timeout: 2000 });

    expect(devOrch.orchestrator.status).toBe("completed");
  });
});

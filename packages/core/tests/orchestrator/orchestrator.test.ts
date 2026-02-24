import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type {
  OrchestratorConfig,
  Phase,
} from "../../src/orchestrator/index.js";
import type {
  PhaseChangedEvent,
} from "../../src/events/index.js";

function makeConfig(overrides?: Partial<OrchestratorConfig>): Partial<OrchestratorConfig> {
  return {
    requireApproval: false,
    maxDepth: 3,
    parallelWorkers: 2,
    phases: ["analyze", "research", "architect", "implement", "verify", "synthesize"],
    ...overrides,
  };
}

describe("Orchestrator", () => {
  it("creates with default config", () => {
    const orch = new Orchestrator();

    expect(orch.config.requireApproval).toBe(true);
    expect(orch.config.maxDepth).toBe(3);
    expect(orch.config.parallelWorkers).toBe(2);
    expect(orch.config.phases).toEqual([
      "analyze", "research", "architect", "implement", "verify", "synthesize",
    ]);
  });

  it("creates with custom config overrides", () => {
    const orch = new Orchestrator({ requireApproval: false, maxDepth: 5 });

    expect(orch.config.requireApproval).toBe(false);
    expect(orch.config.maxDepth).toBe(5);
    expect(orch.config.parallelWorkers).toBe(2); // default
  });

  it("starts idle with no session", () => {
    const orch = new Orchestrator(makeConfig());

    expect(orch.status).toBe("idle");
    expect(orch.currentPhase).toBe("analyze");
    expect(orch.sessionId).toBeNull();
    expect(orch.task).toBeNull();
  });

  it("start() sets status to running and phase to analyze", () => {
    const orch = new Orchestrator(makeConfig());
    const sessionId = orch.start("Refactor auth to JWT");

    expect(orch.status).toBe("running");
    expect(orch.currentPhase).toBe("analyze");
    expect(orch.sessionId).toBe(sessionId);
    expect(orch.task).toBe("Refactor auth to JWT");
  });

  it("start() returns a unique session ID", () => {
    const orch = new Orchestrator(makeConfig());
    const id1 = orch.start("task 1");
    const id2 = orch.start("task 2");

    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(0);
  });

  it("start() emits phase_changed for initial analyze phase", () => {
    const orch = new Orchestrator(makeConfig());
    const handler = vi.fn();
    orch.eventBus.on("phase_changed", handler);

    const sessionId = orch.start("task");

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as PhaseChangedEvent;
    expect(event.type).toBe("phase_changed");
    expect(event.phase).toBe("analyze");
    expect(event.phaseName).toBe("Analyze");
    expect(event.sessionId).toBe(sessionId);
  });

  it("advancePhase() progresses through phases", () => {
    const orch = new Orchestrator(makeConfig());
    orch.start("task");

    const expected: Phase[] = ["research", "architect", "implement", "verify", "synthesize"];
    for (const phase of expected) {
      const result = orch.advancePhase();
      expect(result).toBe(phase);
      expect(orch.currentPhase).toBe(phase);
    }
  });

  it("emits phase_changed events for each advance", () => {
    const orch = new Orchestrator(makeConfig());
    const handler = vi.fn();
    orch.eventBus.on("phase_changed", handler);

    orch.start("task"); // emits analyze
    orch.advancePhase(); // emits research
    orch.advancePhase(); // emits architect

    expect(handler).toHaveBeenCalledTimes(3);
    const phases = handler.mock.calls.map(
      (call: [PhaseChangedEvent]) => call[0].phase,
    );
    expect(phases).toEqual(["analyze", "research", "architect"]);
  });

  it("approval flow: start -> advance to architect -> approve -> advance to implement", async () => {
    const orch = new Orchestrator(makeConfig({ requireApproval: true }));
    orch.start("task");

    orch.advancePhase(); // -> research
    orch.advancePhase(); // -> architect

    // Try to advance past architect -- should return a promise
    const promise = orch.advancePhase();
    expect(promise).toBeInstanceOf(Promise);
    expect(orch.status).toBe("awaiting_approval");

    orch.approve();

    const result = await promise;
    expect(result).toBe("implement");
    expect(orch.currentPhase).toBe("implement");
    expect(orch.status).toBe("running");
  });

  it("reject() keeps phase at architect", async () => {
    const orch = new Orchestrator(makeConfig({ requireApproval: true }));
    orch.start("task");

    orch.advancePhase(); // -> research
    orch.advancePhase(); // -> architect

    const promise = orch.advancePhase() as Promise<Phase | null>;
    orch.reject("plan needs more detail");

    const result = await promise;
    expect(result).toBeNull();
    expect(orch.currentPhase).toBe("architect");
    expect(orch.status).toBe("running");
  });

  it("cancel() stops the session", () => {
    const orch = new Orchestrator(makeConfig());
    orch.start("task");
    orch.advancePhase(); // -> research

    orch.cancel();

    expect(orch.status).toBe("cancelled");
    expect(orch.advancePhase()).toBeNull();
  });

  it("costSummary returns initial empty summary", () => {
    const orch = new Orchestrator(makeConfig());
    const summary = orch.costSummary;

    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.totalToolCalls).toBe(0);
    expect(Object.keys(summary.byRole)).toHaveLength(0);
  });

  it("task getter returns the task string after start", () => {
    const orch = new Orchestrator(makeConfig());

    expect(orch.task).toBeNull();
    orch.start("Add dark mode to settings");
    expect(orch.task).toBe("Add dark mode to settings");
  });

  it("session ID changes on each start() call", () => {
    const orch = new Orchestrator(makeConfig());
    const id1 = orch.start("task 1");

    // Advance and cancel first session
    orch.cancel();

    const id2 = orch.start("task 2");
    expect(id1).not.toBe(id2);
    expect(orch.sessionId).toBe(id2);
    expect(orch.task).toBe("task 2");
  });

  it("exposes eventBus for external subscribers", () => {
    const orch = new Orchestrator(makeConfig());
    const handler = vi.fn();

    orch.eventBus.on("phase_changed", handler);
    orch.start("task");

    expect(handler).toHaveBeenCalledOnce();
  });

  it("completes after advancing past synthesize", () => {
    const orch = new Orchestrator(makeConfig());
    orch.start("task");

    for (let i = 0; i < 5; i++) orch.advancePhase();
    expect(orch.currentPhase).toBe("synthesize");

    const result = orch.advancePhase();
    expect(result).toBeNull();
    expect(orch.status).toBe("completed");
  });
});

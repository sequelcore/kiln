import { describe, it, expect } from "vitest";
import {
  PHASES,
  PHASE_LABELS,
  TASK_ICONS,
  phaseState,
  formatPhaseBar,
  formatTaskNode,
  formatTaskTree,
  formatCost,
  costColor,
  formatEvent,
  formatActivityLog,
  stripAnsi,
} from "../../src/formatters.js";
import type { TaskNode, TaskStatus } from "@kilnai/core";
import type { KilnEvent, PhaseChangedEvent, TaskStartedEvent, ErrorEvent } from "@kilnai/core";

function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "abc12345-1234-1234-1234-123456789abc",
    parentId: null,
    statement: "Implement validation logic",
    status: "proposed",
    depth: 0,
    priority: 1,
    branchScore: 1,
    children: [],
    evidence: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<KilnEvent>): KilnEvent {
  return {
    type: "phase_changed",
    timestamp: new Date("2026-02-17T00:00:00Z"),
    sessionId: "test-session",
    ...overrides,
  } as KilnEvent;
}

describe("phaseState", () => {
  it("returns 'done' for phases before current", () => {
    expect(phaseState("analyze", "architect", "running")).toBe("done");
    expect(phaseState("research", "architect", "running")).toBe("done");
  });

  it("returns 'active' for current phase", () => {
    expect(phaseState("architect", "architect", "running")).toBe("active");
    expect(phaseState("analyze", "analyze", "running")).toBe("active");
  });

  it("returns 'pending' for phases after current", () => {
    expect(phaseState("implement", "architect", "running")).toBe("pending");
    expect(phaseState("verify", "architect", "running")).toBe("pending");
    expect(phaseState("synthesize", "architect", "running")).toBe("pending");
  });

  it("returns 'done' for all completed phases when status is completed", () => {
    expect(phaseState("analyze", "synthesize", "completed")).toBe("done");
    expect(phaseState("synthesize", "synthesize", "completed")).toBe("done");
  });

  it("returns 'pending' for phases after current when status is completed", () => {
    // If orchestrator completed at architect phase (unusual but possible)
    expect(phaseState("implement", "architect", "completed")).toBe("pending");
  });
});

describe("formatPhaseBar", () => {
  it("shows checkmarks for done phases", () => {
    const bar = formatPhaseBar("architect", "running");
    expect(bar).toContain("\u2713 Analyze");
    expect(bar).toContain("\u2713 Research");
  });

  it("shows dot for active phase", () => {
    const bar = formatPhaseBar("architect", "running");
    expect(bar).toContain("\u25CF Architect");
  });

  it("shows empty brackets for pending phases", () => {
    const bar = formatPhaseBar("architect", "running");
    expect(bar).toContain("[ Implement]");
    expect(bar).toContain("[ Verify]");
    expect(bar).toContain("[ Synthesize]");
  });

  it("separates phases with >", () => {
    const bar = formatPhaseBar("analyze", "running");
    expect(bar).toContain("] > [");
  });

  it("renders all 6 phases", () => {
    const bar = formatPhaseBar("analyze", "running");
    for (const phase of PHASES) {
      expect(bar).toContain(PHASE_LABELS[phase]);
    }
  });
});

describe("TASK_ICONS", () => {
  it("has all 6 statuses", () => {
    const statuses: TaskStatus[] = [
      "proposed",
      "testing",
      "supported",
      "refuted",
      "rejected",
      "revised",
    ];
    for (const s of statuses) {
      expect(TASK_ICONS[s]).toBeDefined();
      expect(typeof TASK_ICONS[s]).toBe("string");
    }
  });
});

describe("formatTaskNode", () => {
  it("indents by depth", () => {
    const node0 = makeNode({ depth: 0 });
    const node1 = makeNode({ depth: 1 });
    const node2 = makeNode({ depth: 2 });

    expect(formatTaskNode(node0)).toMatch(/^\u25CB/);
    expect(formatTaskNode(node1)).toMatch(/^  \u25CB/);
    expect(formatTaskNode(node2)).toMatch(/^    \u25CB/);
  });

  it("truncates long statements to 60 chars", () => {
    const longStatement =
      "This is a very long statement that should definitely be truncated because it exceeds sixty characters";
    const node = makeNode({ statement: longStatement });
    const formatted = formatTaskNode(node);
    // Icon + space + truncated text
    const textPart = formatted.replace(/^\u25CB /, "");
    expect(textPart.length).toBeLessThanOrEqual(60);
    expect(textPart).toContain("...");
  });

  it("does not truncate short statements", () => {
    const node = makeNode({ statement: "Short task" });
    const formatted = formatTaskNode(node);
    expect(formatted).toContain("Short task");
    expect(formatted).not.toContain("...");
  });

  it("uses correct icon for each status", () => {
    expect(formatTaskNode(makeNode({ status: "proposed" }))).toContain("\u25CB");
    expect(formatTaskNode(makeNode({ status: "testing" }))).toContain("\u25C9");
    expect(formatTaskNode(makeNode({ status: "supported" }))).toContain("\u2713");
    expect(formatTaskNode(makeNode({ status: "refuted" }))).toContain("\u2717");
  });
});

describe("formatTaskTree", () => {
  it("sorts by depth first", () => {
    const nodes = [
      makeNode({ id: "c", depth: 2, statement: "Deep task" }),
      makeNode({ id: "a", depth: 0, statement: "Root task" }),
      makeNode({ id: "b", depth: 1, statement: "Mid task" }),
    ];
    const lines = formatTaskTree(nodes);
    expect(lines[0]).toContain("Root task");
    expect(lines[1]).toContain("Mid task");
    expect(lines[2]).toContain("Deep task");
  });

  it("returns array of formatted lines", () => {
    const nodes = [
      makeNode({ statement: "Task A" }),
      makeNode({ statement: "Task B" }),
    ];
    const lines = formatTaskTree(nodes);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Task A");
    expect(lines[1]).toContain("Task B");
  });

  it("returns empty array for empty nodes", () => {
    expect(formatTaskTree([])).toEqual([]);
  });
});

describe("formatCost", () => {
  it("includes role breakdown", () => {
    const summary = {
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalToolCalls: 5,
      totalCostUsd: 0.42,
      byRoleModel: {
        "architect:claude-opus-4-6": {
          role: "architect" as const,
          model: "claude-opus-4-6",
          inputTokens: 600,
          outputTokens: 300,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          calls: 3,
        },
        "worker:claude-sonnet-4-6": {
          role: "worker" as const,
          model: "claude-sonnet-4-6",
          inputTokens: 400,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          calls: 2,
        },
      },
    };
    const result = formatCost(summary);
    expect(result).toContain("Cost: $0.42");
    expect(result).toContain("architect:");
    expect(result).toContain("worker:");
  });

  it("handles empty byRoleModel", () => {
    const summary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalToolCalls: 0,
      totalCostUsd: 0,
      byRoleModel: {},
    };
    const result = formatCost(summary);
    expect(result).toBe("Cost: $0.00");
  });
});

describe("costColor", () => {
  it("returns green for < $1", () => {
    expect(costColor(0)).toBe("green");
    expect(costColor(0.5)).toBe("green");
    expect(costColor(0.99)).toBe("green");
  });

  it("returns yellow for < $5", () => {
    expect(costColor(1)).toBe("yellow");
    expect(costColor(2.5)).toBe("yellow");
    expect(costColor(4.99)).toBe("yellow");
  });

  it("returns red for >= $5", () => {
    expect(costColor(5)).toBe("red");
    expect(costColor(10)).toBe("red");
    expect(costColor(100)).toBe("red");
  });
});

describe("formatEvent", () => {
  it("formats phase_changed", () => {
    const event = {
      ...makeEvent({ type: "phase_changed" }),
      phase: "architect",
      phaseName: "Architect",
      phaseDescription: "Design the implementation plan",
    } as PhaseChangedEvent;
    expect(formatEvent(event)).toBe("[Phase] \u2192 Architect");
  });

  it("formats task_started", () => {
    const event = {
      ...makeEvent({ type: "task_started" }),
      taskId: "abc12345",
      statement: "Add error handling",
      parentId: null,
    } as TaskStartedEvent;
    expect(formatEvent(event)).toBe("[Task] Started: Add error handling");
  });

  it("formats task_started with truncation", () => {
    const longStatement =
      "This is a very long task statement that should be truncated at fifty chars";
    const event = {
      ...makeEvent({ type: "task_started" }),
      taskId: "abc12345",
      statement: longStatement,
      parentId: null,
    } as TaskStartedEvent;
    const result = formatEvent(event);
    expect(result).toContain("[Task] Started:");
    expect(result).toContain("...");
  });

  it("formats error", () => {
    const event = {
      ...makeEvent({ type: "error" }),
      message: "Connection timeout",
      code: "TIMEOUT",
      taskId: null,
    } as ErrorEvent;
    expect(formatEvent(event)).toBe("[Error] Connection timeout");
  });

  it("formats tool_called", () => {
    const event = {
      ...makeEvent({ type: "tool_called" }),
      toolName: "Edit",
      taskId: "abc",
      workerIndex: 0,
    };
    expect(formatEvent(event)).toBe("[Tool] Edit (worker 0)");
  });

  it("formats cost_update", () => {
    const event = {
      ...makeEvent({ type: "cost_update" }),
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      totalCostUsd: 0.42,
      byRoleModel: {},
    };
    expect(formatEvent(event)).toBe("[Cost] $0.42 total");
  });

  it("formats unknown event types as [type]", () => {
    const event = makeEvent({ type: "thinking" as KilnEvent["type"] });
    expect(formatEvent(event)).toBe("[thinking]");
  });
});

describe("formatActivityLog", () => {
  it("returns last N events", () => {
    const events: KilnEvent[] = Array.from({ length: 20 }, (_, i) => ({
      ...makeEvent({ type: "phase_changed" }),
      phase: "analyze",
      phaseName: `Phase ${i}`,
      phaseDescription: "",
    })) as unknown as KilnEvent[];

    const result = formatActivityLog(events, 5);
    expect(result).toHaveLength(5);
    expect(result[4]).toContain("Phase 19");
  });

  it("defaults to 8 lines", () => {
    const events: KilnEvent[] = Array.from({ length: 20 }, (_, i) => ({
      ...makeEvent({ type: "phase_changed" }),
      phase: "analyze",
      phaseName: `Phase ${i}`,
      phaseDescription: "",
    })) as unknown as KilnEvent[];

    const result = formatActivityLog(events);
    expect(result).toHaveLength(8);
  });

  it("returns all events when fewer than maxLines", () => {
    const events: KilnEvent[] = [
      {
        ...makeEvent({ type: "phase_changed" }),
        phase: "analyze",
        phaseName: "Analyze",
        phaseDescription: "",
      } as unknown as KilnEvent,
    ];
    const result = formatActivityLog(events);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for no events", () => {
    expect(formatActivityLog([])).toEqual([]);
  });
});

describe("stripAnsi", () => {
  it("strips SGR color codes", () => {
    expect(stripAnsi("\x1B[32mgreen\x1B[0m")).toBe("green");
  });

  it("strips multiple SGR codes", () => {
    expect(stripAnsi("\x1B[1m\x1B[31mbold red\x1B[0m")).toBe("bold red");
  });

  it("strips cursor movement codes", () => {
    expect(stripAnsi("\x1B[2Aup two lines")).toBe("up two lines");
    expect(stripAnsi("\x1B[3Bdown three")).toBe("down three");
    expect(stripAnsi("\x1B[10Cright ten")).toBe("right ten");
    expect(stripAnsi("\x1B[5Dleft five")).toBe("left five");
  });

  it("strips erase codes", () => {
    expect(stripAnsi("\x1B[2Jclear screen")).toBe("clear screen");
    expect(stripAnsi("\x1B[Kclear line")).toBe("clear line");
  });

  it("strips OSC sequences (BEL terminated)", () => {
    expect(stripAnsi("\x1B]0;Window Title\x07content")).toBe("content");
  });

  it("strips OSC sequences (ST terminated)", () => {
    expect(stripAnsi("\x1B]0;Window Title\x1B\\content")).toBe("content");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("no ansi here")).toBe("no ansi here");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips 256-color codes", () => {
    expect(stripAnsi("\x1B[38;5;196mred\x1B[0m")).toBe("red");
  });

  it("strips 24-bit RGB codes", () => {
    expect(stripAnsi("\x1B[38;2;255;100;0morange\x1B[0m")).toBe("orange");
  });
});

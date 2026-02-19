import { describe, it, expect, vi } from "vitest";
import { BatchExecutor } from "../../src/tree/batch-executor.js";
import { EventBus } from "../../src/events/event-bus.js";
import type { TaskNode } from "../../src/tree/index.js";
import type { BatchResult } from "../../src/tree/batch-executor.js";

function makeTask(id: string): TaskNode {
  return {
    id,
    parentId: null,
    statement: `Task ${id}`,
    status: "proposed",
    depth: 0,
    priority: 1,
    branchScore: 0,
    children: [],
    evidence: [],
  };
}

function okResult(task: TaskNode): BatchResult {
  return {
    taskId: task.id,
    success: true,
    output: `done-${task.id}`,
    evidence: [],
    durationMs: 1,
  };
}

describe("BatchExecutor", () => {
  it("executes single task", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 2, eventBus: bus });
    const task = makeTask("t1");

    const results = await executor.execute([task], async (t) => okResult(t));

    expect(results).toHaveLength(1);
    expect(results[0]!.taskId).toBe("t1");
    expect(results[0]!.success).toBe(true);
  });

  it("executes batch of 2 tasks in parallel", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 2, eventBus: bus });
    const tasks = [makeTask("a"), makeTask("b")];

    const startTimes: number[] = [];

    const results = await executor.execute(tasks, async (t) => {
      startTimes.push(performance.now());
      await delay(50);
      return okResult(t);
    });

    expect(results).toHaveLength(2);
    // Both should start nearly simultaneously (within 20ms of each other)
    expect(Math.abs(startTimes[0]! - startTimes[1]!)).toBeLessThan(20);
  });

  it("respects concurrency limit (max 2 concurrent)", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 2, eventBus: bus });
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];

    let concurrent = 0;
    let maxConcurrent = 0;

    const results = await executor.execute(tasks, async (t) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(50);
      concurrent--;
      return okResult(t);
    });

    expect(results).toHaveLength(3);
    expect(maxConcurrent).toBe(2);
  });

  it("returns results in same order as input", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 2, eventBus: bus });
    const tasks = [makeTask("first"), makeTask("second"), makeTask("third")];

    // Deliberately make first task slower so it finishes last
    const results = await executor.execute(tasks, async (t) => {
      if (t.id === "first") await delay(80);
      else await delay(10);
      return okResult(t);
    });

    expect(results.map((r) => r.taskId)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("one failing task does not abort others", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 3, eventBus: bus });
    const tasks = [makeTask("ok1"), makeTask("fail"), makeTask("ok2")];

    const results = await executor.execute(tasks, async (t) => {
      if (t.id === "fail") throw new Error("boom");
      return okResult(t);
    });

    expect(results).toHaveLength(3);
    expect(results[0]!.success).toBe(true);
    expect(results[1]!.success).toBe(false);
    expect(results[2]!.success).toBe(true);
  });

  it("failed task has success=false and error message", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 1, eventBus: bus });
    const tasks = [makeTask("bad")];

    const results = await executor.execute(tasks, async () => {
      throw new Error("something broke");
    });

    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toBe("something broke");
    expect(results[0]!.taskId).toBe("bad");
  });

  it("emits worker_assigned event per task", async () => {
    const bus = new EventBus();
    const emitSpy = vi.spyOn(bus, "emit");
    const executor = new BatchExecutor({ concurrency: 2, eventBus: bus });
    const tasks = [makeTask("x"), makeTask("y")];

    await executor.execute(tasks, async (t) => okResult(t));

    const assignedEvents = emitSpy.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === "worker_assigned");

    expect(assignedEvents).toHaveLength(2);
    expect(assignedEvents[0]).toMatchObject({
      type: "worker_assigned",
      taskId: "x",
      workerIndex: 0,
    });
    expect(assignedEvents[1]).toMatchObject({
      type: "worker_assigned",
      taskId: "y",
      workerIndex: 1,
    });
  });

  it("handler receives correct workerIndex (0, 1, ...)", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 3, eventBus: bus });
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];

    const received: number[] = [];

    await executor.execute(tasks, async (t, wi) => {
      received.push(wi);
      return okResult(t);
    });

    expect(received).toEqual([0, 1, 2]);
  });

  it("empty batch returns empty results", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 2, eventBus: bus });

    const results = await executor.execute([], async (t) => okResult(t));

    expect(results).toEqual([]);
  });

  it("timeout aborts long-running task", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({
      concurrency: 1,
      eventBus: bus,
      timeoutMs: 100,
    });
    const tasks = [makeTask("slow")];

    const results = await executor.execute(tasks, async (t) => {
      await delay(500);
      return okResult(t);
    });

    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toBe("timeout");
    expect(results[0]!.taskId).toBe("slow");
  });

  it("results include durationMs", async () => {
    const bus = new EventBus();
    const executor = new BatchExecutor({ concurrency: 1, eventBus: bus });
    const tasks = [makeTask("t1")];

    const results = await executor.execute(tasks, async (t) => {
      await delay(30);
      return {
        taskId: t.id,
        success: true,
        output: "ok",
        evidence: [],
        durationMs: 30,
      };
    });

    expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof results[0]!.durationMs).toBe("number");
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

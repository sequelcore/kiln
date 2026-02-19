import type { EventBus } from "../events/event-bus.js";
import type { WorkerAssignedEvent } from "../events/index.js";
import type { TaskNode } from "./index.js";

export interface BatchResult {
  taskId: string;
  success: boolean;
  output: string;
  evidence: string[];
  durationMs: number;
  error?: string;
}

export class BatchExecutor {
  private readonly concurrency: number;
  private readonly eventBus: EventBus;
  private readonly timeoutMs: number;

  constructor(opts: {
    concurrency: number;
    eventBus: EventBus;
    timeoutMs?: number;
  }) {
    this.concurrency = opts.concurrency;
    this.eventBus = opts.eventBus;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  async execute(
    batch: readonly TaskNode[],
    handler: (task: TaskNode, workerIndex: number) => Promise<BatchResult>,
  ): Promise<BatchResult[]> {
    if (batch.length === 0) return [];

    const results: BatchResult[] = new Array(batch.length);
    let workerIndex = 0;

    const running = new Set<Promise<void>>();

    for (let i = 0; i < batch.length; i++) {
      const idx = i;
      const task = batch[idx]!;
      const wi = workerIndex++;

      const p = this.runTask(task, wi, handler)
        .then((result) => {
          results[idx] = result;
        })
        .finally(() => {
          running.delete(p);
        });

      running.add(p);

      if (running.size >= this.concurrency) {
        await Promise.race(running);
      }
    }

    await Promise.all(running);

    return results;
  }

  private async runTask(
    task: TaskNode,
    workerIndex: number,
    handler: (task: TaskNode, workerIndex: number) => Promise<BatchResult>,
  ): Promise<BatchResult> {
    const event: WorkerAssignedEvent = {
      type: "worker_assigned",
      workerIndex,
      taskId: task.id,
      timestamp: new Date(),
      sessionId: "",
    };
    this.eventBus.emit(event);

    const start = performance.now();

    try {
      const result = await Promise.race([
        handler(task, workerIndex),
        this.timeout(),
      ]);
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      return {
        taskId: task.id,
        success: false,
        output: "",
        evidence: [],
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private timeout(): Promise<never> {
    return new Promise((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("timeout"));
      }, this.timeoutMs);
    });
  }
}

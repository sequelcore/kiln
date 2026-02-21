// A2ATaskStore: in-memory store for A2A task lifecycle

import type { A2ATask, A2ATaskStatus, A2AMessage, A2AArtifact } from "@kilnai/core";

interface StoredTask extends A2ATask {
  createdAt: number;
  updatedAt: number;
}

export class A2ATaskStore {
  private readonly tasks = new Map<string, StoredTask>();

  constructor(taskTtlMs = 3600000) {
    void taskTtlMs;
  }

  createTask(id: string, message: A2AMessage): A2ATask {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const task: StoredTask = {
      id,
      status: { state: "submitted", timestamp },
      history: [message],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  updateStatus(id: string, status: A2ATaskStatus, artifacts?: readonly A2AArtifact[]): A2ATask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    const updatedTask: StoredTask = {
      ...task,
      status,
      updatedAt: Date.now(),
      ...(artifacts ? { artifacts } : {}),
    };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  getTask(id: string): A2ATask | undefined {
    return this.tasks.get(id);
  }

  cancelTask(id: string): A2ATask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    if (task.status.state === "completed" || task.status.state === "failed" || task.status.state === "canceled") {
      return task;
    }

    const canceledTask: StoredTask = {
      ...task,
      status: { state: "canceled", timestamp: new Date().toISOString() },
      updatedAt: Date.now(),
    };
    this.tasks.set(id, canceledTask);
    return canceledTask;
  }

  cleanExpired(ttlMs: number): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, task] of this.tasks) {
      const terminalStates: A2ATaskStatus["state"][] = ["completed", "failed", "canceled"];
      if (terminalStates.includes(task.status.state)) {
        if (now - task.updatedAt > ttlMs) {
          this.tasks.delete(id);
          removed++;
        }
      }
    }

    return removed;
  }
}

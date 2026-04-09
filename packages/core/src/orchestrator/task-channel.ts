/**
 * Task Channel: shared coordination substrate for multi-agent teams.
 *
 * Inspired by Workforce's task channel pattern and ant stigmergy.
 * Agents read the channel to find work. Results are published as concise
 * summaries, not full tool call logs (prevents context contamination).
 *
 * Design principles (from research):
 * - Publish only results, not process (Workforce isolation)
 * - Channel is the coordination medium (no direct agent-to-agent messaging)
 * - Tasks carry demand signal for threshold-based allocation
 */

import type { TaskCategory } from "./threshold-allocator.js";

/** Status of a task in the channel */
export type ChannelTaskStatus =
  | "open"        // available for claim
  | "claimed"     // agent is working on it
  | "completed"   // finished successfully
  | "failed"      // agent reported failure
  | "blocked";    // waiting on dependencies

/** A task entry in the channel */
export interface ChannelTask {
  readonly id: string;
  readonly description: string;
  readonly category: TaskCategory;  // from threshold-allocator
  readonly demand: number;          // 0-1, demand signal
  readonly status: ChannelTaskStatus;
  readonly assignee?: string;       // agentId of current owner
  readonly dependencies: readonly string[];  // task IDs that must complete first
  readonly result?: string;         // concise result summary (not full logs)
  readonly error?: string;          // error description if failed
  readonly createdAt: number;       // Date.now() timestamp
  readonly updatedAt: number;       // last status change timestamp
  readonly parentId?: string;       // for subtask hierarchy
}

/** Options for publishing a new task */
export interface PublishTaskOptions {
  readonly id: string;
  readonly description: string;
  readonly category: TaskCategory;
  readonly demand: number;
  readonly dependencies?: readonly string[];
  readonly parentId?: string;
}

/** Options for completing a task */
export interface CompleteTaskOptions {
  readonly result: string;  // concise summary only
}

/** Options for failing a task */
export interface FailTaskOptions {
  readonly error: string;
}

export class TaskChannel {
  private readonly tasks: Map<string, ChannelTask>;

  constructor() {
    this.tasks = new Map();
  }

  /**
   * Publish a new task to the channel. Status starts as "open"
   * unless it has unresolved dependencies (then "blocked").
   */
  publish(options: PublishTaskOptions): ChannelTask {
    const deps = options.dependencies ?? [];
    const hasUnresolvedDeps = deps.some((depId) => {
      const dep = this.tasks.get(depId);
      return !dep || dep.status !== "completed";
    });

    const now = Date.now();
    const task: ChannelTask = {
      id: options.id,
      description: options.description,
      category: options.category,
      demand: options.demand,
      status: hasUnresolvedDeps ? "blocked" : "open",
      dependencies: [...deps],
      createdAt: now,
      updatedAt: now,
      parentId: options.parentId,
    };

    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Claim a task for an agent. Only "open" tasks can be claimed.
   * Returns the updated task, or null if the task is not claimable.
   */
  claim(taskId: string, agentId: string): ChannelTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "open") return null;

    const updated: ChannelTask = {
      ...task,
      status: "claimed",
      assignee: agentId,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  /**
   * Complete a task with a concise result summary.
   * Only "claimed" tasks can be completed.
   * After completion, unblocks dependent tasks whose deps are all resolved.
   */
  complete(taskId: string, options: CompleteTaskOptions): ChannelTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "claimed") return null;

    const updated: ChannelTask = {
      ...task,
      status: "completed",
      result: options.result,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, updated);

    // Unblock dependent tasks
    this.unblockDependents(taskId);

    return updated;
  }

  /**
   * Mark a task as failed with an error description.
   * Only "claimed" tasks can be failed.
   */
  fail(taskId: string, options: FailTaskOptions): ChannelTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "claimed") return null;

    const updated: ChannelTask = {
      ...task,
      status: "failed",
      error: options.error,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  /**
   * Release a claimed task back to "open" (agent gave up or was reassigned).
   * Only "claimed" tasks can be released.
   */
  release(taskId: string): ChannelTask | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "claimed") return null;

    const updated: ChannelTask = {
      ...task,
      status: "open",
      assignee: undefined,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  /** Get a task by ID */
  get(taskId: string): ChannelTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Get all tasks with a specific status */
  byStatus(status: ChannelTaskStatus): readonly ChannelTask[] {
    return [...this.tasks.values()].filter((t) => t.status === status);
  }

  /** Get all open tasks (available for claim) */
  open(): readonly ChannelTask[] {
    return this.byStatus("open");
  }

  /** Get all tasks assigned to a specific agent */
  byAssignee(agentId: string): readonly ChannelTask[] {
    return [...this.tasks.values()].filter((t) => t.assignee === agentId);
  }

  /** Get all tasks in the channel */
  all(): readonly ChannelTask[] {
    return [...this.tasks.values()];
  }

  /** Get count of tasks by status */
  counts(): Readonly<Record<ChannelTaskStatus, number>> {
    const counts: Record<ChannelTaskStatus, number> = {
      open: 0,
      claimed: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
    };
    for (const task of this.tasks.values()) {
      counts[task.status]++;
    }
    return counts;
  }

  /**
   * Check blocked tasks and unblock any whose dependencies are all completed.
   * Called internally after task completion, but can also be called externally.
   */
  unblockDependents(completedTaskId: string): void {
    for (const [id, task] of this.tasks) {
      if (task.status !== "blocked") continue;
      if (!task.dependencies.includes(completedTaskId)) continue;

      const allDepsCompleted = task.dependencies.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep !== undefined && dep.status === "completed";
      });

      if (allDepsCompleted) {
        this.tasks.set(id, { ...task, status: "open", updatedAt: Date.now() });
      }
    }
  }
}

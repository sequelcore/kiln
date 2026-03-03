import { randomUUID } from "node:crypto";
import type { EventBus } from "../events/event-bus.js";
import type { TaskStartedEvent, TaskCompletedEvent } from "../events/index.js";
import type { TaskNode, TaskStatus, TreeAction, TreeConfig } from "./index.js";

/** Mutable internal representation of a TaskNode */
interface MutableTaskNode {
  id: string;
  parentId: string | null;
  statement: string;
  status: TaskStatus;
  depth: number;
  priority: number;
  branchScore: number;
  children: string[];
  evidence: string[];
}

/** Terminal statuses that trigger task_completed events */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "supported",
  "refuted",
  "rejected",
]);

function toReadonly(node: MutableTaskNode): TaskNode {
  return {
    id: node.id,
    parentId: node.parentId,
    statement: node.statement,
    status: node.status,
    depth: node.depth,
    priority: node.priority,
    branchScore: node.branchScore,
    children: [...node.children],
    evidence: [...node.evidence],
  };
}

/**
 * Mutable tree of TaskNodes with scoring, selection, and tree actions.
 */
export class TaskTree {
  private readonly nodes = new Map<string, MutableTaskNode>();
  private readonly config: TreeConfig;
  private readonly eventBus: EventBus;
  private _sessionId: string;

  constructor({ config, eventBus, sessionId }: { config: TreeConfig; eventBus: EventBus; sessionId?: string }) {
    this.config = config;
    this.eventBus = eventBus;
    this._sessionId = sessionId ?? "";
  }

  /** Update session ID (called when orchestrator starts a new session) */
  setSessionId(sessionId: string): void {
    this._sessionId = sessionId;
  }

  /** Create a root task at depth 0 with status "proposed" */
  addRoot(statement: string, priority: number): string {
    const id = randomUUID();
    const node: MutableTaskNode = {
      id,
      parentId: null,
      statement,
      status: "proposed",
      depth: 0,
      priority,
      branchScore: 0,
      children: [],
      evidence: [],
    };
    node.branchScore = this.computeBranchScore(node);
    this.nodes.set(id, node);

    const event: TaskStartedEvent = {
      type: "task_started",
      taskId: id,
      statement,
      parentId: null,
      timestamp: new Date(),
      sessionId: this._sessionId,
    };
    this.eventBus.emit(event);

    return id;
  }

  /** Bulk add root tasks from Architect plan */
  addRoots(tasks: { statement: string; priority: number }[]): string[] {
    return tasks.map((t) => this.addRoot(t.statement, t.priority));
  }

  /** Process Architect's tree action on a task */
  applyAction(
    taskId: string,
    action: TreeAction,
    evaluation: string,
  ): string | null {
    const node = this.requireNode(taskId);

    if (action === "deepen") {
      const childDepth = node.depth + 1;
      if (childDepth > this.config.maxDepth) {
        throw new Error(
          `Cannot deepen: depth ${childDepth} exceeds maxDepth ${this.config.maxDepth}`,
        );
      }
      const childId = randomUUID();
      const child: MutableTaskNode = {
        id: childId,
        parentId: taskId,
        statement: evaluation,
        status: "proposed",
        depth: childDepth,
        priority: node.priority,
        branchScore: 0,
        children: [],
        evidence: [],
      };
      child.branchScore = this.computeBranchScore(child);
      this.nodes.set(childId, child);
      node.children.push(childId);

      const deepenEvent: TaskStartedEvent = {
        type: "task_started",
        taskId: childId,
        statement: evaluation,
        parentId: taskId,
        timestamp: new Date(),
        sessionId: this._sessionId,
      };
      this.eventBus.emit(deepenEvent);

      return childId;
    }

    if (action === "branch") {
      const siblingId = randomUUID();
      const sibling: MutableTaskNode = {
        id: siblingId,
        parentId: node.parentId,
        statement: evaluation,
        status: "proposed",
        depth: node.depth,
        priority: node.priority,
        branchScore: 0,
        children: [],
        evidence: [],
      };
      sibling.branchScore = this.computeBranchScore(sibling);
      this.nodes.set(siblingId, sibling);

      // Add as child of parent if parent exists
      if (node.parentId !== null) {
        const parent = this.nodes.get(node.parentId);
        if (parent) {
          parent.children.push(siblingId);
        }
      }

      const branchEvent: TaskStartedEvent = {
        type: "task_started",
        taskId: siblingId,
        statement: evaluation,
        parentId: node.parentId,
        timestamp: new Date(),
        sessionId: this._sessionId,
      };
      this.eventBus.emit(branchEvent);

      return siblingId;
    }

    // prune
    node.status = "rejected";
    const pruneEvent: TaskCompletedEvent = {
      type: "task_completed",
      taskId,
      status: "rejected",
      action: "update",
      timestamp: new Date(),
      sessionId: this._sessionId,
    };
    this.eventBus.emit(pruneEvent);

    return null;
  }

  /** Change task status; emit task_completed for terminal statuses */
  updateStatus(taskId: string, status: TaskStatus): void {
    const node = this.requireNode(taskId);
    node.status = status;

    if (TERMINAL_STATUSES.has(status)) {
      const completedEvent: TaskCompletedEvent = {
        type: "task_completed",
        taskId,
        status,
        action: "update",
        timestamp: new Date(),
        sessionId: this._sessionId,
      };
      this.eventBus.emit(completedEvent);
    }
  }

  /** Append evidence and recalculate branchScore */
  addEvidence(taskId: string, evidence: string): void {
    const node = this.requireNode(taskId);
    node.evidence.push(evidence);
    node.branchScore = this.computeBranchScore(node);
  }

  /** Pick top N proposed tasks by branchScore, set to "testing" */
  selectBatch(size?: number): TaskNode[] {
    const batchSize = size ?? this.config.batchSize;
    const proposed = [...this.nodes.values()]
      .filter((n) => n.status === "proposed")
      .sort((a, b) => b.branchScore - a.branchScore)
      .slice(0, batchSize);

    for (const node of proposed) {
      node.status = "testing";
    }

    return proposed.map(toReadonly);
  }

  /** Scoring: custom function or default (priority * depthDiscount^depth * (1 + evidenceBonus)) */
  computeBranchScore(node: Pick<MutableTaskNode, "priority" | "depth" | "evidence">): number {
    if (this.config.scoringFn) {
      return this.config.scoringFn(node, (id) => this.getNode(id));
    }
    const evidenceBonus = Math.min(node.evidence.length * 0.1, 0.5);
    return (
      node.priority *
      Math.pow(this.config.depthDiscount, node.depth) *
      (1 + evidenceBonus)
    );
  }

  /** Return readonly snapshot of a task */
  getNode(id: string): TaskNode | undefined {
    const node = this.nodes.get(id);
    return node ? toReadonly(node) : undefined;
  }

  /** All root tasks (parentId === null) */
  get roots(): TaskNode[] {
    return [...this.nodes.values()]
      .filter((n) => n.parentId === null)
      .map(toReadonly);
  }

  /** All tasks as readonly snapshots */
  get allNodes(): TaskNode[] {
    return [...this.nodes.values()].map(toReadonly);
  }

  /** Count of "proposed" tasks */
  get pendingCount(): number {
    let count = 0;
    for (const node of this.nodes.values()) {
      if (node.status === "proposed") count++;
    }
    return count;
  }

  /** True if no "proposed" or "testing" tasks remain */
  get isComplete(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status === "proposed" || node.status === "testing") return false;
    }
    return true;
  }

  /** Serialize entire tree for persistence/debugging */
  toJSON(): { nodes: TaskNode[]; config: TreeConfig } {
    return {
      nodes: this.allNodes,
      config: this.config,
    };
  }

  /** Load tree from a serialized JSON representation */
  loadFromJSON(data: { readonly nodes: readonly TaskNode[]; readonly config: TreeConfig }): void {
    this.nodes.clear();
    for (const node of data.nodes) {
      this.nodes.set(node.id, {
        id: node.id,
        parentId: node.parentId,
        statement: node.statement,
        status: node.status,
        depth: node.depth,
        priority: node.priority,
        branchScore: node.branchScore,
        children: [...node.children],
        evidence: [...node.evidence],
      });
    }
  }

  /** Clear all nodes from the tree */
  clear(): void {
    this.nodes.clear();
  }

  /** Return depth of a task in the tree */
  depth(taskId: string): number {
    return this.requireNode(taskId).depth;
  }

  private requireNode(id: string): MutableTaskNode {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Task not found: ${id}`);
    }
    return node;
  }
}

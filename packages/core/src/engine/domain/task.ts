// Engine primitive: Task -- a unit of work in a tree structure
// Scoring: priority * complexity_discount * evidence_bonus

/** Status of a task in the exploration tree */
export type TaskStatus = "proposed" | "active" | "completed" | "pruned";

/** Action to take on a task after evaluation */
export type TreeAction = "deepen" | "branch" | "prune";

/** A unit of work in a tree structure with scoring and exploration actions */
export interface Task {
  readonly id: string;
  readonly statement: string;
  readonly status: TaskStatus;
  readonly parentId?: string;
  readonly depth: number;
  readonly priority: number;
  readonly children: readonly Task[];
  readonly evidence: readonly string[];
}

/** Task status in the tree */
export type TaskStatus =
  | "proposed"
  | "testing"
  | "supported"
  | "refuted"
  | "revised"
  | "rejected";

/** Tree action from Architect evaluation */
export type TreeAction = "deepen" | "branch" | "prune";

/** A task node in the exploration tree */
export interface TaskNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly statement: string;
  readonly status: TaskStatus;
  readonly depth: number;
  readonly priority: number;
  readonly branchScore: number;
  readonly children: readonly string[];
  readonly evidence: readonly string[];
}

/** Tree manager configuration */
export interface TreeConfig {
  readonly maxDepth: number;
  readonly batchSize: number;
  readonly depthDiscount: number;
}

export { TaskTree } from "./task-tree.js";
export { BatchExecutor } from "./batch-executor.js";
export type { BatchResult } from "./batch-executor.js";

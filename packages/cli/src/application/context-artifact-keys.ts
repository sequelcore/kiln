import { normalizeTaskShapeKey } from "@kilnai/core";

export function buildCliSessionSummaryArtifactKey(sessionId: string): string {
  return `session-summary:${sessionId}`;
}

export function buildCliProjectSummaryArtifactKey(projectPath: string): string {
  return `project-summary:${projectPath}`;
}

export function buildCliPlanSummaryArtifactKey(
  projectPath: string,
  task: string,
  maxTaskShapeLength = 80,
): string {
  return `plan-summary:${projectPath}:${normalizeTaskShapeKey(task, maxTaskShapeLength)}`;
}

export function buildCliPlanSummaryArtifactKeyFromShape(
  projectPath: string,
  taskShape: string,
): string {
  return `plan-summary:${projectPath}:${taskShape}`;
}

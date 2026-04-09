/**
 * Derives a TaskDemand from a ComplexityScore and optional explicit category.
 * Maps complexity signals to task categories using simple heuristics.
 */

import type { ComplexityScore } from "../engine/domain/model-router.js";
import type { TaskCategory, TaskDemand } from "./threshold-allocator.js";

export function inferCategory(complexity: ComplexityScore): TaskCategory {
  const { hasCodeBlocks, hasTools, hasReasoningMarkers } = complexity.signals;

  if (hasCodeBlocks && hasTools) return "code";
  if (hasCodeBlocks && !hasTools) return "review";
  if (hasReasoningMarkers && !hasCodeBlocks) return "research";
  if (hasTools && !hasCodeBlocks && !hasReasoningMarkers) return "ops";
  return "general";
}

export function buildTaskDemand(
  complexity: ComplexityScore,
  explicitCategory?: TaskCategory,
): TaskDemand {
  return {
    category: explicitCategory ?? inferCategory(complexity),
    demand: complexity.score,
  };
}

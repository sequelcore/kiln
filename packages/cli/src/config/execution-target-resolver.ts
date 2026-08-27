import type { KilnGlobalConfig } from "./global-config.js";
import {
  isDirectProviderId,
  type DirectProviderId,
  type ExecutionTargetCatalog,
  type ModelTaskSuitabilityTask,
} from "@kilnai/core";

/** A configured operator execution target, before provider availability admission. */
export interface ExecutionTargetCandidate {
  readonly targetId: string;
  readonly provider: DirectProviderId;
  readonly model: string;
}

export interface ResolveExecutionTargetCandidatesInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  /** The catalog admitted from the exact evidence revision named by globalConfig. */
  readonly executionCatalog?: ExecutionTargetCatalog | null;
  /** An explicit operator choice. It replaces the configured default target. */
  readonly targetId?: string;
}

/**
 * Resolves only targets admitted by the execution catalog. Provider and model
 * identity are derived dispatch details, never operator-selectable CLI input.
 */
export function resolveExecutionTargetCandidates(
  input: ResolveExecutionTargetCandidatesInput,
): readonly ExecutionTargetCandidate[] {
  const catalog = input.executionCatalog;
  const routing = input.globalConfig?.targetRouting;
  if (!catalog || !routing) return [];

  const targetId = normalizeId(input.targetId) ?? routing.defaultTargetId;
  const target = catalog.targets.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`Execution target '${targetId}' is not configured.`);
  if (!isDirectProviderId(target.providerId)) {
    throw new Error(`Execution target '${targetId}' does not reference a direct provider.`);
  }
  return [{
    targetId: target.id,
    provider: target.providerId,
    model: target.providerModelId,
  }];
}

export function inferTargetTask(input: {
  readonly text?: string;
  readonly agentTaskAffinity?: readonly ModelTaskSuitabilityTask[];
}): ModelTaskSuitabilityTask | undefined {
  const agentTask = input.agentTaskAffinity?.find((task) => task.trim().length > 0);
  if (agentTask) return agentTask;
  const text = input.text?.toLowerCase() ?? "";
  if (text.trim().length === 0) return undefined;
  if (hasAny(text, ["frontend", "ui", "ux", "react", "component", "css", "tailwind", "layout", "responsive", "design", "browser"])) return "frontend-design";
  if (hasAny(text, ["codebase", "callers", "dependency graph", "affected files", "ownership map"])) return "architecture-review";
  if (hasAny(text, ["research", "latest", "official documentation", "official specification", "standard", "paper", "citation", "benchmark"])) return "research";
  if (hasAny(text, ["test", "tests", "tdd", "vitest", "junit", "coverage", "regression"])) return "test-writing";
  if (hasAny(text, ["architecture", "architectural", "ddd", "clean architecture", "boundary", "bounded context", "adr", "review"])) return "architecture-review";
  if (hasAny(text, ["rename", "format", "mechanical", "boilerplate", "projection", "sync", "bulk"])) return "mechanical-edit";
  if (hasAny(text, ["backend", "api", "database", "postgres", "spring", "service", "repository", "endpoint", "runtime", "provider"])) return "backend-coding";
  return undefined;
}

function normalizeId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function hasAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

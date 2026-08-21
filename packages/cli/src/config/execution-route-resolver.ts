import type { KilnGlobalConfig } from "./global-config.js";
import {
  isDirectProviderId,
  type DirectProviderId,
  type ExecutionCatalog,
  type ModelTaskSuitabilityTask,
} from "@kilnai/core";

/** A configured operator execution target, before provider availability admission. */
export interface ExecutionRouteCandidate {
  readonly routeId: string;
  readonly provider: DirectProviderId;
  readonly model: string;
}

export interface ResolveExecutionRouteCandidatesInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  /** The catalog admitted from the exact evidence revision named by globalConfig. */
  readonly executionCatalog?: ExecutionCatalog | null;
  /** An explicit operator choice. It replaces the configured default route. */
  readonly routeId?: string;
}

/**
 * Resolves only routes admitted by the V2 execution catalog. Provider and model
 * identity are derived dispatch details, never operator-selectable CLI input.
 */
export function resolveExecutionRouteCandidates(
  input: ResolveExecutionRouteCandidatesInput,
): readonly ExecutionRouteCandidate[] {
  const catalog = input.executionCatalog;
  const routing = input.globalConfig?.targetRouting;
  if (!catalog || !routing) return [];

  const routeId = normalizeId(input.routeId) ?? routing.defaultTargetId;
  const route = catalog.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Execution target '${routeId}' is not configured.`);
  if (!isDirectProviderId(route.providerId)) {
    throw new Error(`Execution target '${routeId}' does not reference a direct provider.`);
  }
  return [{
    routeId: route.id,
    provider: route.providerId,
    model: route.providerModelId,
  }];
}

export function inferRouteTask(input: {
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

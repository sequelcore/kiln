import { isAvailable, type Credential } from "./credential.js";

export type SelectionStrategy = "fill-first" | "round-robin" | "random" | "least-used";

interface SelectionContext {
  lastSelectedId: string | null;
  selectionIndex: number;
}

export function selectCredential<TAuth>(
  strategy: SelectionStrategy,
  credentials: readonly Credential<TAuth>[],
  context: SelectionContext,
): string | null {
  if (credentials.length === 0) {
    return null;
  }

  const available = [...credentials]
    .filter((credential) => isAvailable(credential))
    .sort(comparePriority);
  if (available.length === 0) {
    return null;
  }

  switch (strategy) {
    case "fill-first":
      return selectFillFirst(available);
    case "round-robin":
      return selectRoundRobin(available, context);
    case "random":
      return selectRandom(available);
    case "least-used":
      return selectLeastUsed(available);
    default:
      return selectFillFirst(available);
  }
}

function selectFillFirst<TAuth>(available: readonly Credential<TAuth>[]): string | null {
  return available[0]?.id ?? null;
}

function selectRoundRobin<TAuth>(
  available: readonly Credential<TAuth>[],
  context: SelectionContext,
): string | null {
  if (available.length === 0) {
    return null;
  }

  const nextIndex = (context.selectionIndex + 1) % available.length;
  return available[nextIndex]?.id ?? null;
}

function selectRandom<TAuth>(available: readonly Credential<TAuth>[]): string | null {
  if (available.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * available.length);
  return available[randomIndex]?.id ?? null;
}

function selectLeastUsed<TAuth>(available: readonly Credential<TAuth>[]): string | null {
  if (available.length === 0) {
    return null;
  }

  const sorted = [...available].sort((a, b) => {
    const requestCountComparison = a.requestCount - b.requestCount;
    return requestCountComparison === 0 ? comparePriority(a, b) : requestCountComparison;
  });
  return sorted[0]?.id ?? null;
}

function comparePriority<TAuth>(a: Credential<TAuth>, b: Credential<TAuth>): number {
  return a.priority - b.priority;
}

export function createInitialSelectionContext(): SelectionContext {
  return {
    lastSelectedId: null,
    selectionIndex: -1,
  };
}

export function updateSelectionContext(
  context: SelectionContext,
  selectedId: string,
  credentialCount: number,
): SelectionContext {
  const selectedIndex = context.selectionIndex + 1;
  return {
    lastSelectedId: selectedId,
    selectionIndex: selectedIndex % Math.max(1, credentialCount),
  };
}

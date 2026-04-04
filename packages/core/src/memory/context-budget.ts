export interface ContextBudgetCandidate<TMeta = unknown> {
  readonly id: string;
  readonly required: boolean;
  readonly estimatedTokens: number;
  readonly score: number;
  readonly meta: TMeta;
}

export interface ContextBudgetSelection<TMeta = unknown> {
  readonly selected: readonly ContextBudgetCandidate<TMeta>[];
  readonly deferred: readonly ContextBudgetCandidate<TMeta>[];
  readonly requiredTokens: number;
  readonly selectedTokens: number;
  readonly tokenBudget: number;
  readonly overflow: boolean;
}

export function selectContextWithinBudget<TMeta>(
  candidates: readonly ContextBudgetCandidate<TMeta>[],
  tokenBudget: number,
): ContextBudgetSelection<TMeta> {
  const required = candidates
    .filter((candidate) => candidate.required)
    .sort((left, right) => right.score - left.score);
  const optional = candidates
    .filter((candidate) => !candidate.required)
    .sort((left, right) => right.score - left.score);

  const selected: ContextBudgetCandidate<TMeta>[] = [...required];
  const deferred: ContextBudgetCandidate<TMeta>[] = [];
  let selectedTokens = required.reduce((total, candidate) => total + candidate.estimatedTokens, 0);

  for (const candidate of optional) {
    if (selectedTokens + candidate.estimatedTokens <= tokenBudget) {
      selected.push(candidate);
      selectedTokens += candidate.estimatedTokens;
    } else {
      deferred.push(candidate);
    }
  }

  return {
    selected,
    deferred,
    requiredTokens: required.reduce((total, candidate) => total + candidate.estimatedTokens, 0),
    selectedTokens,
    tokenBudget,
    overflow: required.reduce((total, candidate) => total + candidate.estimatedTokens, 0) > tokenBudget,
  };
}

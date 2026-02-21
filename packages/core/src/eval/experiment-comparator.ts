// compareExperiments: side-by-side comparison of two experiment runs

import type { Experiment } from "./types.js";

export interface ScorerComparison {
  readonly scorerName: string;
  readonly avgScoreA: number;
  readonly avgScoreB: number;
  readonly delta: number;
  readonly improved: boolean;
}

export interface ComparisonResult {
  readonly experimentA: string;
  readonly experimentB: string;
  readonly scorerComparisons: readonly ScorerComparison[];
  readonly summary: string;
}

export function compareExperiments(a: Experiment, b: Experiment): ComparisonResult {
  const scoresA = aggregateScores(a);
  const scoresB = aggregateScores(b);

  const allScorerNames = new Set([...scoresA.keys(), ...scoresB.keys()]);
  const comparisons: ScorerComparison[] = [];

  for (const scorerName of allScorerNames) {
    const avgA = scoresA.get(scorerName) ?? 0;
    const avgB = scoresB.get(scorerName) ?? 0;
    const delta = avgB - avgA;
    comparisons.push({ scorerName, avgScoreA: avgA, avgScoreB: avgB, delta, improved: delta > 0 });
  }

  const improved = comparisons.filter((c) => c.improved).length;
  const regressed = comparisons.filter((c) => c.delta < 0).length;
  const summary = `${b.name} improved in ${improved}/${comparisons.length} scorers, regressed in ${regressed}.`;

  return { experimentA: a.name, experimentB: b.name, scorerComparisons: comparisons, summary };
}

function aggregateScores(exp: Experiment): Map<string, number> {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const result of exp.results) {
    for (const score of result.scores) {
      const entry = totals.get(score.name) ?? { sum: 0, count: 0 };
      entry.sum += score.score;
      entry.count += 1;
      totals.set(score.name, entry);
    }
  }

  const averages = new Map<string, number>();
  for (const [name, { sum, count }] of totals) {
    averages.set(name, count > 0 ? sum / count : 0);
  }
  return averages;
}

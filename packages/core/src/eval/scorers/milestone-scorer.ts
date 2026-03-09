// MilestoneScorer: rule-based scorer tracking intermediate checkpoint achievement

import type { EvalInput, EvalScore, Scorer } from "../types.js";

interface Milestone {
  readonly name: string;
  readonly completed: boolean;
}

function extractMilestones(metadata: Record<string, unknown> | undefined): Milestone[] | undefined {
  if (!metadata) return undefined;
  const raw = metadata["milestones"];
  if (!Array.isArray(raw)) return undefined;
  const milestones: Milestone[] = [];
  for (const entry of raw) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)["name"] === "string" &&
      typeof (entry as Record<string, unknown>)["completed"] === "boolean"
    ) {
      milestones.push(entry as Milestone);
    }
  }
  return milestones.length > 0 ? milestones : undefined;
}

export class MilestoneScorer implements Scorer {
  readonly name = "milestone";

  async score(input: EvalInput): Promise<EvalScore> {
    const milestones = extractMilestones(input.metadata);
    if (!milestones) {
      return { name: this.name, score: 0, reasoning: "No milestones in metadata" };
    }

    const completed = milestones.filter((m) => m.completed);
    const score = completed.length / milestones.length;
    const missed = milestones.filter((m) => !m.completed).map((m) => m.name);

    const parts = [`${completed.length}/${milestones.length} milestones completed`];
    if (missed.length > 0) parts.push(`missed: ${missed.join(", ")}`);

    return { name: this.name, score: Math.round(score * 100) / 100, reasoning: parts.join("; ") };
  }
}

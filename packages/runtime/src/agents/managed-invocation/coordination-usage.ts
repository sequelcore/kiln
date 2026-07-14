import { Buffer } from "node:buffer";
import type {
  ManagedAgentCoordinationComponentUsage,
  ManagedAgentCoordinationMetric,
  ManagedAgentCoordinationStage,
  ManagedAgentCoordinationUsageReport,
  ManagedAgentResultHandoff,
} from "@kilnai/core";

const STAGES: readonly ManagedAgentCoordinationStage[] = [
  "parent_prompt",
  "child_bootstrap",
  "duplicated_reads",
  "handoff",
  "review",
  "synthesis",
];

export function buildManagedAgentCoordinationUsage(input: {
  readonly invocationId: string;
  readonly childSessionId?: string;
  readonly parentPrompt: string;
  readonly sourceResourceUris: readonly string[];
  readonly resultHandoff?: ManagedAgentResultHandoff;
}): ManagedAgentCoordinationUsageReport {
  return {
    version: "managed-agent-coordination-usage-v1",
    workerId: input.childSessionId ?? input.invocationId,
    coverage: "partial",
    // The only numeric components are the parent prompt and bounded handoff
    // summary. They are disjoint payloads; unobserved stages remain unknown.
    reconciliation: "mutually-exclusive",
    components: STAGES.map((stage) => componentFor(stage, input)),
  };
}

function componentFor(
  stage: ManagedAgentCoordinationStage,
  input: Parameters<typeof buildManagedAgentCoordinationUsage>[0],
): ManagedAgentCoordinationComponentUsage {
  if (stage === "parent_prompt") {
    return component(stage, estimatedTokens(input.parentPrompt), input.sourceResourceUris, 1);
  }
  if (stage === "handoff" && input.resultHandoff) {
    return component(stage, estimatedTokens(input.resultHandoff.summary), input.resultHandoff.resourceUris, 1);
  }
  return {
    stage,
    providerTokenClass: providerTokenClassForStage(stage),
    tokens: unknownMetric(),
    costUsd: unknownMetric(),
    latencyMs: unknownMetric(),
    turns: unknownMetric(),
    evidenceUris: [],
  };
}

function component(
  stage: ManagedAgentCoordinationStage,
  tokens: number,
  evidenceUris: readonly string[],
  turns: number,
): ManagedAgentCoordinationComponentUsage {
  return {
    stage,
    providerTokenClass: providerTokenClassForStage(stage),
    tokens: { value: tokens, source: "estimated" },
    costUsd: unknownMetric(),
    latencyMs: unknownMetric(),
    turns: { value: turns, source: "estimated" },
    evidenceUris: [...evidenceUris],
  };
}

function estimatedTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 4);
}

function unknownMetric(): ManagedAgentCoordinationMetric {
  return { value: "unknown", source: "unknown" };
}

function providerTokenClassForStage(stage: ManagedAgentCoordinationStage): "input" | "output" {
  return stage === "handoff" || stage === "synthesis" ? "output" : "input";
}

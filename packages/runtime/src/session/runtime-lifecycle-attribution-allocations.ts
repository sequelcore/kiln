import type {
  ContextAuditEntry,
  ProjectedContextBlockKind,
  SessionLifecycleAttributionAllocation,
  SessionLifecycleSourceKind,
} from "@kilnai/core";

export interface RuntimeLifecycleFinalOutputBoundary {
  readonly evidenceUri?: string;
  readonly estimatedTokens: number;
}

export interface ProjectRuntimeLifecycleAttributionAllocationsInput {
  readonly contextAudit?: ContextAuditEntry;
  readonly finalOutput?: RuntimeLifecycleFinalOutputBoundary;
  readonly route: string;
}

export function projectRuntimeLifecycleAttributionAllocations(
  input: ProjectRuntimeLifecycleAttributionAllocationsInput,
): readonly SessionLifecycleAttributionAllocation[] {
  const inputAllocations = projectContextAuditAllocations(input.contextAudit, input.route);
  const outputAllocations = projectFinalOutputAllocations(input.finalOutput, input.route);
  return [
    ...inputAllocations,
    ...outputAllocations,
  ];
}

function projectContextAuditAllocations(
  contextAudit: ContextAuditEntry | undefined,
  route: string,
): readonly SessionLifecycleAttributionAllocation[] {
  if (!contextAudit) {
    return [];
  }
  return contextAudit.blocks.flatMap((block) => {
    if (block.decision !== "admitted") {
      return [];
    }
    const source = sourceKindFromContextBlockKind(block.kind);
    if (!source || block.estimatedTokens <= 0) {
      return [];
    }
    return [{
      source,
      tokenClass: block.decision,
      providerTokenClass: "input",
      tokens: block.estimatedTokens,
      quality: "estimated",
      artifactId: block.id,
      evidenceUris: block.kind === "memory" && block.memoryRecordId
        ? [`kiln://memory/nodes/${encodeURIComponent(block.memoryRecordId)}`]
        : isCanonicalEvidenceUri(block.source) ? [block.source] : [],
      context: {
        route,
        ...(block.kind === "memory" ? { phase: memoryLayerPhase(block.source) } : {}),
      },
    }];
  });
}

function memoryLayerPhase(source: string): string {
  const match = /^memory-recall:(working|episodic|semantic|procedural|coordination|audit)$/u.exec(source);
  return match ? `memory:${match[1]}` : "memory:unknown";
}

function projectFinalOutputAllocations(
  finalOutput: RuntimeLifecycleFinalOutputBoundary | undefined,
  route: string,
): readonly SessionLifecycleAttributionAllocation[] {
  if (!finalOutput || finalOutput.estimatedTokens <= 0) {
    return [];
  }
  return [{
    source: "final_output",
    tokenClass: "generated",
    providerTokenClass: "output",
    tokens: finalOutput.estimatedTokens,
    quality: "estimated",
    evidenceUris: finalOutput.evidenceUri && isCanonicalEvidenceUri(finalOutput.evidenceUri)
      ? [finalOutput.evidenceUri]
      : [],
    context: { route },
  }];
}

function isCanonicalEvidenceUri(value: string): boolean {
  return value.startsWith("kiln://");
}

function sourceKindFromContextBlockKind(
  kind: ProjectedContextBlockKind,
): SessionLifecycleSourceKind | undefined {
  switch (kind) {
    case "memory":
      return "memory";
    case "procedural":
      return "procedural_context";
    case "coordination":
      return "coordination";
    case "artifact":
      return "repository_evidence";
    case "summary":
      return "transcript";
    case "instruction":
      return "control_instructions";
    case "ledger":
      return undefined;
  }
}

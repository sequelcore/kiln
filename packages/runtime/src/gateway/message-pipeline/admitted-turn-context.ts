// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  ContextAuditEntry,
  ContextCandidate,
  ContextUsageProjection,
  GroundingMode
} from "@kilnai/core";
import type { AdmittedTurnContext } from "./process-admitted-turn.js";
import {
  DefaultContextGovernor,
  renderProjectedContext
} from "@kilnai/core";
import type {
  OrchestrateResult,
  PerCallToolConfig
} from "../../session/runtime-session-orchestrator.js";
import {
  appendGroundingDirective,
  formatUserContext
} from "../context-formatter.js";
import {
  normalizeContextUsageProjection,
  type ContextUsageWindowEvidence
} from "../../session/context-usage-projection.js";

export type CoordinationProviderFailureReason = "provider-error" | "provider-validation-error";
export interface RuntimeContextAudit extends ContextAuditEntry {
  readonly coordinationProviderFailures?: readonly {
    readonly source: "runtime-coordination-provider";
    readonly reason: CoordinationProviderFailureReason;
  }[];
}

export interface AdmittedTurnContextProjectionInput {
  readonly userContext: Record<string, string> | undefined;
  readonly cachedRuntimeSummary: string | undefined;
  readonly recalledMemoryCandidates?: readonly ContextCandidate[];
  readonly knowledgeContext: string | undefined;
  readonly contactContext: string | undefined;
  readonly visitorContext?: string | undefined;
  readonly groundingMode: GroundingMode | undefined;
  readonly proceduralContextCandidates?: readonly ContextCandidate[];
  readonly coordinationContextCandidates?: readonly ContextCandidate[];
  readonly contextPolicy?: NonNullable<PerCallToolConfig["contextPolicy"]>;
}

export function projectAdmittedTurnContext(input: AdmittedTurnContextProjectionInput): {
  readonly content: string | undefined;
  readonly audit?: ContextAuditEntry;
} {
  const candidates: ContextCandidate[] = [];
  const userContext = formatUserContext(input.userContext);

  if (userContext) {
    candidates.push({
      kind: "memory",
      source: "runtime-user-context",
      content: userContext,
      required: true,
      score: 1,
    });
  }
  if (input.cachedRuntimeSummary) {
    candidates.push({
      kind: "summary",
      source: "runtime-continuity",
      content: input.cachedRuntimeSummary,
      score: 0.9,
    });
  }
  candidates.push(...(input.recalledMemoryCandidates ?? []));
  if (input.knowledgeContext) {
    candidates.push({
      kind: "knowledge",
      source: "runtime-knowledge-context",
      content: input.knowledgeContext,
      score: 0.7,
    });
  }
  if (input.contactContext) {
    candidates.push({
      kind: "memory",
      source: "runtime-contact-context",
      content: input.contactContext,
      score: 0.6,
    });
  }
  if (input.visitorContext) {
    candidates.push({
      kind: "memory",
      source: "runtime-visitor-context",
      content: input.visitorContext,
      score: 0.6,
    });
  }
  candidates.push(...(input.proceduralContextCandidates ?? []));
  candidates.push(...(input.coordinationContextCandidates ?? []));

  const projectedContext = new DefaultContextGovernor<
    never,
    "memory" | "summary" | "knowledge" | "procedural" | "coordination",
    never
  >().project({
    artifacts: candidates,
    contextAllocationMode: input.contextPolicy?.contextAllocationMode,
  });
  const mergedMemory = renderProjectedContext(projectedContext);
  const audit = projectedContext.auditTrail?.[projectedContext.auditTrail.length - 1];
  return {
    content: appendGroundingDirective(mergedMemory, input.groundingMode),
    audit,
  };
}

export interface NormalizedCoordinationContext {
  readonly candidates: readonly ContextCandidate[];
  readonly invalidCandidateCount: number;
}

function sanitizeCoordinationProviderSource(source: unknown): string | undefined {
  if (typeof source !== "string") return undefined;
  const artifactId = source.includes(":") ? source.slice(source.lastIndexOf(":") + 1) : source;
  const sanitized = artifactId
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return sanitized === "" ? undefined : sanitized;
}

export function normalizeCoordinationContextCandidates(candidates: unknown): NormalizedCoordinationContext {
  if (!Array.isArray(candidates)) {
    return { candidates: [], invalidCandidateCount: 1 };
  }

  const normalizedCandidates: ContextCandidate[] = [];
  let invalidCandidateCount = 0;
  candidates.forEach((candidate, index) => {
    if (
      typeof candidate !== "object"
      || candidate === null
      || !("content" in candidate)
      || typeof candidate.content !== "string"
    ) {
      invalidCandidateCount += 1;
      return;
    }

    const provenance = sanitizeCoordinationProviderSource("source" in candidate ? candidate.source : undefined);
    normalizedCandidates.push({
      kind: "coordination",
      source: provenance
        ? `runtime-coordination-provider:${index}:${provenance}`
        : `runtime-coordination-provider:${index}`,
      content: candidate.content,
      score: "score" in candidate && typeof candidate.score === "number" && Number.isFinite(candidate.score)
        ? Math.max(0, Math.min(1, candidate.score))
        : undefined,
      required: false,
    });
  });

  return { candidates: normalizedCandidates, invalidCandidateCount };
}

export async function resolveCoordinationContextCandidates(
  provider: AdmittedTurnContext["coordinationContextProvider"] | undefined,
  input: {
    readonly appName: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly channel: string;
    readonly activeAgentId?: string;
  },
): Promise<{
  readonly candidates: readonly ContextCandidate[];
  readonly failureReason?: CoordinationProviderFailureReason;
}> {
  if (!provider) return { candidates: [] };
  try {
    const providedCoordinationCandidates = await provider(input);
    const normalizedCoordinationContext = normalizeCoordinationContextCandidates(providedCoordinationCandidates);
    return {
      candidates: normalizedCoordinationContext.candidates,
      failureReason: normalizedCoordinationContext.invalidCandidateCount > 0
        ? "provider-validation-error"
        : undefined,
    };
  } catch {
    return {
      candidates: [],
      failureReason: "provider-error",
    };
  }
}

export function appendCoordinationProviderFailureAudit(
  audit: ContextAuditEntry | undefined,
  failureReason: CoordinationProviderFailureReason | undefined,
): ContextAuditEntry | RuntimeContextAudit | undefined {
  if (!failureReason) return audit;
  const baseAudit: ContextAuditEntry = audit ?? {
    governor: "DefaultContextGovernor",
    allocationMode: "whole-block",
    positionProfile: "balanced",
    requiredOverflowPolicy: "admit-and-report",
    selectedBlockIds: [],
    deferredBlockIds: [],
    requiredBlockIds: [],
    preservedRequiredBlockIds: [],
    selectedTokens: 0,
    requiredTokens: 0,
    tokenBudget: 0,
    overflow: false,
    blocks: [],
  };
  return {
    ...baseAudit,
    coordinationProviderFailures: [{
      source: "runtime-coordination-provider",
      reason: failureReason,
    }],
  } satisfies RuntimeContextAudit;
}

export function projectCompletedTurnContextUsage(input: {
  readonly result: OrchestrateResult;
  readonly turnId: string | undefined;
  readonly contextWindow: ContextUsageWindowEvidence | undefined;
}): ContextUsageProjection {
  const request = input.result.providerRequests?.at(-1);
  const providerId = request?.providerId ?? "unknown";
  const modelId = request?.modelId ?? "unknown";
  return normalizeContextUsageProjection({
    providerId,
    modelId,
    turnId: input.turnId ?? "unresolved",
    observedAt: new Date().toISOString(),
    usage: request ? {
      inputTokens: request.inputTokens,
      cacheReadTokens: request.cacheReadTokens,
      cacheWriteTokens: request.cacheWriteTokens,
      cacheSemantics: request.contextUsage?.cacheSemantics ?? "unknown",
    } : undefined,
    contextWindow: input.contextWindow,
    measurement: request?.contextUsage?.measurement ?? "runtime_estimate",
    lifecycle: "completed",
  });
}

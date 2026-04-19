import type { ContextArtifactCache, ResumePolicyDecision } from "@kilnai/core";
import {
  formatRuntimeResumeFeedbackLabel,
  writeRuntimeContinuityOutcomeArtifact,
  writeRuntimeContextBundleArtifact,
  writeRuntimeThreadSummaryArtifact,
  writeRuntimeToolBundleArtifact,
} from "./support/artifacts/context-artifact-summary.js";
import type { ToolExecutionSummary } from "./runtime-session-orchestrator.js";
import type { RuntimeSession } from "./runtime-session.js";

interface RuntimeTurnRoutingDecision {
  readonly provider: string;
  readonly model: string;
  readonly routingTier: string;
}

export interface RuntimeTurnFileChange {
  readonly path: string;
  readonly changeType?: string;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
}

export interface RuntimeTurnApprovalTransition {
  readonly status: "requested" | "approved" | "rejected";
  readonly sessionId: string;
  readonly reason?: string;
}

export interface RuntimeTurnAuthorityDecision {
  readonly toolName: string;
  readonly level: number;
  readonly allowed: boolean;
  readonly reason: string;
}

export interface RuntimeTurnRecordInput {
  readonly session: RuntimeSession;
  readonly channel: string;
  readonly taskShape: string;
  readonly contextArtifactCache?: ContextArtifactCache;
  readonly continuityDecision: ResumePolicyDecision;
  readonly queued: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly contextSummary?: string;
  readonly toolExecutions?: readonly ToolExecutionSummary[];
  readonly routingDecision?: RuntimeTurnRoutingDecision;
  readonly escalationReason?: string;
  readonly groundingBlockedClaims?: readonly string[];
  readonly activeAgentId?: string;
  readonly routingTierHint?: string;
  readonly fileChanges?: readonly RuntimeTurnFileChange[];
  readonly approvalTransitions?: readonly RuntimeTurnApprovalTransition[];
  readonly authorityDecisions?: readonly RuntimeTurnAuthorityDecision[];
}

export interface RuntimeTurnRecord {
  readonly queued: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly provider: string;
  readonly model?: string;
  readonly routingTier?: string;
  readonly contextSummary?: string;
  readonly toolExecutions?: readonly ToolExecutionSummary[];
  readonly continuity: {
    readonly strategy: ResumePolicyDecision["resumeStrategy"];
    readonly cachedResumeSignalCount: number;
    readonly feedbackLabel?: string;
  };
  readonly fileChanges: readonly RuntimeTurnFileChange[];
  readonly approvalTransitions: readonly RuntimeTurnApprovalTransition[];
  readonly authorityDecisions: readonly RuntimeTurnAuthorityDecision[];
  readonly turnDepth: number;
}

function appendExactArtifacts(
  session: RuntimeSession,
  input: Pick<
    RuntimeTurnRecordInput,
    "routingDecision" | "contextSummary" | "toolExecutions" | "groundingBlockedClaims" | "escalationReason"
  >,
): void {
  if (input.routingDecision) {
    session.addExactArtifact(
      `Runtime routed provider: ${input.routingDecision.provider}/${input.routingDecision.model}`,
    );
  }
  if (input.contextSummary) {
    session.addExactArtifact(`Runtime context summary: ${input.contextSummary}`);
  }
  if (input.toolExecutions) {
    for (const exec of input.toolExecutions) {
      session.addExactArtifact(`Tool execution: ${exec.toolName} (${exec.success ? "success" : "error"})`);
      if (exec.resultSummary.trim() !== "") {
        session.addExactArtifact(`Tool result summary: ${exec.resultSummary}`);
      }
    }
  }
  if (input.groundingBlockedClaims && input.groundingBlockedClaims.length > 0) {
    session.addExactArtifact(`Grounding blocked: ${input.groundingBlockedClaims.join("; ")}`);
  }
  if (input.escalationReason) {
    session.addExactArtifact(`Escalation detected: ${input.escalationReason}`);
  }
}

export function applyRuntimeTurnRecord(input: RuntimeTurnRecordInput): RuntimeTurnRecord {
  const { session } = input;
  const turnTokens = input.inputTokens + input.outputTokens;
  const priorProvider = session.sessionLedger.lastProvider;
  const providerForState = input.routingDecision?.provider ?? priorProvider;
  const providerForRecord = providerForState ?? "unknown";
  const modelForRecord = input.routingDecision?.model;
  const routingTierForRecord = input.routingDecision?.routingTier ?? input.routingTierHint;
  const fileChangesForRecord = input.fileChanges ?? [];
  const approvalTransitionsForRecord = input.approvalTransitions ?? [];
  const authorityDecisionsForRecord = input.authorityDecisions ?? [];

  session.accumulateTokens(turnTokens);
  session.updateSessionLedger({
    currentPhase: input.queued ? "queued" : "responded",
    lastProvider: providerForState,
    toolCallCount: input.toolExecutions?.length ?? session.sessionLedger.toolCallCount,
    turnDepth: session.userTurnCount,
    lastSummary: input.contextSummary,
  });

  appendExactArtifacts(session, input);
  if (fileChangesForRecord.length > 0) {
    for (const change of fileChangesForRecord.slice(-8)) {
      session.addExactArtifact(`File changed: ${change.path}`);
    }
  }
  if (approvalTransitionsForRecord.length > 0) {
    for (const transition of approvalTransitionsForRecord.slice(-8)) {
      const reasonSuffix = transition.reason ? ` (${transition.reason})` : "";
      session.addExactArtifact(`Approval ${transition.status}: ${transition.sessionId}${reasonSuffix}`);
    }
  }
  if (authorityDecisionsForRecord.length > 0) {
    for (const decision of authorityDecisionsForRecord.slice(-8)) {
      const verdict = decision.allowed ? "allow" : "deny";
      session.addExactArtifact(`Tool authority: ${decision.toolName} L${decision.level} ${verdict} (${decision.reason})`);
    }
  }

  writeRuntimeThreadSummaryArtifact(input.contextArtifactCache, session);
  writeRuntimeContextBundleArtifact(input.contextArtifactCache, {
    appName: session.appName,
    tenantId: session.tenantId,
    channel: input.channel,
    provider: providerForState ?? "unknown",
    taskShape: input.taskShape,
    activeAgentId: input.activeAgentId,
    routingTier: routingTierForRecord,
    contextSummary: input.contextSummary,
  });
  writeRuntimeToolBundleArtifact(input.contextArtifactCache, {
    appName: session.appName,
    tenantId: session.tenantId,
    channel: input.channel,
    taskShape: input.taskShape,
    toolExecutions: input.toolExecutions,
  });
  writeRuntimeContinuityOutcomeArtifact(input.contextArtifactCache, {
    session,
    channel: input.channel,
    taskShape: input.taskShape,
    decision: input.continuityDecision,
    queued: input.queued,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    toolCount: input.toolExecutions?.length,
    provider: providerForState,
    model: modelForRecord,
  });

  return {
    queued: input.queued,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    provider: providerForRecord,
    model: modelForRecord,
    routingTier: routingTierForRecord,
    contextSummary: input.contextSummary,
    toolExecutions: input.toolExecutions,
    continuity: {
      strategy: input.continuityDecision.resumeStrategy,
      cachedResumeSignalCount: input.continuityDecision.cachedResumeSignalCount,
      feedbackLabel: formatRuntimeResumeFeedbackLabel(input.continuityDecision),
    },
    fileChanges: fileChangesForRecord,
    approvalTransitions: approvalTransitionsForRecord,
    authorityDecisions: authorityDecisionsForRecord,
    turnDepth: session.userTurnCount,
  };
}

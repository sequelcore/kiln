import type {
  ContentPart,
  ArtifactResourceStore,
  SessionLimitsConfig,
  SkillRegistry,
  GroundingMode,
  GroundingResult,
  ProviderAdapter,
  ModelCapabilityRegistry,
  EventBus,
  ContextArtifactCache,
  ContextAuditEntry,
  ContextCandidate,
  ApprovalRequestedEvent,
  ApprovalReceivedEvent,
  ToolAuthorizedEvent,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  MultimodalRoutedEvent,
  ToolCalledEvent,
  ToolResultEvent,
  TenantConfig,
  RetrievalPipeline,
  CanonicalPlanAnalysisFindingDraft,
  CanonicalPlanWorkItemDraft,
  KilnEvent,
  SttAdapter,
  TtsAdapter,
  VoiceConfig,
  VoiceFailureMode,
  VoiceSurface,
  SessionTurnOutcome,
} from "@kilnai/core";
import { DefaultContextGovernor, extractText, hasModality, textParts, GroundingRail, KilnError, renderProjectedContext, skillConfigToContextCandidate, VALID_VOICE_SURFACES } from "@kilnai/core";
import type { AbuseDetectionConfig } from "../session/repetitive-abuse-detector.js";
import { detectRepetitiveAbuse } from "../session/repetitive-abuse-detector.js";
import type {
  RuntimeSessionOrchestrator,
  OrchestrateResult,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary,
} from "../session/runtime-session-orchestrator.js";
import {
  RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON,
  RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON,
  RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON,
} from "../session/runtime-session-orchestrator.types.js";
import {
  describeEffectiveTurnAuthorityActionability,
  formatEffectiveTurnAuthorityGuidance,
  projectEffectiveTurnAuthorityPerCallConfig,
} from "../session/effective-turn-authority.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { BillingConfig } from "./budget-middleware.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import type { SessionMode } from "../session/session-mode.js";
import type { EscalationSignal } from "../session/support/escalation/escalation-detector.js";
import { TraceContext } from "./trace-context.js";
import { appendGroundingDirective, formatKnowledgeContext, formatUserContext } from "./context-formatter.js";
import {
  formatRuntimeContinuityPresentation,
  normalizeRuntimeTaskShape,
  readRuntimeSupportArtifactsDetailed,
  writeRuntimeHandoffSummaryArtifact,
} from "../session/support/artifacts/context-artifact-summary.js";
import {
  applyRuntimeTurnRecord,
  type RuntimeTurnApprovalTransition,
  type RuntimeTurnAuthorityDecision,
  type RuntimeTurnDangerousCommandOutcome,
  type RuntimeTurnFileChange,
  type RuntimeTurnProviderValidation,
  type RuntimeTurnToolCompletion,
} from "../session/runtime-turn-record.js";
import { deriveGovernedTurnOutcome } from "../session/governed-turn-outcome.js";
import { appendCanonicalTurnEvents, type RuntimeTurnAuthorityMutationViolation } from "../session/runtime-session-event-ledger.js";
import { sanitizeAssistantEgressText as sanitizeAssistantEgressTextCanonical } from "../session/assistant-egress-sanitizer.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import type { AgentHandoffSummarizer } from "../session/support/summarization/agent-handoff-summarizer.js";
import type { OperatorExecutionMode, OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import type { RuntimeSession } from "../session/runtime-session.js";
import { authorityFromCapability } from "./tool-authority.js";
import {
  AudioTransformError,
  createAudioTransformRoutingEvents,
  createGenericMediaDownloader,
  transformAudioParts,
} from "./audio-preprocessor.js";
import { captureMultimodalArtifacts } from "./multimodal-artifact-ingestion.js";
import { synthesizeVoiceOutput } from "./voice-output-synthesizer.js";

type EgressDestination = "webhook";
type EgressPermissionDecision = "allow" | "deny" | "redact";
type EgressPayloadType = "assistant-response" | "context-summary" | "tool-result-summary";
const WEB_TOOL_NAMES = ["web_search", "web_fetch", "web_extract"] as const;
type RuntimePipelineLedgerEvent =
  | ApprovalRequestedEvent
  | ApprovalReceivedEvent
  | CostUpdateEvent
  | ErrorEvent
  | ModelRoutedEvent
  | MultimodalRoutedEvent
  | ToolCalledEvent
  | ToolResultEvent;

function deriveCanonicalTurnOutcome(input: {
  readonly runtimeEvents: readonly RuntimePipelineLedgerEvent[];
  readonly surfaceToolCompletions?: readonly RuntimeTurnToolCompletion[];
  readonly toolExecutions?: readonly ToolExecutionSummary[];
  readonly stopReason?: string;
}): SessionTurnOutcome | undefined {
  if (input.stopReason === RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON) {
    return "paused";
  }
  if (isFailedRuntimeStopReason(input.stopReason)) {
    return "failed";
  }
  return deriveGovernedTurnOutcome({
    runtimeToolResults: input.runtimeEvents.filter((event): event is ToolResultEvent => event.type === "tool_result"),
    surfaceToolCompletions: input.surfaceToolCompletions,
    toolExecutions: input.toolExecutions,
  });
}

function isFailedRuntimeStopReason(stopReason: string | undefined): boolean {
  return stopReason === RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON
    || stopReason === RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON;
}

function sanitizeAssistantEgressParts(parts: readonly ContentPart[]): readonly ContentPart[] {
  const sanitized = parts.map((part) => {
    if (part.type !== "text") {
      return part;
    }
    return {
      ...part,
      text: sanitizeAssistantEgressText(part.text),
    };
  });
  return compactAssistantTextParts(sanitized);
}

export function sanitizeAssistantEgressText(text: string): string {
  const withoutToolCallMarkup = stripLeakedProviderToolCallMarkup(text);
  const withoutWorkItemPayload = stripLeakedWorkItemUpdatePayloadPrefix(withoutToolCallMarkup);
  const withoutScratchpadPrefix = stripLeakedInternalScratchpadPrefix(withoutWorkItemPayload);
  return sanitizeAssistantEgressTextCanonical(withoutScratchpadPrefix);
}

function stripLeakedProviderToolCallMarkup(text: string): string {
  const firstLeakedToolCall = text.search(/<assistant\s+to=[^>]+>|to=functions\.[A-Za-z0-9_.-]+/i);
  if (firstLeakedToolCall < 0) {
    return text;
  }
  return text
    .slice(firstLeakedToolCall)
    .replace(/<assistant\s+to=[^>]+>\s*(?:\{[^{}]*\}\s*)*/gi, "")
    .replace(/^\s*to=functions\.[A-Za-z0-9_.-]+\s*(?:\{[^{}]*\}\s*)*/i, "")
    .trimStart();
}

function stripLeakedInternalScratchpadPrefix(text: string): string {
  const trimmed = text.trimStart();
  if (!startsWithScratchpadCue(trimmed)) {
    return text;
  }
  const anchorIndex = findUserFacingAnchorIndex(trimmed);
  if (anchorIndex > 0 && looksLikeScratchpadPrefix(trimmed.slice(0, anchorIndex))) {
    return trimmed.slice(anchorIndex).trimStart();
  }
  if (looksLikeScratchpadPrefix(trimmed)) {
    return "";
  }
  return text;
}

const SCRATCHPAD_CUE = /^(?:Need|Maybe|Use|Search|Check|Also)\b/i;
const USER_FACING_ANCHOR = /\b(?:I['’]ll|I will|I['’]m|I'm|I created|I started|I found|Current status:|Started governed work|No implementation changes)/i;
const SCRATCHPAD_INTERNAL_MARKER = /\b(?:maybe|perhaps|resource_read|web_extract|web_fetch|web_search|browser|tool|tools|github api|read-only command|Need\b.*\bNeed\b)|\?/i;

function startsWithScratchpadCue(text: string): boolean {
  return SCRATCHPAD_CUE.test(text);
}

function findUserFacingAnchorIndex(text: string): number {
  const match = USER_FACING_ANCHOR.exec(text);
  return match?.index ?? -1;
}

function looksLikeScratchpadPrefix(text: string): boolean {
  return startsWithScratchpadCue(text) && SCRATCHPAD_INTERNAL_MARKER.test(text);
}

function compactAssistantTextParts(parts: readonly ContentPart[]): readonly ContentPart[] {
  const compacted: ContentPart[] = [];
  for (const part of parts) {
    if (part.type !== "text") {
      compacted.push(part);
      continue;
    }
    if (part.text.length === 0) {
      continue;
    }
    const previous = compacted.at(-1);
    if (previous?.type !== "text") {
      compacted.push(part);
      continue;
    }
    compacted[compacted.length - 1] = {
      ...previous,
      text: joinAssistantText(previous.text, part.text),
    };
  }
  return compacted;
}

function joinAssistantText(left: string, right: string): string {
  if (left.length === 0 || right.length === 0 || /\s$/.test(left) || /^\s/.test(right)) {
    return `${left}${right}`;
  }
  if (/[.!?]$/.test(left) && /^[A-Z`]/.test(right)) {
    return `${left}\n\n${right}`;
  }
  return `${left} ${right}`;
}

function stripLeakedWorkItemUpdatePayloadPrefix(text: string): string {
  const trimmedStart = text.trimStart();
  if (!trimmedStart.startsWith("{")) {
    return text;
  }
  const leadingJson = readLeadingJsonObject(trimmedStart);
  if (!leadingJson || !looksLikeWorkItemUpdatePayload(leadingJson.value)) {
    return text;
  }
  return trimmedStart.slice(leadingJson.endIndex).trimStart();
}

function readLeadingJsonObject(text: string): { readonly value: Record<string, unknown>; readonly endIndex: number } | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") {
      continue;
    }
    depth -= 1;
    if (depth !== 0) {
      continue;
    }
    try {
      const value = JSON.parse(text.slice(0, index + 1)) as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? { value: value as Record<string, unknown>, endIndex: index + 1 }
        : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function looksLikeWorkItemUpdatePayload(value: Record<string, unknown>): boolean {
  return typeof value.id === "string"
    && Array.isArray(value.providedEvidence)
    && Array.isArray(value.verificationGateResults);
}

interface EgressPermissionRequest {
  readonly tenantId: string;
  readonly channel: string;
  readonly destination: EgressDestination;
  readonly payloadType: EgressPayloadType;
  readonly text: string;
  readonly sessionId: string;
}

export interface AdmittedTurnContext {
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly systemPrompt?: string;
  readonly userParts: readonly ContentPart[];
  readonly artifactStore?: ArtifactResourceStore;
  readonly voiceConfig?: VoiceConfig;
  readonly sttAdapter?: SttAdapter;
  readonly ttsAdapter?: TtsAdapter;
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly channel: string;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly idleTimeoutMs?: number;
  readonly recalledMemory?: string;
  readonly knowledgeContext?: string;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly contactContext?: string;
  readonly tenant?: TenantConfig;
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
  readonly runtimeEvents?: readonly RuntimePipelineLedgerEvent[];
  readonly callBuiltinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly perCallConfig?: PerCallToolConfig;
  readonly traceId?: string;
  readonly activeAgentId?: string;
  readonly activeAgentName?: string;
  readonly voiceProfile?: string;
  readonly voiceOutputIntent?: string;
  readonly isHandoff?: boolean;
  readonly previousAgentId?: string;
  readonly previousAgentName?: string;
  readonly handoffBrief?: string;
  readonly pingPongBlocked?: boolean;
  readonly pingPongReason?: string;
  readonly routingTier?: "rule" | "embedding" | "fallback";
  readonly routingConfidence?: number;
  readonly sessionLimits?: SessionLimitsConfig;
  readonly abuseDetection?: AbuseDetectionConfig;
  readonly skillRegistry?: SkillRegistry;
  readonly activeSkills?: readonly string[];
  readonly activeSkillTags?: readonly string[];
  readonly userContext?: Record<string, string>;
  readonly providerValidation?: readonly RuntimeTurnProviderValidation[];
  readonly executionMode?: OperatorExecutionMode;
  readonly groundingMode?: GroundingMode;
  readonly groundingDeps?: {
    readonly rail: GroundingRail;
    readonly providerPool: ReadonlyMap<string, ProviderAdapter>;
    readonly modelRegistry: ModelCapabilityRegistry;
    readonly eventBus?: EventBus;
  };
  readonly contextArtifactCache?: ContextArtifactCache;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
  readonly coordinationContextProvider?: (input: {
    readonly appName: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly channel: string;
    readonly activeAgentId?: string;
  }) => readonly ContextCandidate[] | Promise<readonly ContextCandidate[]>;
  readonly evaluateEgressPermission?: (
    request: EgressPermissionRequest,
  ) => EgressPermissionDecision | Promise<EgressPermissionDecision>;
  readonly turnCapture?: {
    readonly start?: (sessionId: string, nextSequence: number) => void | Promise<void>;
    readonly finish?: (
      sessionId: string,
    ) => (
      | {
        readonly fileChanges?: readonly RuntimeTurnFileChange[];
        readonly approvalTransitions?: readonly RuntimeTurnApprovalTransition[];
        readonly authorityDecisions?: readonly RuntimeTurnAuthorityDecision[];
        readonly dangerousCommandOutcomes?: readonly RuntimeTurnDangerousCommandOutcome[];
        readonly toolCompletions?: readonly RuntimeTurnToolCompletion[];
      }
      | undefined
      | Promise<{
        readonly fileChanges?: readonly RuntimeTurnFileChange[];
        readonly approvalTransitions?: readonly RuntimeTurnApprovalTransition[];
        readonly authorityDecisions?: readonly RuntimeTurnAuthorityDecision[];
        readonly dangerousCommandOutcomes?: readonly RuntimeTurnDangerousCommandOutcome[];
        readonly toolCompletions?: readonly RuntimeTurnToolCompletion[];
      } | undefined>
    );
    readonly abort?: (sessionId: string) => void | Promise<void>;
  };
}

export interface RuntimeSessionHydrationResult {
  readonly rehydrated: boolean;
  readonly messageCount: number;
  readonly reason?: string;
  readonly sourceSequence?: number;
}

export type RuntimeSessionHydrator = (input: {
  readonly sessionId: string;
  readonly session: RuntimeSession;
}) => RuntimeSessionHydrationResult | Promise<RuntimeSessionHydrationResult>;

function extractPlanSubmissions(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly {
  readonly planId: string;
  readonly planHash: string;
  readonly mode: "plan";
  readonly objective: string;
  readonly nonGoals: readonly string[];
  readonly operatorDecisionsRequired: readonly string[];
  readonly assumptions: readonly string[];
  readonly affectedSurfaces: readonly string[];
  readonly riskClassification: "low" | "medium" | "high" | "critical";
  readonly workflowProfile: string;
  readonly workGovernancePosture: "direct" | "orchestrate" | "delegate";
  readonly workGovernanceRationale: string;
  readonly expectedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly managedAgentDelegationCandidates: readonly string[];
  readonly approvalBoundaries: readonly string[];
  readonly rollbackNotes: string;
  readonly residualRisks: readonly string[];
  readonly sourceSpecificationId: string;
  readonly clarificationRecordIds: readonly string[];
  readonly constitutionSnapshotHash: string;
  readonly constitutionSnapshotIds: readonly string[];
  readonly proposedWorkItemCount: number;
  readonly proposedWorkItems: readonly CanonicalPlanWorkItemDraft[];
  readonly summary: string;
}[] {
  return (toolExecutions ?? [])
    .filter((execution) => execution.toolName === "submit_plan" && execution.success)
    .map((execution) => {
      const metadata = execution.metadata;
      const metadataPlanId = typeof metadata?.planId === "string" ? metadata.planId.trim() : "";
      const metadataPlanHash = typeof metadata?.planHash === "string" ? metadata.planHash.trim() : "";
      const metadataSummary = typeof metadata?.summary === "string" ? metadata.summary.trim() : "";
      const metadataWorkItemCount = typeof metadata?.proposedWorkItemCount === "number" ? metadata.proposedWorkItemCount : undefined;
      const objective = typeof metadata?.objective === "string"
        ? metadata.objective.trim()
        : (typeof execution.input?.objective === "string" ? execution.input.objective.trim() : "");
      const sourceSpecificationId = typeof metadata?.sourceSpecificationId === "string"
        ? metadata.sourceSpecificationId.trim()
        : (typeof execution.input?.sourceSpecificationId === "string"
          ? execution.input.sourceSpecificationId.trim()
          : "");
      const riskClassification = metadata?.riskClassification ?? execution.input?.riskClassification;
      const workflowProfile = typeof metadata?.workflowProfile === "string"
        ? metadata.workflowProfile.trim()
        : extractWorkflowProfile(execution.input?.workGovernanceRecommendation);
      const posture = metadata?.workGovernancePosture ?? extractWorkGovernancePosture(execution.input?.workGovernanceRecommendation);
      const workGovernanceRationale = typeof metadata?.workGovernanceRationale === "string"
        ? metadata.workGovernanceRationale.trim()
        : extractWorkGovernanceRationale(execution.input?.workGovernanceRecommendation);
      if (!objective || !sourceSpecificationId || !workflowProfile) return null;
      if (riskClassification !== "low" && riskClassification !== "medium" && riskClassification !== "high" && riskClassification !== "critical") {
        return null;
      }
      if (posture !== "direct" && posture !== "orchestrate" && posture !== "delegate") {
        return null;
      }
      const nonGoals = extractStringArray(metadata?.nonGoals).length > 0
        ? extractStringArray(metadata?.nonGoals)
        : extractStringArray(execution.input?.nonGoals);
      const operatorDecisionsRequired = extractStringArray(metadata?.operatorDecisionsRequired).length > 0
        ? extractStringArray(metadata?.operatorDecisionsRequired)
        : extractStringArray(execution.input?.operatorDecisionsRequired);
      const assumptions = extractStringArray(metadata?.assumptions).length > 0
        ? extractStringArray(metadata?.assumptions)
        : extractStringArray(execution.input?.assumptions);
      const affectedSurfaces = extractStringArray(metadata?.affectedSurfaces).length > 0
        ? extractStringArray(metadata?.affectedSurfaces)
        : extractStringArray(execution.input?.affectedSurfaces);
      const expectedEvidence = extractStringArray(metadata?.expectedEvidence).length > 0
        ? extractStringArray(metadata?.expectedEvidence)
        : extractStringArray(execution.input?.expectedEvidence);
      const verificationGates = extractStringArray(metadata?.verificationGates).length > 0
        ? extractStringArray(metadata?.verificationGates)
        : extractStringArray(execution.input?.verificationGates);
      const metadataWorkItems = extractPlanWorkItems(metadata?.proposedWorkItems);
      const proposedWorkItems = metadataWorkItems.length > 0
        ? metadataWorkItems
        : extractPlanWorkItems(execution.input?.proposedWorkItems);
      return {
        planId: metadataPlanId || execution.toolCallId || `plan:${execution.durationMs}`,
        planHash: metadataPlanHash,
        mode: "plan",
        objective,
        nonGoals,
        operatorDecisionsRequired,
        assumptions,
        affectedSurfaces,
        riskClassification,
        workflowProfile,
        workGovernancePosture: posture,
        workGovernanceRationale,
        expectedEvidence,
        verificationGates,
        managedAgentDelegationCandidates: extractStringArray(metadata?.managedAgentDelegationCandidates).length > 0
          ? extractStringArray(metadata?.managedAgentDelegationCandidates)
          : extractStringArray(execution.input?.managedAgentDelegationCandidates),
        approvalBoundaries: extractStringArray(metadata?.approvalBoundaries).length > 0
          ? extractStringArray(metadata?.approvalBoundaries)
          : extractStringArray(execution.input?.approvalBoundaries),
        rollbackNotes: typeof metadata?.rollbackNotes === "string"
          ? metadata.rollbackNotes.trim()
          : (typeof execution.input?.rollbackNotes === "string" ? execution.input.rollbackNotes.trim() : ""),
        residualRisks: extractStringArray(metadata?.residualRisks).length > 0
          ? extractStringArray(metadata?.residualRisks)
          : extractStringArray(execution.input?.residualRisks),
        sourceSpecificationId,
        clarificationRecordIds: extractStringArray(metadata?.clarificationRecordIds).length > 0
          ? extractStringArray(metadata?.clarificationRecordIds)
          : extractStringArray(execution.input?.clarificationRecordIds),
        constitutionSnapshotHash: typeof metadata?.constitutionSnapshotHash === "string"
          ? metadata.constitutionSnapshotHash.trim()
          : extractConstitutionSnapshotHash(execution.input?.constitutionSnapshot),
        constitutionSnapshotIds: extractStringArray(metadata?.constitutionSnapshotIds).length > 0
          ? extractStringArray(metadata?.constitutionSnapshotIds)
          : extractConstitutionSnapshotIds(execution.input?.constitutionSnapshot),
        proposedWorkItemCount: metadataWorkItemCount ?? proposedWorkItems.length,
        proposedWorkItems,
        summary: metadataSummary || [
          objective,
          nonGoals[0] ? `first non-goal: ${nonGoals[0]}` : undefined,
          expectedEvidence[0] ? `first evidence: ${expectedEvidence[0]}` : undefined,
        ].filter((part): part is string => part !== undefined).join(" · "),
      };
    })
    .filter((submission): submission is {
      readonly planId: string;
      readonly planHash: string;
      readonly mode: "plan";
      readonly objective: string;
      readonly nonGoals: readonly string[];
      readonly operatorDecisionsRequired: readonly string[];
      readonly assumptions: readonly string[];
      readonly affectedSurfaces: readonly string[];
      readonly riskClassification: "low" | "medium" | "high" | "critical";
      readonly workflowProfile: string;
      readonly workGovernancePosture: "direct" | "orchestrate" | "delegate";
      readonly workGovernanceRationale: string;
      readonly expectedEvidence: readonly string[];
      readonly verificationGates: readonly string[];
      readonly managedAgentDelegationCandidates: readonly string[];
      readonly approvalBoundaries: readonly string[];
      readonly rollbackNotes: string;
      readonly residualRisks: readonly string[];
      readonly sourceSpecificationId: string;
      readonly clarificationRecordIds: readonly string[];
      readonly constitutionSnapshotHash: string;
      readonly constitutionSnapshotIds: readonly string[];
      readonly proposedWorkItemCount: number;
      readonly proposedWorkItems: readonly CanonicalPlanWorkItemDraft[];
      readonly summary: string;
    } => submission !== null);
}

function extractSpecificationSubmissions(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly {
  readonly specificationId: string;
  readonly status: "draft" | "ready_for_plan";
  readonly summary: string;
  readonly issueCodes: readonly string[];
  readonly blockingIssueCodes: readonly string[];
}[] {
  return (toolExecutions ?? [])
    .filter((execution) => execution.toolName === "submit_specification" && execution.success)
    .map((execution) => {
      const metadata = execution.metadata;
      const metadataSpecificationId = typeof metadata?.specificationId === "string"
        ? metadata.specificationId.trim()
        : "";
      const specificationId = metadataSpecificationId
        || (typeof execution.input?.specificationId === "string" && execution.input.specificationId.trim().length > 0
          ? execution.input.specificationId.trim()
          : (execution.toolCallId ? `spec:${execution.toolCallId}` : "spec:unknown"));
      const metadataStatus = metadata?.specificationStatus;
      const normalizedSummary = (execution.resultSummary ?? execution.output ?? "").toLowerCase();
      const status = metadataStatus === "ready_for_plan" || metadataStatus === "draft"
        ? metadataStatus
        : (normalizedSummary.includes("ready for planning") ? "ready_for_plan" : "draft");
      const issueCodes = extractIssueCodes(metadata?.issues);
      const blockingIssueCodes = extractStringArray(metadata?.blockingIssueCodes);
      if (!specificationId) {
        return null;
      }
      return {
        specificationId,
        status,
        summary: status === "ready_for_plan"
          ? `Specification ${specificationId} is ready for planning.`
          : `Specification ${specificationId} has unresolved validation issues.`,
        issueCodes,
        blockingIssueCodes,
      };
    })
    .filter((submission): submission is {
      readonly specificationId: string;
      readonly status: "draft" | "ready_for_plan";
      readonly summary: string;
      readonly issueCodes: readonly string[];
      readonly blockingIssueCodes: readonly string[];
    } => submission !== null);
}

function extractPlanAnalysisReports(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly {
  readonly reportId: string;
  readonly planId: string;
  readonly specificationId: string;
  readonly status: "blocked" | "ready";
  readonly highestSeverity: "critical" | "high" | "medium" | "low" | "none";
  readonly findingIds: readonly string[];
  readonly blockingFindingIds: readonly string[];
  readonly findingCount: number;
  readonly findings: readonly CanonicalPlanAnalysisFindingDraft[];
  readonly summary: string;
}[] {
  return (toolExecutions ?? [])
    .filter((execution) => execution.toolName === "submit_plan")
    .map((execution) => {
      const metadata = execution.metadata;
      const reportId = typeof metadata?.analysisReportId === "string" ? metadata.analysisReportId.trim() : "";
      const planId = typeof metadata?.planId === "string" ? metadata.planId.trim() : "";
      const specificationId = typeof metadata?.sourceSpecificationId === "string" ? metadata.sourceSpecificationId.trim() : "";
      const status = metadata?.analysisStatus;
      const highestSeverity = metadata?.analysisHighestSeverity;
      if (!reportId || !planId || !specificationId) {
        return null;
      }
      if (status !== "blocked" && status !== "ready") {
        return null;
      }
      if (
        highestSeverity !== "critical"
        && highestSeverity !== "high"
        && highestSeverity !== "medium"
        && highestSeverity !== "low"
        && highestSeverity !== "none"
      ) {
        return null;
      }
      const findingIds = extractStringArray(metadata?.analysisFindingIds);
      const blockingFindingIds = extractStringArray(metadata?.analysisBlockingFindingIds);
      const findings = extractAnalysisFindings(metadata?.analysisFindings);
      const findingCount = typeof metadata?.analysisFindingCount === "number" ? metadata.analysisFindingCount : findingIds.length;
      const summary = typeof metadata?.analysisSummary === "string"
        ? metadata.analysisSummary.trim()
        : (status === "blocked" ? "Critical analysis findings block approval." : "No critical findings.");
      return {
        reportId,
        planId,
        specificationId,
        status,
        highestSeverity,
        findingIds,
        blockingFindingIds,
        findingCount,
        findings,
        summary,
      };
    })
    .filter((report): report is {
      readonly reportId: string;
      readonly planId: string;
      readonly specificationId: string;
      readonly status: "blocked" | "ready";
      readonly highestSeverity: "critical" | "high" | "medium" | "low" | "none";
      readonly findingIds: readonly string[];
      readonly blockingFindingIds: readonly string[];
      readonly findingCount: number;
      readonly findings: readonly CanonicalPlanAnalysisFindingDraft[];
      readonly summary: string;
    } => report !== null);
}

function extractAnalysisFindings(value: unknown): readonly CanonicalPlanAnalysisFindingDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const findings: CanonicalPlanAnalysisFindingDraft[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = readNonEmptyString(record.id);
    const fingerprint = readNonEmptyString(record.fingerprint);
    const category = record.category;
    const severity = record.severity;
    const title = readNonEmptyString(record.title);
    const detail = readNonEmptyString(record.detail);
    const status = record.status;
    if (
      !id
      || !fingerprint
      || !isAnalysisFindingCategory(category)
      || !isAnalysisFindingSeverity(severity)
      || !title
      || !detail
      || !isAnalysisFindingStatus(status)
    ) {
      continue;
    }
    findings.push({
      id,
      fingerprint,
      category,
      severity,
      title,
      detail,
      references: extractStringArray(record.references),
      status,
    });
  }
  return findings;
}

function extractClarificationRecords(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly {
  readonly specificationId: string;
  readonly clarificationId: string;
  readonly affectedSection: string;
}[] {
  return (toolExecutions ?? [])
    .filter((execution) => execution.toolName === "record_clarification" && execution.success)
    .map((execution) => {
      const metadata = execution.metadata;
      const specificationId = typeof metadata?.specificationId === "string"
        ? metadata.specificationId.trim()
        : (typeof execution.input?.specificationId === "string"
          ? execution.input.specificationId.trim()
          : "");
      const clarificationId = typeof metadata?.clarificationId === "string"
        ? metadata.clarificationId.trim()
        : (execution.toolCallId ? `clar:${execution.toolCallId}` : "");
      const affectedSection = typeof metadata?.affectedSection === "string"
        ? metadata.affectedSection.trim()
        : (typeof execution.input?.affectedSection === "string"
          ? execution.input.affectedSection.trim()
          : "");
      if (!specificationId || !clarificationId) {
        return null;
      }
      return {
        specificationId,
        clarificationId,
        affectedSection,
      };
    })
    .filter((clarification): clarification is {
      readonly specificationId: string;
      readonly clarificationId: string;
      readonly affectedSection: string;
    } => clarification !== null);
}

function extractStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((entry) => typeof entry === "string" ? [entry.trim()] : [])
    .filter((entry) => entry.length > 0);
}

function extractConstitutionSnapshotHash(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return typeof record.instructionProfileHash === "string"
    ? record.instructionProfileHash.trim()
    : "";
}

function extractConstitutionSnapshotIds(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  return extractStringArray(record.instructionProfileIds);
}

function extractWorkGovernanceRationale(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return typeof record.rationale === "string" ? record.rationale.trim() : "";
}

function extractPlanWorkItems(value: unknown): readonly CanonicalPlanWorkItemDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: CanonicalPlanWorkItemDraft[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = readNonEmptyString(record.id);
    const summary = readNonEmptyString(record.summary);
    const workflowProfile = readNonEmptyString(record.workflowProfile);
    const risk = record.risk;
    if (
      !id
      || !summary
      || !workflowProfile
      || (risk !== "low" && risk !== "medium" && risk !== "high" && risk !== "critical")
    ) {
      continue;
    }
    items.push({
      id,
      summary,
      workflowProfile,
      risk,
      expectedEvidence: extractStringArray(record.expectedEvidence),
      verificationGates: extractStringArray(record.verificationGates),
      dependencies: extractStringArray(record.dependencies),
    });
  }
  return items;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAnalysisFindingCategory(value: unknown): value is CanonicalPlanAnalysisFindingDraft["category"] {
  return value === "duplication"
    || value === "ambiguity"
    || value === "underspecification"
    || value === "constitution_conflict"
    || value === "coverage_gap"
    || value === "task_order_inconsistency"
    || value === "terminology_drift"
    || value === "evidence_mismatch";
}

function isAnalysisFindingSeverity(value: unknown): value is CanonicalPlanAnalysisFindingDraft["severity"] {
  return value === "critical" || value === "high" || value === "medium" || value === "low";
}

function isAnalysisFindingStatus(value: unknown): value is CanonicalPlanAnalysisFindingDraft["status"] {
  return value === "open" || value === "superseded" || value === "closed" || value === "blocked";
}

function extractIssueCodes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return typeof record.code === "string" && record.code.trim().length > 0
      ? [record.code.trim()]
      : [];
  });
}

function extractWorkflowProfile(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return typeof record.workflowProfile === "string" ? record.workflowProfile.trim() : "";
}

function extractWorkGovernancePosture(
  value: unknown,
): "direct" | "orchestrate" | "delegate" | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const posture = record.posture;
  return posture === "direct" || posture === "orchestrate" || posture === "delegate"
    ? posture
    : undefined;
}

export type CoordinationProviderFailureReason = "provider-error" | "provider-validation-error";

export interface RuntimeContextAudit extends ContextAuditEntry {
  readonly coordinationProviderFailures?: readonly {
    readonly source: "runtime-coordination-provider";
    readonly reason: CoordinationProviderFailureReason;
  }[];
}

export interface AdmittedTurnResult {
  readonly parts: readonly ContentPart[];
  readonly admittedInput?: {
    readonly content: string;
  };
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly queued: boolean;
  readonly sessionId: string;
  readonly sessionMode: SessionMode;
  readonly escalation?: EscalationSignal;
  readonly contextSummary?: string;
  readonly toolExecutions?: readonly ToolExecutionSummary[];
  readonly traceId: string;
  readonly activeAgentId?: string;
  readonly routingDecision?: {
    readonly provider: string;
    readonly model: string;
    readonly routingTier: string;
    readonly reasoning?: string;
    readonly selectionMode?: "auto" | "manual_override";
    readonly reasoningEffort?: import("@kilnai/core").ReasoningEffort;
    readonly rationale?: import("@kilnai/core").ModelRoutingRationale;
  };
  readonly limitReached?: { type: "tokens" | "turns" | "abuse"; value: number; max?: number };
  readonly groundingResult?: GroundingResult;
  readonly voiceOutput?: {
    readonly artifactUris: readonly string[];
    readonly provider: string;
    readonly model?: string;
    readonly surface: string;
    readonly mode: "audio-response" | "artifact-only" | "audio-on-demand";
  };
  readonly runtimeContinuity?: {
    readonly strategy: string;
    readonly feedbackLabel?: string;
    readonly pressure?: string;
    readonly supportArtifactCount?: number;
    readonly supportArtifactSources?: readonly string[];
    readonly fallbackLabel?: string;
    readonly usedCachedSupport?: boolean;
    readonly selectionReason?: string;
  };
  readonly contextAudit?: RuntimeContextAudit;
  readonly effectiveTurnAuthority?: NonNullable<PerCallToolConfig["effectiveTurnAuthority"]>;
}

export interface BudgetDeniedResult {
  readonly budgetExhausted: true;
  readonly message: string;
}

export type ProcessResult =
  | { ok: true; result: AdmittedTurnResult }
  | { ok: false; budgetDenied: BudgetDeniedResult };

const EGRESS_DENIED_FALLBACK_TEXT = "I cannot share that response.";
const EGRESS_REDACTED_TEXT = "[REDACTED]";

function mapChannelToEgressDestination(_channel: string): EgressDestination {
  // Gateway egress in this pipeline exits runtime over external integrations.
  // For this slice, model all channels as webhook-class destinations.
  return "webhook";
}

async function resolveEgressDecision(
  ctx: AdmittedTurnContext,
  tenantId: string,
  sessionId: string,
  payloadType: EgressPayloadType,
  text: string | undefined,
): Promise<EgressPermissionDecision> {
  if (!ctx.evaluateEgressPermission) return "allow";
  if (!text || text.trim() === "") return "allow";
  try {
    return await ctx.evaluateEgressPermission({
      tenantId,
      channel: ctx.channel,
      destination: mapChannelToEgressDestination(ctx.channel),
      payloadType,
      text,
      sessionId,
    });
  } catch {
    // Fail-open for this foundation slice.
    return "allow";
  }
}

function redactAssistantParts(parts: readonly ContentPart[]): readonly ContentPart[] {
  let changed = false;
  const redacted = parts.map((part) => {
    if (part.type !== "text") return part;
    changed = true;
    return { type: "text", text: EGRESS_REDACTED_TEXT } as const;
  });
  return changed ? redacted : parts;
}

function dedupeByStableKey<T>(items: readonly T[], toKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = toKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function dangerousCommandOutcomeFromExecution(
  execution: ToolExecutionSummary,
): RuntimeTurnDangerousCommandOutcome | undefined {
  if (execution.success) {
    return undefined;
  }
  const summary = execution.resultSummary.trim();
  const denyPrefix = "Dangerous command blocked: ";
  const askPrefix = "Command requires approval: ";
  let action: "ask" | "deny";
  let details: string;
  if (summary.startsWith(denyPrefix)) {
    action = "deny";
    details = summary.slice(denyPrefix.length);
  } else if (summary.startsWith(askPrefix)) {
    action = "ask";
    details = summary.slice(askPrefix.length);
  } else {
    return undefined;
  }
  const match = /^(.*)\s+\(([^()]+)\)$/.exec(details);
  if (!match) {
    return undefined;
  }
  const reason = match[1]?.trim();
  const reasonCode = match[2]?.trim();
  if (!reason || !reasonCode) {
    return undefined;
  }
  return {
    toolName: execution.toolName,
    action,
    reasonCode,
    reason,
  };
}

function buildAuthorityMutationViolation(
  effectiveTurnAuthority: PerCallToolConfig["effectiveTurnAuthority"] | undefined,
  fileChanges: readonly RuntimeTurnFileChange[],
): RuntimeTurnAuthorityMutationViolation | undefined {
  if (!effectiveTurnAuthority || fileChanges.length === 0) {
    return undefined;
  }
  if (!turnAuthorityDisallowsMutation(effectiveTurnAuthority)) {
    return undefined;
  }
  return {
    errorCode: "AUTHORITY_MUTATION_VIOLATION",
    message: "Observed file changes outside admitted turn authority.",
    details: {
      executionMode: effectiveTurnAuthority.executionMode,
      requestedAuthority: effectiveTurnAuthority.requestedAuthority,
      admittedAuthority: effectiveTurnAuthority.admittedAuthority,
      fileChangeCount: fileChanges.length,
      paths: fileChanges.map((change) => change.path),
    },
  };
}

function turnAuthorityDisallowsMutation(
  authority: NonNullable<PerCallToolConfig["effectiveTurnAuthority"]>,
): boolean {
  return authority.executionMode === "plan"
    || authority.requestedAuthority === "planning"
    || authority.requestedAuthority === "read_only"
    || authority.admittedAuthority === "read_only"
    || authority.admittedAuthority === "fail_closed";
}

interface AdmittedTurnContextProjectionInput {
  readonly userContext: Record<string, string> | undefined;
  readonly cachedRuntimeSummary: string | undefined;
  readonly recalledMemory: string | undefined;
  readonly knowledgeContext: string | undefined;
  readonly contactContext: string | undefined;
  readonly visitorContext?: string | undefined;
  readonly groundingMode: GroundingMode | undefined;
  readonly proceduralContextCandidates?: readonly ContextCandidate[];
  readonly coordinationContextCandidates?: readonly ContextCandidate[];
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
  if (input.recalledMemory) {
    candidates.push({
      kind: "memory",
      source: "runtime-recalled-memory",
      content: input.recalledMemory,
      score: 0.8,
    });
  }
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

function buildAuthorityGuidanceContextCandidate(perCallConfig: PerCallToolConfig | undefined, input: {
  readonly executionMode: OperatorExecutionMode;
  readonly requestedAuthority: OperatorTurnRequestedAuthority | undefined;
}): ContextCandidate {
  return {
    kind: "procedural",
    source: "runtime-authority-guidance",
    required: true,
    score: 1,
    content: formatEffectiveTurnAuthorityGuidance(describeEffectiveTurnAuthorityActionability({
      authority: perCallConfig?.effectiveTurnAuthority,
      executionMode: input.executionMode,
      requestedAuthority: input.requestedAuthority,
    })),
  };
}

function buildGovernedWorkCloseoutContextCandidate(): ContextCandidate {
  return {
    kind: "procedural",
    source: "runtime-governed-work-closeout",
    required: true,
    score: 1,
    content: [
      "Governed work closeout:",
      "Use shared work tools for operator-requested implementation, refactoring, mutation, commit, or other executable governed work.",
      "Materialize governed work with the shared work tools, then either start execution, finish execution, complete the work item, submit a structured plan when planning is the terminal deliverable, or record a concrete pending pause requirement.",
      "After a successful managed_agent.invoke for an open work item, continue with the same work item until it is started, finished, completed, or explicitly blocked with a pause requirement.",
      "A pending, in_progress, or blocked work item without terminal closeout projects as failed in CLI, TUI, and GUI.",
    ].join("\n"),
  };
}

function buildWebSourceAttributionContextCandidate(): ContextCandidate {
  return {
    kind: "procedural",
    source: "runtime-web-source-attribution",
    required: true,
    score: 1,
    content: [
      "Web source attribution:",
      "When web_search, web_fetch, or web_extract informs the answer, include a final sources section with the exact source URLs used.",
      "Do not rely on tool artifacts as the only citation surface; user-facing answers must carry the relevant URLs directly.",
    ].join("\n"),
  };
}

function hasWebToolAvailable(perCallConfig: PerCallToolConfig | undefined): boolean {
  const toolNames = new Set<string>([
    ...(perCallConfig?.toolAllowlist ? Array.from(perCallConfig.toolAllowlist) : []),
    ...(perCallConfig?.additionalTools?.map((tool) => tool.name) ?? []),
    ...(perCallConfig?.perCallCapabilities ? Array.from(perCallConfig.perCallCapabilities.keys()) : []),
  ]);
  return WEB_TOOL_NAMES.some((toolName) => toolNames.has(toolName));
}

function shouldIncludeGovernedWorkCloseoutContext(userText: string): boolean {
  const normalized = userText.toLocaleLowerCase();
  return [
    /\b(implement|fix|fixes|fixing|patch|edit|modify|change|refactor|commit|build|write tests|add tests|delete|remove)\b/u,
    /\b(implementa|corrige|arregla|edita|modifica|cambia|refactoriza|comitea|construye|borra|elimina)\b/u,
  ].some((pattern) => pattern.test(normalized));
}

function appendWebSourceAttributionIfMissing(
  parts: readonly ContentPart[],
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly ContentPart[] {
  const responseText = extractText(parts);
  if (!responseText.trim()) {
    return parts;
  }

  const sources = collectWebAttributionSources(toolExecutions);
  if (sources.length === 0) {
    return parts;
  }
  if (sources.some((source) => responseText.includes(source.url))) {
    return parts;
  }

  const attribution = [
    "",
    "## Fuentes",
    "",
    ...sources.map((source) => `- ${source.title ? `${source.title}: ` : ""}${source.url}`),
  ].join("\n");

  let appended = false;
  const nextParts = parts.map((part) => {
    if (part.type !== "text" || appended) {
      return part;
    }
    appended = true;
    return { ...part, text: `${part.text.trimEnd()}${attribution}` };
  });

  return appended ? nextParts : textParts(attribution.trimStart());
}

function collectWebAttributionSources(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly { readonly title?: string; readonly url: string }[] {
  const sources: { title?: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const execution of toolExecutions ?? []) {
    if (!WEB_TOOL_NAMES.includes(execution.toolName as (typeof WEB_TOOL_NAMES)[number])) {
      continue;
    }
    for (const source of readWebSourcesFromExecution(execution)) {
      const normalizedUrl = normalizeAttributionUrl(source.url);
      if (!normalizedUrl || seen.has(normalizedUrl)) {
        continue;
      }
      seen.add(normalizedUrl);
      sources.push({
        ...(source.title ? { title: truncateAttributionTitle(source.title) } : {}),
        url: normalizedUrl,
      });
      if (sources.length >= 8) {
        return sources;
      }
    }
  }
  return sources;
}

function readWebSourcesFromExecution(
  execution: ToolExecutionSummary,
): readonly { readonly title?: string; readonly url: string }[] {
  const sources: { title?: string; url: string }[] = [];
  const metadata = execution.metadata;
  const metadataSources = Array.isArray(metadata?.["sources"]) ? metadata["sources"] : [];
  for (const source of metadataSources) {
    const record = readAttributionRecord(source);
    const url = readAttributionText(record?.["url"]);
    if (url) {
      const title = readAttributionText(record?.["title"]);
      sources.push({ ...(title ? { title } : {}), url });
    }
  }

  const metadataPages = Array.isArray(metadata?.["pages"]) ? metadata["pages"] : [];
  for (const page of metadataPages) {
    const record = readAttributionRecord(page);
    const url = readAttributionText(record?.["url"]);
    if (url) {
      const title = readAttributionText(record?.["title"]);
      sources.push({ ...(title ? { title } : {}), url });
    }
  }

  const metadataUrl = readAttributionText(metadata?.["url"]);
  if (metadataUrl) {
    sources.push({ url: metadataUrl });
  }

  if (sources.length > 0) {
    return sources;
  }

  return extractUrlsFromText(`${execution.output ?? ""}\n${execution.resultSummary ?? ""}`)
    .map((url) => ({ url }));
}

function readAttributionRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readAttributionText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractUrlsFromText(text: string): readonly string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>)\]]+/gi), (match) => match[0]);
}

function normalizeAttributionUrl(url: string): string | undefined {
  const trimmed = url.trim().replace(/[.,;:!?]+$/u, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function truncateAttributionTitle(title: string): string {
  const compact = title.replace(/\s+/gu, " ").trim();
  if (compact.length <= 120) {
    return compact;
  }
  return `${compact.slice(0, 117).trimEnd()}...`;
}

function projectRequestedAuthorityPerCallConfig(
  config: PerCallToolConfig | undefined,
  executionMode: OperatorExecutionMode,
  requestedAuthority: OperatorTurnRequestedAuthority | undefined,
  reason: string,
): PerCallToolConfig | undefined {
  return projectEffectiveTurnAuthorityPerCallConfig({
    config,
    executionMode,
    requestedAuthority,
    reason,
    authorityDescriptorFromCapability: authorityFromCapability,
  });
}

function replayCapturedRuntimeLedgerEvents(
  eventBus: EventBus | undefined,
  sessionId: string,
  since: Date,
  seed: readonly RuntimePipelineLedgerEvent[],
): {
  readonly events: RuntimePipelineLedgerEvent[];
  readonly keys: Set<string>;
} {
  const events: RuntimePipelineLedgerEvent[] = [];
  const keys = new Set<string>();
  for (const event of seed) {
    appendRuntimeLedgerEvent(events, keys, event, sessionId);
  }
  if (eventBus) {
    for (const event of eventBus.history()) {
      if (isRuntimeLedgerEvent(event) && event.timestamp >= since) {
        appendRuntimeLedgerEvent(events, keys, event, sessionId);
      }
    }
  }
  return { events, keys };
}

function isRuntimeLedgerEvent(event: KilnEvent): event is
  RuntimePipelineLedgerEvent {
  switch (event.type) {
    case "approval_requested":
    case "approval_received":
    case "cost_update":
    case "error":
    case "model_routed":
    case "multimodal_routed":
    case "tool_called":
    case "tool_result":
      return true;
    default:
      return false;
  }
}

function appendRuntimeLedgerEvent(
  events: RuntimePipelineLedgerEvent[],
  keys: Set<string>,
  event: RuntimePipelineLedgerEvent,
  sessionId: string,
): boolean {
  if (event.sessionId !== sessionId) {
    return false;
  }
  const key = runtimeLedgerEventKey(event);
  if (keys.has(key)) {
    return false;
  }
  keys.add(key);
  events.push(event);
  return true;
}

async function resolveVoiceInputParts(input: {
  readonly parts: readonly ContentPart[];
  readonly voiceConfig?: VoiceConfig;
  readonly sttAdapter?: SttAdapter;
  readonly artifactStore?: ArtifactResourceStore;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly channel: string;
  readonly sessionId: string;
}): Promise<{
  readonly parts: readonly ContentPart[];
  readonly events: readonly RuntimePipelineLedgerEvent[];
}> {
  if (!hasModality(input.parts, "audio") || !shouldApplyVoiceInputTransform(input.voiceConfig, input.channel)) {
    return { parts: input.parts, events: [] };
  }

  const failureMode = resolveVoiceInputFailureMode(input.voiceConfig, input.channel);
  if (!input.sttAdapter) {
    return handleVoiceInputFailure({
      parts: input.parts,
      failureMode,
      message: "Voice input requested but no STT adapter is configured.",
    });
  }
  if (!input.artifactStore) {
    return handleVoiceInputFailure({
      parts: input.parts,
      failureMode,
      message: "Voice input requested but no artifact store is configured for governed audio evidence.",
    });
  }

  try {
    const transformed = await transformAudioParts(input.parts, input.sttAdapter, createGenericMediaDownloader(), {
      artifactStore: input.artifactStore,
      sourceIdPrefix: `${input.appName}:${input.tenantId}:${input.userId}:${input.channel}`,
      maxArtifacts: input.voiceConfig?.policy?.artifacts?.retentionMaxArtifacts,
    });
    return {
      parts: transformed.parts,
      events: createAudioTransformRoutingEvents({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        provider: input.sttAdapter.name,
        model: input.voiceConfig?.stt.model ?? input.sttAdapter.name,
      }, transformed.transforms),
    };
  } catch (error) {
    if (error instanceof AudioTransformError) {
      const events = createAudioTransformRoutingEvents({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        provider: input.sttAdapter.name,
        model: input.voiceConfig?.stt.model ?? input.sttAdapter.name,
      }, error.transforms);
      if (failureMode === "fail-open") {
        return { parts: input.parts, events };
      }
      throw new KilnError("STT_FAILED", "Voice input transcription failed.", {
        context: { provider: input.sttAdapter.name, channel: input.channel },
        cause: error,
      });
    }
    throw error;
  }
}

function shouldApplyVoiceInputTransform(voiceConfig: VoiceConfig | undefined, channel: string): boolean {
  if (!voiceConfig) {
    return false;
  }
  const surface = toVoiceSurface(channel);
  if (!surface) {
    return false;
  }
  const surfacePolicy = voiceConfig.policy?.surfaces?.[surface];
  if (surfacePolicy?.enabled === false) {
    return false;
  }
  const inputModes = surfacePolicy?.input?.modes;
  if (inputModes && inputModes.length === 0) {
    return false;
  }
  return true;
}

function resolveVoiceInputFailureMode(
  voiceConfig: VoiceConfig | undefined,
  channel: string,
): VoiceFailureMode {
  const surface = toVoiceSurface(channel);
  return (surface ? voiceConfig?.policy?.surfaces?.[surface]?.input?.failureMode : undefined)
    ?? voiceConfig?.policy?.defaultInputFailureMode
    ?? "fail-closed";
}

function handleVoiceInputFailure(input: {
  readonly parts: readonly ContentPart[];
  readonly failureMode: VoiceFailureMode;
  readonly message: string;
}): {
  readonly parts: readonly ContentPart[];
  readonly events: readonly RuntimePipelineLedgerEvent[];
} {
  if (input.failureMode === "fail-open") {
    return { parts: input.parts, events: [] };
  }
  throw new KilnError("STT_FAILED", input.message, {
    retryable: false,
  });
}

function toVoiceSurface(channel: string): VoiceSurface | undefined {
  return VALID_VOICE_SURFACES.includes(channel as VoiceSurface)
    ? channel as VoiceSurface
    : undefined;
}

function runtimeLedgerEventKey(event: RuntimePipelineLedgerEvent): string {
  const base = `${event.type}|${event.sessionId}|${event.timestamp.toISOString()}`;
  switch (event.type) {
    case "approval_requested":
      return `${base}|${event.approvalId}`;
    case "approval_received":
      return `${base}|${event.approvalId}|${event.approved}`;
    case "cost_update":
      return `${base}|${event.provider ?? ""}|${event.model ?? ""}|${event.inputTokens}|${event.outputTokens}`;
    case "error":
      return `${base}|${event.code}|${event.message}`;
    case "model_routed":
      return `${base}|${event.provider}|${event.model}|${event.routingTier}`;
    case "multimodal_routed":
      return `${base}|${event.provider}|${event.model}|${event.strategy}|${event.reasonCode}|${event.requestedCapability}`;
    case "tool_called":
      return `${base}|${event.toolName}|${event.taskId ?? ""}`;
    case "tool_result":
      return `${base}|${event.toolName}|${event.success}|${event.resultSummary}`;
  }
}

export async function processAdmittedTurn(ctx: AdmittedTurnContext): Promise<ProcessResult> {
  const trace = new TraceContext(ctx.traceId);
  trace.log("pipeline", "Processing inbound message", { appName: ctx.appName, userId: ctx.userId, channel: ctx.channel });
  let userParts = ctx.artifactStore
    ? await captureMultimodalArtifacts(ctx.userParts, {
      artifactStore: ctx.artifactStore,
      downloader: createGenericMediaDownloader(),
      sourceKind: "uploaded-file",
      sourceIdPrefix: `${ctx.appName}:${ctx.tenantId}:${ctx.userId}:${ctx.channel}`,
      producerName: `gateway-${ctx.channel}-ingress`,
    })
    : ctx.userParts;
  const turnStartedAt = new Date();
  let preAdmissionRuntimeEvents: readonly RuntimePipelineLedgerEvent[] = [];
  const effectiveTenantId = ctx.tenant?.tenantId ?? ctx.tenantId;
  const executionMode = ctx.executionMode ?? "execute";
  const initialSystemPrompt = ctx.tenant
    ? buildTenantSystemPrompt(ctx.tenant)
    : (ctx.systemPrompt ?? "You are a helpful assistant.");

  // Budget check
  if (ctx.billing) {
    const budgetResult = await checkBudget(ctx.billing, effectiveTenantId);
    if (!budgetResult.allowed) {
      trace.log("pipeline", "Budget denied");
      return {
        ok: false,
        budgetDenied: {
          budgetExhausted: true,
          message: ctx.billing.overBudgetMessage ?? "Budget exhausted.",
        },
      };
    }
  }

  const shouldAttemptResumeHydration = ctx.sessionId !== undefined && ctx.resumeSessionHydrator !== undefined;
  const existingResumeTarget = shouldAttemptResumeHydration && ctx.sessionId
    ? await ctx.sessionRegistry.getById(ctx.sessionId)
    : undefined;
  const shouldHydrateResumedSession = shouldAttemptResumeHydration
    && (existingResumeTarget === undefined || existingResumeTarget.isExpired);

  // Get or create session
  const session = await ctx.sessionRegistry.getOrCreate({
    appName: ctx.appName,
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    systemPrompt: initialSystemPrompt,
    idleTimeoutMs: ctx.idleTimeoutMs,
  });
  trace.log("pipeline", "Session ready", { sessionId: session.id, sessionMode: session.sessionMode });

  if (shouldHydrateResumedSession && ctx.sessionId && ctx.resumeSessionHydrator) {
    try {
      const hydration = await ctx.resumeSessionHydrator({ sessionId: ctx.sessionId, session });
      const summary = hydration.rehydrated
        ? `Runtime session rehydrated from transcript: ${hydration.messageCount} messages`
        : `Runtime session rehydration skipped: ${hydration.reason ?? "no usable transcript"}`;
      session.addExactArtifact(summary);
      session.updateSessionLedger({
        lastSummary: summary,
      });
      trace.log("pipeline", "Resume hydration completed", {
        sessionId: session.id,
        rehydrated: hydration.rehydrated,
        messageCount: hydration.messageCount,
        reason: hydration.reason,
        sourceSequence: hydration.sourceSequence,
      });
    } catch (error) {
      const summary = `Runtime session rehydration failed: ${error instanceof Error ? error.message : String(error)}`;
      session.addExactArtifact(summary);
      session.updateSessionLedger({ lastSummary: summary });
      trace.warn("pipeline", "Resume hydration failed", { sessionId: session.id, error: String(error) });
    }
  }

  // Merge incoming user context into session (merge semantics: keys accumulate)
  if (ctx.userContext && Object.keys(ctx.userContext).length > 0) {
    session.updateUserContext(ctx.userContext);
  }

  const voiceInput = await resolveVoiceInputParts({
    parts: userParts,
    voiceConfig: ctx.voiceConfig,
    sttAdapter: ctx.sttAdapter,
    artifactStore: ctx.artifactStore,
    appName: ctx.appName,
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    channel: ctx.channel,
    sessionId: session.id,
  });
  userParts = voiceInput.parts;
  preAdmissionRuntimeEvents = voiceInput.events;

  const userText = extractText(userParts);
  const taskShape = normalizeRuntimeTaskShape(userText);

  let effectiveKnowledgeContext = ctx.knowledgeContext;
  if (!effectiveKnowledgeContext && ctx.knowledgePipeline && (ctx.knowledgeMode ?? "auto") === "auto") {
    if (userText.length > 0) {
      try {
        const results = await ctx.knowledgePipeline.retrieve(userText, { topK: 5 });
        effectiveKnowledgeContext = formatKnowledgeContext(results);
      } catch {
        // fail-open
      }
    }
  }

  let effectiveCallBuiltinTools = ctx.callBuiltinTools;
  let effectivePerCallConfig = ctx.perCallConfig;
  let effectiveActiveAgentId = ctx.activeAgentId;
  let effectiveActiveAgentName = ctx.activeAgentName;
  let effectiveRoutingTier = ctx.routingTier;
  let effectiveRoutingConfidence = ctx.routingConfidence;
  let effectiveIsHandoff = ctx.isHandoff;
  let effectivePreviousAgentId = ctx.previousAgentId;
  let effectivePreviousAgentName = ctx.previousAgentName;
  let effectiveHandoffBrief = ctx.handoffBrief;
  let effectivePingPongBlocked = ctx.pingPongBlocked;
  let effectivePingPongReason = ctx.pingPongReason;

  if (ctx.tenant) {
    const agentCtx = await resolveAgentContextAsync(
      ctx.tenant,
      userParts,
      session,
      { handoffSummarizer: ctx.handoffSummarizer, eventBus: ctx.eventBus },
      undefined,
      effectiveCallBuiltinTools,
      session.userContext,
    );

    effectiveActiveAgentId = agentCtx.activeAgentId;
    effectiveActiveAgentName = agentCtx.activeAgentName;
    effectiveRoutingTier = agentCtx.routingResult?.tier;
    effectiveRoutingConfidence = agentCtx.routingResult?.confidence;
    effectiveIsHandoff = agentCtx.isHandoff;
    effectivePreviousAgentId = agentCtx.previousAgentId;
    effectivePreviousAgentName = effectivePreviousAgentId
      ? ctx.tenant.agents?.find((agent) => agent.id === effectivePreviousAgentId)?.name
      : undefined;
    effectiveHandoffBrief = agentCtx.handoffBrief;
    effectivePingPongBlocked = agentCtx.pingPongBlocked;
    effectivePingPongReason = agentCtx.pingPongReason;

    const tenantToolCtx = agentCtx.tenantToolContext;
    if (tenantToolCtx.toolDefinitions.length > 0) {
      ctx.orchestrator.registerTools(tenantToolCtx.toolDefinitions);
    }

    if (tenantToolCtx.callBuiltinTools.size > 0) {
      effectiveCallBuiltinTools = tenantToolCtx.callBuiltinTools;
    }

    effectivePerCallConfig = {
      ...effectivePerCallConfig,
      tenantId: effectiveTenantId,
      toolAuthority: tenantToolCtx.toolAuthority,
      toolAllowlist: tenantToolCtx.toolAllowlist,
      rateLimiter: tenantToolCtx.rateLimiter,
      additionalTools: tenantToolCtx.toolDefinitions.length > 0 ? tenantToolCtx.toolDefinitions : undefined,
      perCallCapabilities: tenantToolCtx.capabilities.size > 0 ? tenantToolCtx.capabilities : undefined,
      ...(tenantToolCtx.executionEnvelope ? { executionEnvelope: tenantToolCtx.executionEnvelope } : {}),
    };

    session.setSystemPrompt(agentCtx.systemPrompt);
    if (agentCtx.activeAgentId) {
      session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
    }
  }

  session.updateSessionLedger({
    currentPhase: "processing",
    turnDepth: session.messageCount + 1,
  });

  // Session turn limit check
  if (ctx.sessionLimits?.maxTurns && session.userTurnCount >= ctx.sessionLimits.maxTurns) {
    trace.warn("pipeline", "Session turn limit reached", { turns: session.userTurnCount, max: ctx.sessionLimits.maxTurns });
    if (ctx.eventEmitter) {
      ctx.eventEmitter.emit({
        eventType: "SESSION_LIMIT_REACHED",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        limitType: "turns",
        limitValue: session.userTurnCount,
        limitMax: ctx.sessionLimits.maxTurns,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
    session.setSessionMode("human_active");
    await ctx.sessionRegistry.save(session);
    return {
      ok: true,
      result: {
        parts: [],
        admittedInput: { content: userText },
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        queued: true,
        sessionId: session.id,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        limitReached: { type: "turns", value: session.userTurnCount, max: ctx.sessionLimits.maxTurns },
      },
    };
  }

  // Session token limit check
  if (ctx.sessionLimits?.maxTokens && session.totalTokens >= ctx.sessionLimits.maxTokens) {
    trace.warn("pipeline", "Session token limit reached", { tokens: session.totalTokens, max: ctx.sessionLimits.maxTokens });
    if (ctx.eventEmitter) {
      ctx.eventEmitter.emit({
        eventType: "SESSION_LIMIT_REACHED",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        limitType: "tokens",
        limitValue: session.totalTokens,
        limitMax: ctx.sessionLimits.maxTokens,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
    session.setSessionMode("human_active");
    await ctx.sessionRegistry.save(session);
    return {
      ok: true,
      result: {
        parts: [],
        admittedInput: { content: userText },
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        queued: true,
        sessionId: session.id,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        limitReached: { type: "tokens", value: session.totalTokens, max: ctx.sessionLimits.maxTokens },
      },
    };
  }

  // Repetitive abuse detection
  if (ctx.abuseDetection) {
    const abuse = detectRepetitiveAbuse(userText, session.conversationHistory, ctx.abuseDetection);
    if (abuse) {
      trace.warn("pipeline", "Abuse detected", { type: abuse.type, confidence: abuse.confidence });
      if (ctx.eventEmitter) {
        ctx.eventEmitter.emit({
          eventType: "SESSION_LIMIT_REACHED",
          tenantId: effectiveTenantId,
          channel: ctx.channel,
          externalUserId: ctx.userId,
          sessionId: session.id,
          schemaVersion: "1",
          limitType: "abuse",
          limitValue: abuse.confidence,
          traceId: trace.traceId,
          timestamp: new Date().toISOString(),
        });
      }
      session.setSessionMode("human_active");
      await ctx.sessionRegistry.save(session);
      return {
        ok: true,
        result: {
          parts: [],
          admittedInput: { content: userText },
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          queued: true,
          sessionId: session.id,
          sessionMode: session.sessionMode,
          traceId: trace.traceId,
          limitReached: { type: "abuse", value: abuse.confidence },
        },
      };
    }
  }

  // Project admitted-turn context for orchestrator consumption.
  const runtimeSupport = readRuntimeSupportArtifactsDetailed(ctx.contextArtifactCache, {
    session,
    channel: ctx.channel,
    providerHint: session.sessionLedger.lastProvider,
    taskShape,
  });
  const runtimeContinuityPresentation = formatRuntimeContinuityPresentation(runtimeSupport);
  const cachedRuntimeSummary = runtimeSupport.content;
  session.addExactArtifact(runtimeContinuityPresentation.decisionSummary);
  trace.log("pipeline", "Runtime continuity decision", {
    strategy: runtimeContinuityPresentation.runtimeContinuity.strategy,
    signals: runtimeSupport.decision.cachedResumeSignalCount,
    pressure: runtimeContinuityPresentation.runtimeContinuity.pressure,
    sources: runtimeContinuityPresentation.runtimeContinuity.supportArtifactSources,
    fallback: runtimeContinuityPresentation.runtimeContinuity.fallbackLabel,
    usedSelectedSources: runtimeContinuityPresentation.runtimeContinuity.usedCachedSupport,
    selectionReason: runtimeContinuityPresentation.runtimeContinuity.selectionReason,
    usedCache: runtimeContinuityPresentation.runtimeContinuity.strategy === "cache-first",
    feedback: runtimeContinuityPresentation.runtimeContinuity.feedbackLabel,
    influenced: runtimeSupport.decision.resumeFeedback?.influencedChoice ?? false,
  });
  const perCallConfig = projectRequestedAuthorityPerCallConfig(
    effectivePerCallConfig,
    executionMode,
    ctx.requestedAuthority,
    "gateway admitted turn requested authority",
  );
  const proceduralContextCandidates: ContextCandidate[] = [];
  if (executionMode === "plan") {
    proceduralContextCandidates.push({
      kind: "procedural",
      source: "runtime-execution-mode:plan",
      required: true,
      score: 1,
      content: [
        "Execution mode: plan.",
        "Do not mutate files, run destructive commands, apply patches, install dependencies, or execute implementation work.",
        "Use only read-only inspection tools as needed.",
        "When the plan is ready, call submit_plan with a structured governed plan artifact linked to sourceSpecificationId and clarificationRecordIds.",
      ].join("\n"),
    });
  }
  proceduralContextCandidates.push(buildAuthorityGuidanceContextCandidate(perCallConfig, {
    executionMode,
    requestedAuthority: ctx.requestedAuthority,
  }));
  if (executionMode === "execute" && shouldIncludeGovernedWorkCloseoutContext(userText)) {
    proceduralContextCandidates.push(buildGovernedWorkCloseoutContextCandidate());
  }
  if (hasWebToolAvailable(perCallConfig)) {
    proceduralContextCandidates.push(buildWebSourceAttributionContextCandidate());
  }
  if (ctx.skillRegistry && (ctx.activeSkills?.length || ctx.activeSkillTags?.length)) {
    const resolved = ctx.skillRegistry.resolve(ctx.activeSkills, ctx.activeSkillTags);
    for (const skill of resolved) {
      const loadedSkill = ctx.skillRegistry.load(skill.name);
      if (loadedSkill) {
        proceduralContextCandidates.push(skillConfigToContextCandidate(loadedSkill));
      }
    }
  }
  const coordinationContext = await resolveCoordinationContextCandidates(ctx.coordinationContextProvider, {
    appName: ctx.appName,
    tenantId: effectiveTenantId,
    userId: ctx.userId,
    sessionId: session.id,
    channel: ctx.channel,
    activeAgentId: effectiveActiveAgentId,
  });
  const projectedTurnContext = projectAdmittedTurnContext({
    userContext: session.userContext,
    cachedRuntimeSummary,
    recalledMemory: ctx.recalledMemory,
    knowledgeContext: effectiveKnowledgeContext,
    contactContext: ctx.contactContext,
    groundingMode: ctx.groundingMode,
    proceduralContextCandidates,
    coordinationContextCandidates: coordinationContext.candidates,
  });
  const projectedContextAudit = appendCoordinationProviderFailureAudit(
    projectedTurnContext.audit,
    coordinationContext.failureReason,
  );

  // Capture real approval state transitions for this turn from runtime events.
  const approvalTransitions: RuntimeTurnApprovalTransition[] = [];
  const authorityDecisions: RuntimeTurnAuthorityDecision[] = [];
  const capturedRuntimeReplay = replayCapturedRuntimeLedgerEvents(
    ctx.orchestrator.eventBus,
    session.id,
    turnStartedAt,
    [...(ctx.runtimeEvents ?? []), ...preAdmissionRuntimeEvents],
  );
  const capturedRuntimeEvents = capturedRuntimeReplay.events;
  const capturedRuntimeEventKeys = capturedRuntimeReplay.keys;
  const orchestratorEventBus = ctx.orchestrator.eventBus;
  const onApprovalRequested = (event: ApprovalRequestedEvent): void => {
    if (event.sessionId !== session.id) return;
    if (!appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id)) {
      return;
    }
    approvalTransitions.push({
      approvalId: event.approvalId,
      status: "requested",
      sessionId: event.sessionId,
      reason: event.description,
    });
  };
  const onApprovalReceived = (event: ApprovalReceivedEvent): void => {
    if (event.sessionId !== session.id) return;
    if (!appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id)) {
      return;
    }
    approvalTransitions.push({
      approvalId: event.approvalId,
      status: event.approved ? "approved" : "rejected",
      sessionId: event.sessionId,
      reason: event.reason,
    });
  };
  const onToolAuthorized = (event: ToolAuthorizedEvent): void => {
    if (event.sessionId !== session.id) return;
    authorityDecisions.push({
      toolName: event.toolName,
      level: event.level,
      allowed: event.allowed,
      reason: event.reason,
    });
  };
  const onRuntimeLedgerEvent = (
    event: CostUpdateEvent | ErrorEvent | ModelRoutedEvent | MultimodalRoutedEvent | ToolCalledEvent | ToolResultEvent,
  ): void => {
    if (event.sessionId !== session.id) {
      return;
    }
    appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id);
  };
  orchestratorEventBus?.on("approval_requested", onApprovalRequested);
  orchestratorEventBus?.on("approval_received", onApprovalReceived);
  orchestratorEventBus?.on("tool_authorized", onToolAuthorized);
  orchestratorEventBus?.on("cost_update", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("error", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("model_routed", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("multimodal_routed", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_called", onRuntimeLedgerEvent);
  orchestratorEventBus?.on("tool_result", onRuntimeLedgerEvent);
  await ctx.turnCapture?.start?.(session.id, session.nextSessionEventSequence());

  let result: OrchestrateResult;
  try {
    // Process message
    result = await ctx.orchestrator.processMessage(
      session,
      userParts,
      projectedTurnContext,
      effectiveCallBuiltinTools,
      perCallConfig,
    );
  } catch (error) {
    const turnFailedAt = new Date();
    const failureRuntimeEvents = capturedRuntimeEvents.some((event) => event.type === "error")
      ? capturedRuntimeEvents
      : [...capturedRuntimeEvents, runtimeFailureEvent(error, session.id, turnFailedAt)];
    appendCanonicalTurnEvents({
      session,
      turnId: perCallConfig?.turnId,
      channel: ctx.channel,
      userMessageContent: userText,
      queued: false,
      turnOutcome: "failed",
      turnStartedAt,
      turnCompletedAt: turnFailedAt,
      continuity: runtimeContinuityPresentation.runtimeContinuity,
      runtimeEvents: failureRuntimeEvents,
    });
    await ctx.sessionRegistry.save(session);
    await ctx.turnCapture?.abort?.(session.id);
    throw error;
  } finally {
    orchestratorEventBus?.off("approval_requested", onApprovalRequested);
    orchestratorEventBus?.off("approval_received", onApprovalReceived);
    orchestratorEventBus?.off("tool_authorized", onToolAuthorized);
    orchestratorEventBus?.off("cost_update", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("error", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("model_routed", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("multimodal_routed", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_called", onRuntimeLedgerEvent);
    orchestratorEventBus?.off("tool_result", onRuntimeLedgerEvent);
  }
  const externalTurnCapture = await ctx.turnCapture?.finish?.(session.id);

  // Post-generation grounding verification (Tier 2)
  let groundingResult: GroundingResult | undefined;
  let resultParts = result.parts;
  if (
    ctx.groundingMode === "verified" &&
    ctx.groundingDeps &&
    effectiveKnowledgeContext &&
    !result.queued &&
    extractText(result.parts)
  ) {
    const chunks = effectiveKnowledgeContext.split("\n---\n").filter(Boolean);
    const responseText = extractText(result.parts);
    try {
      // Select cheapest model with structured output support
      const eligible = ctx.groundingDeps.modelRegistry
        .eligible({ hasTools: false, requiresStreaming: false })
        .filter((p) => p.supportsStructuredOutput)
        .sort((a, b) => a.inputPer1M - b.inputPer1M);
      const judge = eligible[0];
      const provider = judge ? ctx.groundingDeps.providerPool.get(judge.provider) : undefined;
      if (provider && judge) {
        groundingResult = await ctx.groundingDeps.rail.evaluate(responseText, chunks, provider, judge.model);
        // Emit internal event
        if (ctx.groundingDeps.eventBus) {
          const evt: import("@kilnai/core").GroundingEvaluatedEvent = {
            type: "grounding_evaluated",
            timestamp: new Date(),
            sessionId: session.id,
            tenantId: ctx.tenantId,
            grounded: groundingResult.grounded,
            confidence: groundingResult.confidence,
            ungroundedClaims: groundingResult.ungroundedClaims,
            durationMs: groundingResult.durationMs,
            model: groundingResult.model,
          };
          ctx.groundingDeps.eventBus.emit(evt);
        }
        // Replace response if ungrounded
        if (!groundingResult.grounded) {
          trace.warn("pipeline", "Grounding check failed", {
            confidence: groundingResult.confidence,
            claims: groundingResult.ungroundedClaims.length,
          });
          resultParts = textParts("I don't have enough verified information to answer that accurately. Let me connect you with our team for a precise answer.");
        }
      }
    } catch (err) {
      // Fail-open: grounding check error does not block the response
      trace.warn("pipeline", "Grounding check error (fail-open)", { error: String(err) });
    }
  }

  const fileChanges = result.toolExecutions?.flatMap((exec) => exec.fileChanges ?? []);
  const mergedFileChanges = dedupeByStableKey([
    ...(fileChanges ?? []),
    ...(externalTurnCapture?.fileChanges ?? []),
  ], (change) => `${change.path}|${change.changeType}|${"linesAdded" in change ? change.linesAdded ?? "" : ""}|${"linesRemoved" in change ? change.linesRemoved ?? "" : ""}|${"diffPreview" in change ? change.diffPreview ?? "" : ""}|${"diffTruncated" in change ? String(change.diffTruncated ?? "") : ""}`);
  const mergedApprovalTransitions = dedupeByStableKey([
    ...approvalTransitions,
    ...(externalTurnCapture?.approvalTransitions ?? []),
  ], (transition) => `${transition.sessionId}|${transition.status}|${transition.reason ?? ""}`);
  const mergedAuthorityDecisions = dedupeByStableKey([
    ...authorityDecisions,
    ...(externalTurnCapture?.authorityDecisions ?? []),
  ], (decision) => `${decision.toolName}|${decision.level}|${decision.allowed}|${decision.reason ?? ""}`);
  const dangerousCommandOutcomes = result.toolExecutions
    ?.map((execution) => dangerousCommandOutcomeFromExecution(execution))
    .filter((outcome): outcome is RuntimeTurnDangerousCommandOutcome => outcome !== undefined)
    ?? [];
  const mergedDangerousCommandOutcomes = dedupeByStableKey([
    ...dangerousCommandOutcomes,
    ...(externalTurnCapture?.dangerousCommandOutcomes ?? []),
  ], (outcome) => `${outcome.toolName}|${outcome.action}|${outcome.reasonCode}|${outcome.reason}`);
  const planSubmissions = executionMode === "plan"
    ? extractPlanSubmissions(result.toolExecutions)
    : [];
  const specificationSubmissions = executionMode === "plan"
    ? extractSpecificationSubmissions(result.toolExecutions)
    : [];
  const clarificationRecords = executionMode === "plan"
    ? extractClarificationRecords(result.toolExecutions)
    : [];
  const analysisReports = executionMode === "plan"
    ? extractPlanAnalysisReports(result.toolExecutions)
    : [];
  const authorityMutationViolation = buildAuthorityMutationViolation(
    perCallConfig?.effectiveTurnAuthority,
    mergedFileChanges,
  );

  resultParts = appendWebSourceAttributionIfMissing(resultParts, result.toolExecutions);
  let egressContextSummary = result.contextSummary;
  let egressToolExecutions = result.toolExecutions;
  resultParts = sanitizeAssistantEgressParts(resultParts);
  const assistantDecision = await resolveEgressDecision(
    ctx,
    effectiveTenantId,
    session.id,
    "assistant-response",
    extractText(resultParts),
  );

  if (assistantDecision === "deny") {
    resultParts = textParts(EGRESS_DENIED_FALLBACK_TEXT);
  } else if (assistantDecision === "redact") {
    resultParts = redactAssistantParts(resultParts);
  }

  if (assistantDecision === "deny") {
    egressContextSummary = undefined;
  } else if (assistantDecision === "redact" && egressContextSummary !== undefined) {
    egressContextSummary = EGRESS_REDACTED_TEXT;
  } else {
    const summaryDecision = await resolveEgressDecision(
      ctx,
      effectiveTenantId,
      session.id,
      "context-summary",
      result.contextSummary,
    );
    if (summaryDecision === "deny") {
      egressContextSummary = undefined;
    } else if (summaryDecision === "redact" && egressContextSummary !== undefined) {
      egressContextSummary = EGRESS_REDACTED_TEXT;
    }
  }

  if (egressToolExecutions && egressToolExecutions.length > 0) {
    const mapped: ToolExecutionSummary[] = [];
    for (const exec of egressToolExecutions) {
      let summaryDecision: EgressPermissionDecision;
      if (assistantDecision === "deny") {
        summaryDecision = "deny";
      } else if (assistantDecision === "redact") {
        summaryDecision = "redact";
      } else {
        summaryDecision = await resolveEgressDecision(
          ctx,
          effectiveTenantId,
          session.id,
          "tool-result-summary",
          exec.resultSummary,
        );
      }

      if (summaryDecision === "deny") {
        mapped.push({ ...exec, resultSummary: "" });
      } else if (summaryDecision === "redact") {
        mapped.push({ ...exec, resultSummary: EGRESS_REDACTED_TEXT });
      } else {
        mapped.push(exec);
      }
    }
    egressToolExecutions = mapped;
  }

  const voiceSynthesis = await synthesizeVoiceOutput(
    resultParts,
    ctx.voiceConfig,
    ctx.ttsAdapter,
    {
      artifactStore: ctx.artifactStore,
      appName: ctx.appName,
      tenantId: effectiveTenantId,
      userId: ctx.userId,
      channel: ctx.channel,
      sessionId: session.id,
      model: result.routingDecision?.model ?? ctx.orchestrator.model ?? "gateway-transform",
      voiceProfile: ctx.voiceProfile,
      voiceOutputIntent: ctx.voiceOutputIntent,
      escalationReason: result.escalation?.reason,
      retentionMaxArtifacts: ctx.voiceConfig?.policy?.artifacts?.retentionMaxArtifacts,
    },
  );
  resultParts = voiceSynthesis.parts;
  for (const event of voiceSynthesis.events) {
    appendRuntimeLedgerEvent(capturedRuntimeEvents, capturedRuntimeEventKeys, event, session.id);
  }

  applyRuntimeTurnRecord({
    session,
    channel: ctx.channel,
    taskShape,
    contextArtifactCache: ctx.contextArtifactCache,
    continuityDecision: runtimeSupport.decision,
    queued: result.queued,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    contextSummary: result.contextSummary,
    toolExecutions: result.toolExecutions,
    routingDecision: result.routingDecision,
    escalationReason: result.escalation?.reason,
    groundingBlockedClaims: groundingResult && !groundingResult.grounded
      ? groundingResult.ungroundedClaims
      : undefined,
    activeAgentId: effectiveActiveAgentId,
    routingTierHint: effectiveRoutingTier,
    fileChanges: mergedFileChanges.length > 0 ? mergedFileChanges : undefined,
    approvalTransitions: mergedApprovalTransitions.length > 0 ? mergedApprovalTransitions : undefined,
    authorityDecisions: mergedAuthorityDecisions.length > 0 ? mergedAuthorityDecisions : undefined,
    dangerousCommandOutcomes: mergedDangerousCommandOutcomes.length > 0 ? mergedDangerousCommandOutcomes : undefined,
    providerValidation: ctx.providerValidation,
  });
  writeRuntimeHandoffSummaryArtifact(ctx.contextArtifactCache, {
    session,
    handoffBrief: effectiveHandoffBrief,
    handoffBlocked: effectivePingPongBlocked,
    handoffBlockReason: effectivePingPongReason,
    escalationReason: result.escalation?.reason,
    escalationDetail: result.escalation?.detail,
  });
  appendCanonicalTurnEvents({
    session,
    turnId: perCallConfig?.turnId,
    channel: ctx.channel,
    userMessageContent: userText,
    assistantMessageContent: extractText(resultParts),
    queued: result.queued,
    turnOutcome: deriveCanonicalTurnOutcome({
      runtimeEvents: capturedRuntimeEvents,
      surfaceToolCompletions: externalTurnCapture?.toolCompletions,
      toolExecutions: result.toolExecutions,
      stopReason: result.stopReason,
    }),
    turnStartedAt,
    turnCompletedAt: new Date(),
    continuity: runtimeContinuityPresentation.runtimeContinuity,
    runtimeEvents: capturedRuntimeEvents,
    planSubmissions,
    analysisReports,
    specificationSubmissions,
    clarificationRecords,
    authorityMutationViolations: authorityMutationViolation ? [authorityMutationViolation] : undefined,
    fileChanges: mergedFileChanges.length > 0 ? mergedFileChanges : undefined,
  });

  // Persist mutated session (required for non-reference stores like Redis)
  await ctx.sessionRegistry.save(session);

  // Report usage (fire-and-forget)
  if (ctx.billing) {
    reportUsage(ctx.billing, {
      tenantId: effectiveTenantId,
      messages: 1,
      tokens: result.inputTokens + result.outputTokens,
      model: result.routingDecision?.model ?? ctx.orchestrator.model ?? "unknown",
    });
  }

  // Emit events (fire-and-forget)
  if (ctx.eventEmitter) {
    ctx.eventEmitter.emit({
      eventType: "MESSAGE_RECEIVED",
      tenantId: effectiveTenantId,
      channel: ctx.channel,
      externalUserId: ctx.userId,
      sessionId: session.id,
      schemaVersion: "1",
      turnNumber: session.messageCount,
      traceId: trace.traceId,
      timestamp: new Date().toISOString(),
    });

    // Emit HANDOFF_MESSAGE_QUEUED when message was queued (session not ai_active)
    if (result.queued) {
      ctx.eventEmitter.emit({
        eventType: "HANDOFF_MESSAGE_QUEUED",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit ESCALATION_DETECTED when escalation signal is present
    if (result.escalation) {
      trace.warn("pipeline", "Escalation detected", { reason: result.escalation.reason });
      ctx.eventEmitter.emit({
        eventType: "ESCALATION_DETECTED",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        escalationReason: result.escalation.reason,
        escalationDetail: result.escalation.detail,
        summary: egressContextSummary,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit TOOL_EXECUTED events for product backend visibility
    if (egressToolExecutions) {
      for (const exec of egressToolExecutions) {
        ctx.eventEmitter.emit({
          eventType: "TOOL_EXECUTED",
          tenantId: effectiveTenantId,
          channel: ctx.channel,
          externalUserId: ctx.userId,
          sessionId: session.id,
          schemaVersion: "1",
          toolName: exec.toolName,
          durationMs: exec.durationMs,
          success: exec.success,
          resultSummary: exec.resultSummary || undefined,
          traceId: trace.traceId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Emit AGENT_ROUTED when multi-agent routing is active
    if (effectiveActiveAgentId) {
      ctx.eventEmitter.emit({
        eventType: "AGENT_ROUTED",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        activeAgentId: effectiveActiveAgentId,
        activeAgentName: effectiveActiveAgentName,
        routingTier: effectiveRoutingTier,
        routingConfidence: effectiveRoutingConfidence,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit AGENT_HANDOFF when an agent switch occurred (or was blocked)
    if (effectiveIsHandoff || effectivePingPongBlocked) {
      ctx.eventEmitter.emit({
        eventType: "AGENT_HANDOFF",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        sessionId: session.id,
        schemaVersion: "1",
        fromAgentId: effectivePreviousAgentId,
        fromAgentName: effectivePreviousAgentName,
        toAgentId: effectiveActiveAgentId,
        toAgentName: effectiveActiveAgentName,
        handoffBrief: effectiveHandoffBrief,
        handoffBlocked: effectivePingPongBlocked,
        handoffBlockReason: effectivePingPongReason,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit MODEL_ROUTED when model routing occurred
    if (result.routingDecision) {
      ctx.eventEmitter.emit({
        eventType: "MODEL_ROUTED",
        tenantId: effectiveTenantId,
        channel: ctx.channel,
        externalUserId: ctx.userId,
        selectedProvider: result.routingDecision.provider,
        selectedModel: result.routingDecision.model,
        routingTier: result.routingDecision.routingTier,
        selectionMode: result.routingDecision.selectionMode,
        reasoningEffort: result.routingDecision.reasoningEffort,
        routingRationale: result.routingDecision.rationale,
        sessionId: session.id,
        schemaVersion: "1",
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Emit GROUNDING_BLOCKED when response was replaced
  if (groundingResult && !groundingResult.grounded && ctx.eventEmitter) {
    ctx.eventEmitter.emit({
      eventType: "GROUNDING_BLOCKED",
      tenantId: effectiveTenantId,
      channel: ctx.channel,
      externalUserId: ctx.userId,
      sessionId: session.id,
      schemaVersion: "1",
      confidence: groundingResult.confidence,
      ungroundedClaims: groundingResult.ungroundedClaims,
      model: groundingResult.model,
      traceId: trace.traceId,
      timestamp: new Date().toISOString(),
    });
  }

  trace.log("pipeline", "Message processed", { queued: result.queued, tokens: result.inputTokens + result.outputTokens });

  return {
    ok: true,
    result: {
      parts: resultParts,
      admittedInput: { content: userText },
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      queued: result.queued,
      sessionId: session.id,
      sessionMode: session.sessionMode,
      escalation: result.escalation,
      contextSummary: egressContextSummary,
      toolExecutions: egressToolExecutions,
      traceId: trace.traceId,
      activeAgentId: effectiveActiveAgentId,
      routingDecision: result.routingDecision
        ? {
            provider: result.routingDecision.provider,
            model: result.routingDecision.model,
            routingTier: result.routingDecision.routingTier,
            reasoning: result.routingDecision.reasoning,
            selectionMode: result.routingDecision.selectionMode,
            reasoningEffort: result.routingDecision.reasoningEffort,
            rationale: result.routingDecision.rationale,
          }
        : undefined,
      groundingResult,
      voiceOutput: voiceSynthesis.voiceOutput,
      runtimeContinuity: runtimeContinuityPresentation.runtimeContinuity,
      contextAudit: projectedContextAudit,
      effectiveTurnAuthority: perCallConfig?.effectiveTurnAuthority,
    },
  };
}

function runtimeFailureEvent(error: unknown, sessionId: string, timestamp: Date): ErrorEvent {
  return {
    type: "error",
    code: error instanceof KilnError ? error.code : "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
    taskId: null,
    timestamp,
    sessionId,
  };
}

import type { VerificationResult } from "@kilnai/core";
import {
  VerifiedEfficiencyEvidenceProjectionSchema,
  type ContextUsageProjection,
  type VerifiedEfficiencyEvidenceProjection,
} from "@kilnai/gateway-contracts";
import type { ContextGovernanceSummary, SessionReport } from "../wrapper/index.js";
import type { RunSessionAttemptResult, RunSessionTranscriptEvent } from "./run-session.js";

export const RUN_OUTPUT_MODES = ["human", "answer", "json"] as const;

export type RunOutputMode = typeof RUN_OUTPUT_MODES[number];

/**
 * Parent-session capability gap recorded when work-governance requires
 * delegation but `kiln run` cannot satisfy the gate. Two sub-reasons:
 *
 * - delegation-surface-unavailable: the managed invocation surface is absent
 *   from this session (the original #50 S2 absent-surface case).
 * - delegation-required-but-not-dispatched: the surface is present and the
 *   model classified the task as requiring delegation, but no child was
 *   dispatched during the session (the #50 present-but-unused case).
 *
 * This is distinct from the per-child-route EvidenceRealizationCapabilityPause
 * in @kilnai/core — that records a child route lacking tools to realize specific
 * evidence; this records the parent session's governance gap.
 *
 * sessionSucceeded remains true when the gap fires: the session did
 * complete and produce an answer. The gap record is the truthful signal
 * that governance was unsatisfied. Downstream consumers should treat
 * the presence of a capabilityGap as "governance gate not honored"
 * independently of the success boolean.
 */
export interface CapabilityGapRecord {
  /** Reuses the "capability_pause" status string for vocabulary alignment
   *  with EvidenceRealizationCapabilityPause, but this is a parent-session
   *  record, not a child-route admission failure. */
  readonly kind: "capability_pause";
  /** Sub-reason for the gap:
   *  - delegation-surface-unavailable: no managed invocation surface is attached.
   *  - delegation-required-but-not-dispatched: surface is present but the model
   *    classified the task as requiring delegation and no child was dispatched. */
  readonly reason: "delegation-surface-unavailable" | "delegation-required-but-not-dispatched";
  /**
   * The triggers that matched. For absent-surface gaps this is the full configured
   * requireDelegationFor list (no task classification available). For present-but-unused
   * gaps this is the INTERSECTION of model-classified triggers and the configured list —
   * never the full configured list unfiltered.
   */
  readonly matchedTriggers: readonly string[];
  /** The resolved work-governance posture that requires delegation. */
  readonly posture: "orchestrate";
  /** Human-readable diagnosis for operator inspection. */
  readonly message: string;
}

/**
 * Operator diagnostic emitted when a `kiln run` session under `read_only` authority
 * has a managed invocation surface attached. The surface admits `managed_agent.invoke`/
 * `start`/`orchestrate` (with authority-narrowing), but NOT `managed_agent.cancel` —
 * cancel carries a mutate/compensatable envelope that is correctly denied by the
 * read_only authority branch. This note tells the operator what authority they need
 * to cancel a child.
 *
 * This is a diagnostic only; it does NOT change the admission behavior.
 */
export interface ManagedInvocationAuthorityNote {
  /** Fixed diagnostic: the operator must re-invoke with destructive authority to cancel a child. */
  readonly managedAgentCancelNote: string;
}

/**
 * Extract the model's task trigger classification from the session transcript.
 *
 * Scans transcript events for `work_governance.assess` tool_use calls and
 * returns the `triggers` array from the model's input. When multiple calls exist,
 * the last one wins (the most recent classification).
 *
 * Returns an empty array when no `work_governance.assess` call exists in the
 * transcript — meaning the model never classified the task. An unclassified
 * task has no known delegation gate, so the present-but-unused gap does not fire.
 * This is defensible per #50: the gap is about a KNOWN-unsatisfied gate.
 */
export function extractModelClassifiedTriggers(
  transcript: readonly RunSessionTranscriptEvent[],
): readonly string[] {
  let lastTriggers: readonly string[] = [];
  for (const entry of transcript) {
    if (entry.event.type !== "tool_use") continue;
    if (entry.event.toolName !== "work_governance.assess") continue;
    const input = entry.event.input;
    if (typeof input !== "object" || input === null) continue;
    const triggers = (input as { triggers?: unknown }).triggers;
    if (!Array.isArray(triggers)) continue;
    lastTriggers = triggers.filter((t): t is string => typeof t === "string");
  }
  return lastTriggers;
}

/**
 * Compute an operator diagnostic note when a read_only run has a managed
 * invocation surface attached. The note informs the operator that canceling
 * a child requires re-invoking with `--authority destructive`.
 *
 * Returns undefined when the diagnostic is not applicable (not read_only,
 * surface not attached, or authority undefined).
 */
export function computeManagedInvocationAuthorityNotes(input: {
  readonly requestedAuthority: string | undefined;
  readonly managedInvocationAvailable: boolean;
}): ManagedInvocationAuthorityNote | undefined {
  if (input.requestedAuthority !== "read_only") return undefined;
  if (!input.managedInvocationAvailable) return undefined;
  return {
    managedAgentCancelNote:
      "managed_agent.cancel is unavailable under read_only authority. " +
      "To cancel a child started by a prior turn, re-invoke with --authority destructive.",
  };
}

/**
 * Compute a parent-session capability gap when work-governance posture is
 * orchestrate and delegation is required but unsatisfied.
 *
 * Two sub-reasons:
 * 1. delegation-surface-unavailable — the surface is absent (existing Stage 2 behavior).
 * 2. delegation-required-but-not-dispatched — surface is present, model classified
 *    the task as requiring delegation, but no child was dispatched.
 *
 * Returns undefined when no gap exists.
 */
export function computeDelegationCapabilityGap(input: {
  readonly defaultPosture: "orchestrate" | "direct" | undefined;
  readonly requireDelegationFor: readonly string[] | undefined;
  readonly managedInvocationAvailable: boolean;
  /** Model-classified triggers from the session transcript. Omit when unavailable
   *  (pre-session computation or absent surface). */
  readonly classifiedTriggers?: readonly string[] | undefined;
  /** Whether a managed child was dispatched during the session. */
  readonly childDispatched?: boolean | undefined;
}): CapabilityGapRecord | undefined {
  const posture = input.defaultPosture ?? "direct";
  const configuredTriggers = input.requireDelegationFor ?? [];

  if (posture !== "orchestrate") return undefined;
  if (configuredTriggers.length === 0) return undefined;

  // Absent surface: original #50 S2 case. Report all configured triggers
  // since task classification is unavailable without a session transcript.
  if (!input.managedInvocationAvailable) {
    const triggerList = configuredTriggers.join(", ");
    return {
      kind: "capability_pause",
      reason: "delegation-surface-unavailable",
      matchedTriggers: configuredTriggers,
      posture: "orchestrate",
      message:
        `Work governance requires delegation for ${triggerList}, but the managed invocation surface is unavailable in this ` +
        `session. The configured delegation posture (orchestrate) cannot be honored. ` +
        `Downstream consumers should treat this run as having an unsatisfied governance gate.`,
    };
  }

  // Surface is present — apply classified-trigger precision if available.
  // If no classified triggers are provided (e.g. no transcript to parse from
  // or no work_governance.assess call), do NOT produce a present-but-unused gap.
  // An unclassified task has no known delegation gate (defensible per #50).
  const classified = input.classifiedTriggers ?? [];
  if (classified.length === 0) return undefined;

  // Intersection: triggers the model classified AND the operator configured.
  const matchedTriggers = classified.filter((t) => configuredTriggers.includes(t));
  if (matchedTriggers.length === 0) return undefined;

  // Child was dispatched — gate is satisfied.
  if (input.childDispatched) return undefined;

  const triggerList = matchedTriggers.join(", ");
  return {
    kind: "capability_pause",
    reason: "delegation-required-but-not-dispatched",
    matchedTriggers,
    posture: "orchestrate",
    message:
      `Work governance posture (orchestrate) requires delegation for ${triggerList}, but no managed child was dispatched ` +
      `during the session. The model classified the task as matching these delegation triggers, and the managed ` +
      `invocation surface is available, yet no managed_agent.invoke or managed_agent.start was called. ` +
      `Downstream consumers should treat this run as having an unsatisfied governance gate.`,
  };
}

export interface RunOutputSink {
  readonly mode: RunOutputMode;
  writeAssistantDelta(content: string): void;
  resetAssistantAnswer(answer: string): void;
  writeToolUse(toolName: string): void;
  writeToolOutputDelta(content: string): void;
  writeProviderFallback(providerId: string): void;
}

export interface RunOutputController extends RunOutputSink {
  readonly capturedAnswer: string;
  writeTelemetryLine(line?: string): void;
  writeErrorLine(line: string): void;
  emitAnswer(answer: string): void;
  emitJson(envelope: RunJsonOutputEnvelope): void;
}

export interface RunJsonOutputEnvelope {
  readonly schemaVersion: "kiln.run.output.v1";
  readonly mode: "json";
  readonly answer: string;
  readonly telemetry: {
    readonly sessionId: string;
    readonly task: string;
    readonly domain: string;
    readonly sessionSucceeded: boolean;
    readonly provider?: string;
    readonly model?: string;
    readonly costUsd: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly toolCallCount: number;
    readonly turnDepth: number;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly durationMs: number;
    readonly verificationPassed?: boolean;
    readonly contextGovernance?: ContextGovernanceSummary;
    readonly contextUsage?: ContextUsageProjection;
    readonly efficiencyEvidence?: VerifiedEfficiencyEvidenceProjection;
  };
  readonly diagnostics: {
    readonly lastError: string | null;
    readonly attempts: readonly RunSessionAttemptResult[];
    readonly verificationResult?: VerificationResult;
    readonly evalScore?: SessionReport["evalScore"];
    /** Present only when work-governance requires delegation but the
     *  parent session lacks a managed invocation surface, or when the
     *  surface is present but the model classified the task as requiring
     *  delegation and no child was dispatched. Absent when delegation is
     *  not required or the gate was satisfied. */
    readonly capabilityGap?: CapabilityGapRecord;
    /** Present only when run is read_only and a managed invocation surface
     *  is attached. Diagnostic-only: informs the operator that canceling a
     *  child requires re-invoking with --authority destructive. */
    readonly managedInvocationAuthorityNotes?: ManagedInvocationAuthorityNote;
  };
  readonly resources: {
    readonly exactArtifacts: readonly string[];
  };
}

export function parseRunOutputMode(value: string | undefined): RunOutputMode {
  if (value === undefined || value.trim() === "") {
    return "human";
  }
  const normalized = value.trim().toLowerCase();
  if (isRunOutputMode(normalized)) {
    return normalized;
  }
  throw new Error(`Unknown run output mode '${value}'. Use human, answer, or json.`);
}

export function createRunOutputController(mode: RunOutputMode): RunOutputController {
  let capturedAnswer = "";
  return {
    mode,
    get capturedAnswer() {
      return capturedAnswer;
    },
    writeAssistantDelta(content: string): void {
      capturedAnswer += content;
      if (mode === "human") {
        process.stdout.write(content);
      }
    },
    resetAssistantAnswer(answer: string): void {
      capturedAnswer = answer;
    },
    writeToolUse(toolName: string): void {
      const line = `[tool] ${toolName}`;
      if (mode === "human") {
        console.log(line);
      } else {
        writeNonHumanTelemetry(line);
      }
    },
    writeToolOutputDelta(content: string): void {
      process.stderr.write(content);
    },
    writeProviderFallback(providerId: string): void {
      const line = `[kiln] Provider ${providerId} failed, trying next...`;
      if (mode === "human") {
        console.error(line);
      } else {
        writeNonHumanTelemetry(line);
      }
    },
    writeTelemetryLine(line = ""): void {
      if (mode === "human") {
        console.log(line);
      } else {
        writeNonHumanTelemetry(line);
      }
    },
    writeErrorLine(line: string): void {
      if (mode === "human") {
        console.error(line);
      } else {
        writeNonHumanTelemetry(line);
      }
    },
    emitAnswer(answer: string): void {
      if (mode === "answer") {
        process.stdout.write(answer);
      }
    },
    emitJson(envelope: RunJsonOutputEnvelope): void {
      if (mode === "json") {
        process.stdout.write(`${JSON.stringify(envelope)}\n`);
      }
    },
  };
}

export function createNonHumanRunOutputSink(mode: Exclude<RunOutputMode, "human"> = "answer"): RunOutputSink {
  return {
    mode,
    writeAssistantDelta(): void {},
    resetAssistantAnswer(): void {},
    writeToolUse(toolName: string): void {
      writeNonHumanTelemetry(`[tool] ${toolName}`);
    },
    writeToolOutputDelta(content: string): void {
      process.stderr.write(content);
    },
    writeProviderFallback(providerId: string): void {
      writeNonHumanTelemetry(`[kiln] Provider ${providerId} failed, trying next...`);
    },
  };
}

export function buildRunJsonOutputEnvelope(input: {
  readonly answer: string;
  readonly sessionId: string;
  readonly task: string;
  readonly domain: string;
  readonly sessionSucceeded: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCallCount: number;
  readonly turnDepth: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly verificationPassed?: boolean;
  readonly contextGovernance?: ContextGovernanceSummary;
  readonly contextUsage?: ContextUsageProjection;
  readonly efficiencyEvidence?: VerifiedEfficiencyEvidenceProjection;
  readonly lastError: string | null;
  readonly attempts: readonly RunSessionAttemptResult[];
  readonly verificationResult?: VerificationResult;
  readonly evalScore?: SessionReport["evalScore"];
  readonly exactArtifacts: readonly string[];
  readonly capabilityGap?: CapabilityGapRecord;
  readonly managedInvocationAuthorityNotes?: ManagedInvocationAuthorityNote;
}): RunJsonOutputEnvelope {
  return {
    schemaVersion: "kiln.run.output.v1",
    mode: "json",
    answer: input.answer,
    telemetry: {
      sessionId: input.sessionId,
      task: input.task,
      domain: input.domain,
      sessionSucceeded: input.sessionSucceeded,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      costUsd: input.costUsd,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      toolCallCount: input.toolCallCount,
      turnDepth: input.turnDepth,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      ...(input.verificationPassed !== undefined ? { verificationPassed: input.verificationPassed } : {}),
      ...(input.contextGovernance ? { contextGovernance: input.contextGovernance } : {}),
      ...(input.contextUsage ? { contextUsage: input.contextUsage } : {}),
      ...(input.efficiencyEvidence
        ? { efficiencyEvidence: VerifiedEfficiencyEvidenceProjectionSchema.parse(input.efficiencyEvidence) }
        : {}),
    },
    diagnostics: {
      lastError: input.lastError,
      attempts: input.attempts,
      ...(input.verificationResult ? { verificationResult: input.verificationResult } : {}),
      ...(input.evalScore ? { evalScore: input.evalScore } : {}),
      ...(input.capabilityGap ? { capabilityGap: input.capabilityGap } : {}),
      ...(input.managedInvocationAuthorityNotes
        ? { managedInvocationAuthorityNotes: input.managedInvocationAuthorityNotes }
        : {}),
    },
    resources: {
      exactArtifacts: input.exactArtifacts,
    },
  };
}

function isRunOutputMode(value: string): value is RunOutputMode {
  return RUN_OUTPUT_MODES.includes(value as RunOutputMode);
}

function writeNonHumanTelemetry(line = ""): void {
  process.stderr.write(`${line}\n`);
}

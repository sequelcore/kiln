import type { FeedbackBundle } from "../feedback/index.js";
import { redactFeedbackText } from "../feedback/index.js";
import type { WorkItemUpsertInput } from "./work-item.js";

export const FEEDBACK_REPAIR_BUNDLE_EVIDENCE = "feedback-repair:bundle";
export const FEEDBACK_REPAIR_APPROVAL_EVIDENCE = "feedback-repair:approval";
export const FEEDBACK_REPAIR_RISK_HYPOTHESIS_EVIDENCE = "feedback-repair:risk-hypothesis";
export const FEEDBACK_REPAIR_FILE_IMPACT_EVIDENCE = "feedback-repair:file-impact";
export const FEEDBACK_REPAIR_VERIFICATION_CRITERIA_EVIDENCE = "feedback-repair:verification-criteria";

const FEEDBACK_REPAIR_EXPECTED_EVIDENCE = [
  FEEDBACK_REPAIR_BUNDLE_EVIDENCE,
  FEEDBACK_REPAIR_APPROVAL_EVIDENCE,
  FEEDBACK_REPAIR_RISK_HYPOTHESIS_EVIDENCE,
  FEEDBACK_REPAIR_FILE_IMPACT_EVIDENCE,
  FEEDBACK_REPAIR_VERIFICATION_CRITERIA_EVIDENCE,
  "tests",
  "typecheck",
  "managed-agent-review",
  "residual-risk",
] as const;

export interface FeedbackRepairApproval {
  readonly approved: true;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly resourceUris: readonly string[];
}

export interface FeedbackRepairWorkItemInput {
  readonly bundle: FeedbackBundle;
  readonly approval: FeedbackRepairApproval;
  readonly riskHypothesis: string;
  readonly fileImpact: readonly string[];
  readonly verificationCriteria: readonly string[];
  readonly id?: string;
  readonly workflowProfile?: string;
  readonly risk?: string;
  readonly assignedAgentProfile?: string;
  readonly routeId?: string;
  readonly authorityProfile?: string;
}

export function createFeedbackRepairWorkItemInput(input: FeedbackRepairWorkItemInput): WorkItemUpsertInput {
  if (input.bundle.status !== "local-draft") {
    throw new Error("Feedback repair work item requires a local draft bundle.");
  }
  if (input.approval.approved !== true) {
    throw new Error("Feedback repair work item requires explicit approval.");
  }

  const approvedBy = redactRequiredText(input.approval.approvedBy, "Feedback repair work item approval actor is required.");
  const approvedAt = requireCanonicalUtcTimestamp(
    input.approval.approvedAt,
    "Feedback repair work item approval timestamp is required.",
  );
  const approvalResourceUris = normalizeApprovalResourceUris(
    input.approval.resourceUris,
    input.bundle.feedbackId,
    "Feedback repair work item requires approval evidence.",
  );
  const riskHypothesis = redactRequiredText(input.riskHypothesis, "Feedback repair work item requires risk hypothesis.");
  const fileImpact = normalizeRequiredRedactedList(input.fileImpact, "Feedback repair work item requires file impact.");
  const verificationCriteria = normalizeRequiredRedactedList(
    input.verificationCriteria,
    "Feedback repair work item requires verification criteria.",
  );

  return {
    id: input.id ?? feedbackRepairWorkItemId(input.bundle.feedbackId),
    summary: feedbackRepairSummary(input.bundle),
    status: "pending",
    workflowProfile: input.workflowProfile ?? "feedback-repair",
    risk: input.risk ?? "medium",
    triggers: unique(["feedback-repair", "session-feedback", input.bundle.report.mode]),
    surface: "session-feedback",
    assignedAgentProfile: input.assignedAgentProfile ?? "coder",
    routeId: input.routeId,
    authorityProfile: input.authorityProfile ?? "audited",
    expectedEvidence: FEEDBACK_REPAIR_EXPECTED_EVIDENCE,
    providedEvidence: [
      FEEDBACK_REPAIR_BUNDLE_EVIDENCE,
      FEEDBACK_REPAIR_APPROVAL_EVIDENCE,
      FEEDBACK_REPAIR_RISK_HYPOTHESIS_EVIDENCE,
      FEEDBACK_REPAIR_FILE_IMPACT_EVIDENCE,
      FEEDBACK_REPAIR_VERIFICATION_CRITERIA_EVIDENCE,
    ],
    verificationGates: unique([...verificationCriteria, "managed-agent review"]),
    sourceFeedbackId: input.bundle.feedbackId,
    feedbackRepair: {
      feedbackId: input.bundle.feedbackId,
      sessionId: input.bundle.sessionId,
      createdAt: input.bundle.createdAt,
      bundleResourceUri: feedbackRepairResourceUri(input.bundle.feedbackId, "bundle"),
      approvedBy,
      approvedAt,
      approvalResourceUris,
      riskHypothesis,
      fileImpact,
      verificationCriteria,
    },
  };
}

function feedbackRepairWorkItemId(feedbackId: string): string {
  const normalized = encodeURIComponent(feedbackId.trim());
  if (!normalized) {
    throw new Error("Feedback repair work item feedback id is required.");
  }
  return `feedback:${normalized}:repair`;
}

function feedbackRepairResourceUri(feedbackId: string, evidenceKind: "approval" | "bundle"): string {
  return `kiln://feedback/${encodeURIComponent(feedbackId)}/${evidenceKind}`;
}

function feedbackRepairSummary(bundle: FeedbackBundle): string {
  const description = bundle.report.description.trim().replace(/\s+/g, " ");
  const summary = description.length > 96 ? `${description.slice(0, 93)}...` : description;
  return `Repair feedback ${bundle.feedbackId}: ${summary}`;
}

function redactRequiredText(value: string, message: string): string {
  const redacted = redactFeedbackText(value).text.trim();
  if (!redacted) {
    throw new Error(message);
  }
  return redacted;
}

function requireCanonicalUtcTimestamp(value: string, message: string): string {
  const timestamp = value.trim();
  const canonicalUtcIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const parsed = Date.parse(timestamp);
  if (!canonicalUtcIso.test(timestamp) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new Error(message);
  }
  return timestamp;
}

function normalizeApprovalResourceUris(
  values: readonly string[],
  feedbackId: string,
  emptyMessage: string,
): readonly string[] {
  const normalized = normalizeRequiredList(
    values.map((value) => value.normalize("NFKC")),
    emptyMessage,
  );
  const expected = feedbackRepairResourceUri(feedbackId, "approval");
  if (!normalized.every((uri) => uri === expected)) {
    throw new Error("Feedback repair work item approval evidence must be the local feedback resource URI.");
  }
  return normalized;
}

function normalizeRequiredRedactedList(values: readonly string[], message: string): readonly string[] {
  return normalizeRequiredList(values.map((value) => redactFeedbackText(value).text), message);
}

function normalizeRequiredList(values: readonly string[], message: string): readonly string[] {
  const normalized = unique(values.map((value) => value.trim()).filter((value) => value.length > 0));
  if (normalized.length === 0) {
    throw new Error(message);
  }
  return normalized;
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

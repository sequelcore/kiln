import { z } from "zod";
import {
  OPERATOR_SURFACE_KINDS,
} from "./operator-surface-capability.js";

export const SESSION_FEEDBACK_REPORTER_MODES = [
  "quick",
  "diagnostic",
  "maintainer",
] as const;

export const SESSION_FEEDBACK_EVIDENCE_KINDS = [
  "session-summary",
  "transcript-excerpt",
  "tool-failure",
  "command-output",
  "environment",
  "git-status",
  "log-excerpt",
  "file-change-summary",
  "diagnostic-finding",
] as const;

export const SESSION_FEEDBACK_PUBLICATION_REASONS = [
  "local-only-default",
  "requires-explicit-approval",
] as const;

const nonEmptyText = z.string().trim().min(1);
const canonicalIsoUtcTimestamp = z.string().refine(isCanonicalIsoUtcTimestamp, "must be a canonical ISO UTC timestamp");
const previewText = z.string().max(4_001);

export const SessionFeedbackReporterProjectionSchema = z.object({
  mode: z.enum(SESSION_FEEDBACK_REPORTER_MODES),
  description: nonEmptyText,
  expectedBehavior: nonEmptyText.optional(),
  actualBehavior: nonEmptyText,
}).strict();

export type SessionFeedbackReporterProjection = z.infer<typeof SessionFeedbackReporterProjectionSchema>;

export const SessionFeedbackEvidencePreviewSchema = z.object({
  kind: z.enum(SESSION_FEEDBACK_EVIDENCE_KINDS),
  title: nonEmptyText,
  selected: z.boolean(),
  redactionApplied: z.boolean(),
  preview: previewText.optional(),
  omittedReason: nonEmptyText.optional(),
}).strict();

export type SessionFeedbackEvidencePreview = z.infer<typeof SessionFeedbackEvidencePreviewSchema>;

export const SessionFeedbackLocalArtifactsSchema = z.object({
  bundlePath: nonEmptyText.optional(),
  issueDraftPath: nonEmptyText.optional(),
}).strict();

export type SessionFeedbackLocalArtifacts = z.infer<typeof SessionFeedbackLocalArtifactsSchema>;

export const SessionFeedbackPublicationProjectionSchema = z.object({
  status: z.literal("local-draft"),
  allowed: z.literal(false),
  reason: z.enum(SESSION_FEEDBACK_PUBLICATION_REASONS),
}).strict();

export type SessionFeedbackPublicationProjection = z.infer<typeof SessionFeedbackPublicationProjectionSchema>;

export const SessionFeedbackIssueDraftPreviewSchema = z.object({
  title: nonEmptyText,
  markdownPreview: previewText.optional(),
}).strict();

export type SessionFeedbackIssueDraftPreview = z.infer<typeof SessionFeedbackIssueDraftPreviewSchema>;

export const SessionFeedbackPreviewProjectionSchema = z.object({
  surface: z.enum(OPERATOR_SURFACE_KINDS),
  feedbackId: nonEmptyText,
  sessionId: nonEmptyText,
  createdAt: canonicalIsoUtcTimestamp,
  reporter: SessionFeedbackReporterProjectionSchema,
  evidence: z.array(SessionFeedbackEvidencePreviewSchema),
  localArtifacts: SessionFeedbackLocalArtifactsSchema.optional(),
  publication: SessionFeedbackPublicationProjectionSchema,
  issueDraft: SessionFeedbackIssueDraftPreviewSchema.optional(),
}).strict();

export type SessionFeedbackPreviewProjection = z.infer<typeof SessionFeedbackPreviewProjectionSchema>;

function isCanonicalIsoUtcTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

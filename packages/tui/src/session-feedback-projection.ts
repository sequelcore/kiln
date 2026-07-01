import {
  SessionFeedbackPreviewProjectionSchema,
  type SessionFeedbackPreviewProjection,
} from "@kilnai/gateway-contracts";

export function formatTuiSessionFeedbackPreview(input: unknown): readonly string[] {
  const preview = parseTuiSessionFeedbackPreview(input);
  const selectedEvidence = preview.evidence.filter((item) => item.selected);
  const redactedEvidence = preview.evidence.filter((item) => item.redactionApplied);

  return [
    `feedback ${preview.feedbackId} ${preview.publication.status} publication:disabled`,
    `report ${preview.reporter.mode}: ${preview.reporter.description}`,
    `evidence selected ${selectedEvidence.length}/${preview.evidence.length} redacted ${redactedEvidence.length}`,
  ];
}

export function parseTuiSessionFeedbackPreview(input: unknown): SessionFeedbackPreviewProjection {
  const preview = SessionFeedbackPreviewProjectionSchema.parse(input);
  if (preview.surface !== "tui") {
    throw new Error("TUI feedback projection requires surface 'tui'.");
  }
  return preview;
}

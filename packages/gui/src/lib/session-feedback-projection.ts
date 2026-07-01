import {
  SessionFeedbackPreviewProjectionSchema,
  type SessionFeedbackPreviewProjection,
} from "@kilnai/gateway-contracts";

export function parseGuiSessionFeedbackPreview(input: unknown): SessionFeedbackPreviewProjection {
  const preview = SessionFeedbackPreviewProjectionSchema.parse(input);
  if (preview.surface !== "gui") {
    throw new Error("GUI feedback projection requires surface 'gui'.");
  }
  return preview;
}

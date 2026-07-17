import {
  SessionFeedbackPreviewProjectionSchema,
  type SessionFeedbackPreviewProjection,
} from "@kilnai/gateway-contracts";

export interface NativeSessionFeedbackProjection {
  readonly kind: "session-feedback-preview";
  readonly preview: SessionFeedbackPreviewProjection;
}

export function createNativeSessionFeedbackProjection(input: unknown): NativeSessionFeedbackProjection {
  const preview = SessionFeedbackPreviewProjectionSchema.parse(input);
  if (preview.surface !== "native") {
    throw new Error("Native feedback projection requires surface 'native'.");
  }
  return {
    kind: "session-feedback-preview",
    preview,
  };
}

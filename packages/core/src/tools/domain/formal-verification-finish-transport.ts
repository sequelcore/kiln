import type { FormalVerificationObservation } from "../../verification/formal/observation.js";

/**
 * Internal Runtime authority transport for the registered work-item finish
 * tool. This is deliberately a symbol rather than a ToolInput/context string
 * field, and is not a model-input or evidence-construction API.
 */
export const FORMAL_VERIFICATION_FINISH_TRANSPORT: unique symbol = Symbol(
  "kiln.formal-verification-finish-transport",
);

export interface FormalVerificationFinishExecutionScope {
  readonly kind: "work_item";
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly managedInvocationId?: string;
}

export interface FormalVerificationFinishTransportObservation {
  readonly metadata: FormalVerificationObservation;
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
  readonly executionScope: FormalVerificationFinishExecutionScope;
}

export interface FormalVerificationFinishTransportProducer {
  readonly kind: "registered_tool";
  readonly toolName: "formal_verify";
}

export interface FormalVerificationFinishTransportEnvelope {
  readonly observations: readonly FormalVerificationFinishTransportObservation[];
  readonly executionScope: FormalVerificationFinishExecutionScope;
  readonly recordedAt: string;
  readonly producer: FormalVerificationFinishTransportProducer;
}

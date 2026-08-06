import { ManagedAgentRuntimeAdmissionError } from "./errors.js";

export class ManagedAgentLeaseAcquireError extends ManagedAgentRuntimeAdmissionError {
  constructor(
    message: string,
    readonly sideEffected: boolean,
  ) {
    super(message);
  }
}

export class ManagedAgentWorktreeReviewRequiredError extends ManagedAgentRuntimeAdmissionError {}

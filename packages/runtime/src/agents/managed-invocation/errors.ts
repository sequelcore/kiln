export class ManagedAgentRuntimeAdmissionError extends Error {
  readonly name = "ManagedAgentRuntimeAdmissionError";

  constructor(message: string) {
    super(message);
  }
}

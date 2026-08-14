import type {
  AgentTaskDiagnosticCode,
  AgentTaskExecutionFailureClassification,
  AgentTaskFailureEvidence,
} from "./contracts.js";
import { isCanonicalKilnDiagnosticUri } from "./validation-primitives.js";

export class AgentTaskApplicationError extends Error {
  constructor(
    readonly code: AgentTaskDiagnosticCode,
    readonly operatorAction: string,
    readonly failureEvidence?: AgentTaskFailureEvidence,
  ) {
    super(code);
    this.name = "AgentTaskApplicationError";
  }
}

export class AgentTaskExecutionFailure extends Error {
  readonly evidence: AgentTaskFailureEvidence;

  constructor(
    classification: AgentTaskExecutionFailureClassification,
    diagnosticUri?: string,
    message = classification,
  ) {
    super(message);
    this.name = "AgentTaskExecutionFailure";
    this.evidence = {
      version: 1,
      classification,
      ...(isCanonicalKilnDiagnosticUri(diagnosticUri) ? { diagnosticUri } : {}),
    };
  }
}

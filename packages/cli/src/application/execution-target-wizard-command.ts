import {
  ExecutionTargetWizardRequestSchema,
  type ExecutionTargetWizardRequest,
  type ExecutionTargetWizardResult,
} from "@kilnai/gateway-contracts";

/** Parses one guided target-wizard intent; raw JSON/file material is not an application input. */
export async function runExecutionTargetWizardCommand(input: {
  readonly request: unknown;
  readonly create: (request: ExecutionTargetWizardRequest) => Promise<ExecutionTargetWizardResult>;
}): Promise<ExecutionTargetWizardResult> {
  const request = ExecutionTargetWizardRequestSchema.parse(input.request);
  return input.create(request);
}

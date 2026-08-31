import {
  digestManagedEconomicValue,
  parseVisionAnalyzeInput,
  parseVisionAnalysis,
  type ManagedAgentCallerAttachmentIdentity,
  type VisionAnalyzeInput,
  type VisionAnalysis,
} from "@kilnai/core";
import {
  AgentTaskApplicationError,
  type AgentTaskApplicationService,
  type AgentTaskRecord,
  type AgentTaskResultQuery,
  type AgentTaskSubmission,
  type TrustedAgentTaskQueryContext,
} from "../agent-tasks/index.js";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import type { RuntimeBuiltinToolExecutionContext } from "../session/runtime-session-orchestrator.types.js";
import type {
  AgentBackedCapabilityExecutor,
  AgentBackedCapabilityExecutorInput,
  AgentBackedCapabilityExecutorResult,
} from "./agent-backed-execution.js";
import {
  VISION_ANALYZE_CAPABILITY_ID,
  VISION_ANALYZE_CONTRACT,
} from "@kilnai/core/capabilities";

const DEFAULT_OBJECTIVE = "Analyze the admitted image resources.";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

/** The existing Agent Task owner; this adapter never creates another store or service. */
export type AgentTaskCapabilityService = Pick<
  AgentTaskApplicationService,
  "dispatch" | "getResult" | "cancel"
>;

/**
 * Acceptance hook for a composition that must bind the exact parent authority
 * receipt before calling the existing service. The hook must durably accept
 * the job without enqueuing or dispatching it: this adapter invokes
 * AgentTaskApplicationService.dispatch exactly once for a newly queued job.
 * Dispatch, query, and cancellation otherwise remain owned by the service.
 */
export type AgentTaskVisionAnalysisAcceptance = (
  submission: AgentTaskSubmission,
  callerIdentity: ManagedAgentCallerAttachmentIdentity | undefined,
  authorityAdmission: EffectiveAuthorityAdmissionBundle,
) => Promise<AgentTaskRecord>;

/**
 * Composition binding for the existing Agent Task owner. The application
 * composition supplies acceptance; Runtime supplies dispatch/query/cancel to
 * the capability executor so no second lifecycle owner can be created.
 */
export interface AgentTaskVisionAnalysisCapabilityBinding {
  readonly agentTaskService: AgentTaskCapabilityService;
  readonly configuredAgentProfileId: string;
  readonly callerId: string;
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  readonly acceptAgentTask: AgentTaskVisionAnalysisAcceptance;
}

export interface AgentTaskVisionAnalysisCapabilityExecutorOptions extends AgentTaskVisionAnalysisCapabilityBinding {
  /** One already-materialized AgentTaskApplicationService. */
  readonly agentTaskService: AgentTaskCapabilityService;
  /** Exact profile selected by Runtime/CLI composition. */
  readonly configuredAgentProfileId: string;
  /** Trusted caller identity used for the accepted task and result query. */
  readonly callerId: string;
  /** Trusted parent attachment forwarded to the Agent Task dispatch port. */
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  /** Bounded static objective; typed capability data is never placed here. */
  readonly objective?: string;
  /**
   * Composition-owned acceptance path. It must bind the exact trusted parent
   * authority before delegating to AgentTaskApplicationService.accept, and
   * must not enqueue/dispatch because this adapter owns that step.
   */
  readonly acceptAgentTask: AgentTaskVisionAnalysisAcceptance;
}

/**
 * Runtime-local Agent Task adapter for the canonical vision.analyze/v1
 * capability.  The child result is treated as evidence until the Agent Task
 * service has durably projected and queried its validated typed output.
 */
export class AgentTaskVisionAnalysisCapabilityExecutor
  implements AgentBackedCapabilityExecutor<VisionAnalysis> {
  private readonly agentTaskService: AgentTaskCapabilityService;
  private readonly configuredAgentProfileId: string;
  private readonly callerId: string;
  private readonly callerIdentity: ManagedAgentCallerAttachmentIdentity | undefined;
  private readonly objective: string;
  private readonly acceptAgentTask: AgentTaskVisionAnalysisAcceptance;

  public constructor(options: AgentTaskVisionAnalysisCapabilityExecutorOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("Agent Task vision analysis requires an existing service.");
    }
    if (!options.agentTaskService || typeof options.agentTaskService !== "object"
      || typeof options.agentTaskService.dispatch !== "function"
      || typeof options.agentTaskService.getResult !== "function"
      || typeof options.agentTaskService.cancel !== "function") {
      throw new TypeError("Agent Task vision analysis requires the existing AgentTaskApplicationService lifecycle.");
    }
    this.agentTaskService = options.agentTaskService;
    this.configuredAgentProfileId = requireIdentifier(options.configuredAgentProfileId, "configuredAgentProfileId");
    this.callerId = requireIdentifier(options.callerId, "callerId");
    this.callerIdentity = options.callerIdentity;
    this.objective = requireObjective(options.objective ?? DEFAULT_OBJECTIVE);
    if (typeof options.acceptAgentTask !== "function") {
      throw new TypeError("Agent Task vision analysis acceptance must be callable.");
    }
    this.acceptAgentTask = options.acceptAgentTask;
  }

  public async execute(
    input: AgentBackedCapabilityExecutorInput,
  ): Promise<AgentBackedCapabilityExecutorResult<VisionAnalysis>> {
    let visionInput: VisionAnalyzeInput;
    try {
      visionInput = parseVisionAnalyzeInput(input.input);
    } catch {
      return failed("invalid_input");
    }

    if (!isVisionBinding(input)) return failed("invalid_input");
    const trustedContext = readTrustedRuntimeContext(input.trustedContext, input);
    if (trustedContext === undefined) return failed("missing_context");

    const signal = combineAbortSignals(input.signal, trustedContext.abortSignal);
    if (signal.aborted) return cancelled();

    const inputDigest = digestManagedEconomicValue(visionInput);
    const submission = createSubmission(input, visionInput, inputDigest, this.configuredAgentProfileId, this.callerId, this.objective);
    let job: AgentTaskRecord;
    try {
      job = await this.accept(submission, trustedContext);
    } catch (error) {
      return mapAcceptanceError(error);
    }

    if (!matchesAcceptedJob(job, submission, inputDigest)) {
      return failed("agent_execution_error");
    }

    const queryContext: TrustedAgentTaskQueryContext = {
      project: { id: job.projectId },
      callerId: job.callerId,
    };
    let cancellation: Promise<AgentTaskRecord | undefined> | undefined;
    const requestCancellation = (): void => {
      if (cancellation !== undefined) return;
      cancellation = Promise.resolve()
        .then(() => this.agentTaskService.cancel(queryContext, job.id))
        .catch(() => undefined);
    };
    const onAbort = (): void => { requestCancellation(); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal.aborted) {
        requestCancellation();
        return await settleCancellation(
          this.agentTaskService,
          queryContext,
          job,
          inputDigest,
          visionInput.resourceUris,
          cancellation,
        );
      }

      if (job.state === "awaiting_approval") return failed("unavailable");
      // A running record proves that some owner may already be executing it.
      // The acceptance hook is required to be non-enqueuing, so this adapter
      // cannot safely take ownership of that state or claim a queried result.
      if (job.state === "running") return unknownOutcome();
      if (job.state === "queued") {
        try {
          await this.agentTaskService.dispatch(
            job.id,
            this.callerIdentity === undefined ? undefined : { callerIdentity: this.callerIdentity },
          );
        } catch (error) {
          if (signal.aborted) {
            return await settleCancellation(
              this.agentTaskService,
              queryContext,
              job,
              inputDigest,
              visionInput.resourceUris,
              cancellation,
            );
          }
          return mapDispatchError(error);
        }
      }

      if (signal.aborted) {
        return await settleCancellation(
          this.agentTaskService,
          queryContext,
          job,
          inputDigest,
          visionInput.resourceUris,
          cancellation,
        );
      }

      let result: AgentTaskResultQuery;
      try {
        result = await this.agentTaskService.getResult(queryContext, job.id);
      } catch {
        // A failed result read cannot prove whether the child completed.
        return unknownOutcome();
      }
      if (signal.aborted) {
        return await settleCancellation(
          this.agentTaskService,
          queryContext,
          job,
          inputDigest,
          visionInput.resourceUris,
          cancellation,
          result,
        );
      }
      return projectResult(result, job, inputDigest, visionInput.resourceUris);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async accept(
    submission: AgentTaskSubmission,
    trustedContext: RuntimeBuiltinToolExecutionContext,
  ): Promise<AgentTaskRecord> {
    return await this.acceptAgentTask(
      submission,
      this.callerIdentity,
      trustedContext.authorityAdmission as EffectiveAuthorityAdmissionBundle,
    );
  }
}

export function createAgentTaskVisionAnalysisCapabilityExecutor(
  options: AgentTaskVisionAnalysisCapabilityExecutorOptions,
): AgentTaskVisionAnalysisCapabilityExecutor {
  return new AgentTaskVisionAnalysisCapabilityExecutor(options);
}

function createSubmission(
  input: AgentBackedCapabilityExecutorInput,
  visionInput: VisionAnalyzeInput,
  inputDigest: string,
  configuredAgentProfileId: string,
  callerId: string,
  objective: string,
): AgentTaskSubmission {
  const idempotencyKey = input.binding.idempotencyKey
    ?? `agent-task:${digestManagedEconomicValue({
      capabilityId: VISION_ANALYZE_CAPABILITY_ID,
      contract: VISION_ANALYZE_CONTRACT,
      generationId: input.binding.generationId,
      catalogDigest: input.binding.catalogDigest,
      descriptorDigest: input.binding.descriptorDigest,
      toolName: input.binding.toolName,
      implementationIdentityDigest: input.binding.implementationIdentityDigest,
      inputSchemaDigest: input.binding.inputSchemaDigest,
      outputSchemaDigest: input.binding.outputSchemaDigest,
      toolCallScopeId: input.binding.toolCallScopeId,
      toolCallId: input.binding.toolCallId,
      inputDigest,
    })}`;
  return {
    objective,
    configuredAgentProfileId,
    callerId,
    idempotencyKey,
    capability: {
      capabilityId: VISION_ANALYZE_CAPABILITY_ID,
      contract: VISION_ANALYZE_CONTRACT,
      input: visionInput,
      inputDigest,
    },
  };
}

function matchesAcceptedJob(
  job: AgentTaskRecord,
  submission: AgentTaskSubmission,
  inputDigest: string,
): boolean {
  if (!isRecord(job)) return false;
  const capability = job.capability;
  return typeof job.id === "string"
    && isAgentTaskState(job.state)
    && isLocalIdentifier(job.projectId)
    && job.callerId === submission.callerId
    && job.configuredAgentProfileId === submission.configuredAgentProfileId
    && capability !== undefined
    && capability.capabilityId === VISION_ANALYZE_CAPABILITY_ID
    && capability.contract === VISION_ANALYZE_CONTRACT
    && capability.inputDigest === inputDigest
    && sameVisionInput(capability.input, submission.capability?.input);
}

function sameVisionInput(left: unknown, right: unknown): boolean {
  try {
    return digestManagedEconomicValue(parseVisionAnalyzeInput(left))
      === digestManagedEconomicValue(parseVisionAnalyzeInput(right));
  } catch {
    return false;
  }
}

function projectResult(
  result: AgentTaskResultQuery,
  job: AgentTaskRecord,
  inputDigest: string,
  requestedResourceUris: readonly string[],
): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  if (!isRecord(result) || result.jobId !== job.id
    || result.configuredAgentProfileId !== job.configuredAgentProfileId) {
    return unknownOutcome();
  }

  if (result.availability === "pending") {
    return result.lifecycleState === "cancelled" ? cancelled() : unknownOutcome();
  }
  if (result.availability === "unresolved" || result.availability === "unavailable") {
    return unknownOutcome();
  }
  if (result.availability === "failed") return mapFailedQuery(result);
  if (result.lifecycleState !== "succeeded") return failed("invalid_output");

  const capability = result.capability;
  if (!capability
    || capability.capabilityId !== VISION_ANALYZE_CAPABILITY_ID
    || capability.contract !== VISION_ANALYZE_CONTRACT
    || capability.inputDigest !== inputDigest
    || !sameVisionInput(capability.input, job.capability?.input)) {
    return failed("invalid_output");
  }
  if (result.capabilityOutput === undefined) return failed("invalid_output");
  try {
    const output = parseVisionAnalysis(result.capabilityOutput);
    const requested = new Set(requestedResourceUris);
    if (output.evidenceUris.some((uri) => !requested.has(uri))) return failed("invalid_output");
    return { status: "completed", output };
  } catch {
    return failed("invalid_output");
  }
}

function mapFailedQuery(
  result: AgentTaskResultQuery,
): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  switch (result.diagnostic) {
    case "cancelled": return cancelled();
    case "provider_timeout": return timedOut();
    case "result_corrupt": return failed("invalid_output");
    case "result_pending":
    case "result_unavailable":
    case "result_persistence_failure":
      return unknownOutcome();
    default:
      return failed("agent_execution_error");
  }
}

async function settleCancellation(
  service: AgentTaskCapabilityService,
  context: TrustedAgentTaskQueryContext,
  job: AgentTaskRecord,
  inputDigest: string,
  requestedResourceUris: readonly string[],
  cancellation: Promise<AgentTaskRecord | undefined> | undefined,
  alreadyQueried?: AgentTaskResultQuery,
): Promise<AgentBackedCapabilityExecutorResult<VisionAnalysis>> {
  const cancelledJob = cancellation === undefined ? undefined : await cancellation;
  if (cancelledJob?.state === "cancelled") return cancelled();
  if (cancelledJob?.state === "timed_out") return timedOut();
  if (cancelledJob?.state === "interrupted") return unknownOutcome();
  if (cancelledJob?.state === "failed") return failed("agent_execution_error");
  if (alreadyQueried !== undefined && alreadyQueried.availability === "available") {
    // The enclosing AgentBackedCapabilityInvocationPort still owns the caller
    // cancellation settlement; this branch only reports a durable success to
    // direct adapter callers when cancellation raced a completed task.
    return projectResult(alreadyQueried, job, inputDigest, requestedResourceUris);
  }
  try {
    const result = await service.getResult(context, job.id);
    if (result.availability === "available") {
      return projectResult(result, job, inputDigest, requestedResourceUris);
    }
    if (result.availability === "failed") return mapFailedQuery(result);
  } catch {
    // Cancellation and result observation raced; no terminal state is proven.
  }
  return unknownOutcome();
}

function mapAcceptanceError(error: unknown): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  if (!(error instanceof AgentTaskApplicationError)) return failed("unavailable");
  switch (error.code) {
    case "invalid_request": return failed("invalid_input");
    case "idempotency_conflict": return failed("idempotency_conflict");
    case "cancelled": return cancelled();
    case "result_corrupt": return failed("invalid_output");
    case "governance_unavailable":
    case "governance_not_authoritative":
    case "admission_denied":
    case "profile_unavailable":
    case "route_unavailable":
    case "project_identity_unavailable":
    case "job_persistence_unavailable":
    case "account_lease_unavailable":
    case "economic_commitment_unavailable":
      return failed("unavailable");
    default:
      return failed("agent_execution_error");
  }
}

function mapDispatchError(error: unknown): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  if (!(error instanceof AgentTaskApplicationError)) return unknownOutcome();
  switch (error.code) {
    case "cancelled": return cancelled();
    case "provider_timeout": return timedOut();
    case "result_corrupt": return failed("invalid_output");
    case "result_pending":
    case "result_unavailable":
    case "result_persistence_failure":
      return unknownOutcome();
    case "idempotency_conflict": return failed("idempotency_conflict");
    case "invalid_request": return failed("invalid_input");
    case "profile_unavailable":
    case "route_unavailable":
    case "governance_unavailable":
    case "governance_not_authoritative":
    case "admission_denied":
    case "project_identity_unavailable":
    case "job_persistence_unavailable":
      return failed("unavailable");
    default: return failed("agent_execution_error");
  }
}

function readTrustedRuntimeContext(
  value: unknown,
  input: AgentBackedCapabilityExecutorInput,
): RuntimeBuiltinToolExecutionContext | undefined {
  const record = objectRecord(value);
  const session = objectRecord(record?.session);
  const toolCall = objectRecord(record?.toolCall);
  const authorityAdmission = objectRecord(record?.authorityAdmission);
  if (record === undefined
    || session === undefined
    || !isLocalIdentifier(session.id)
    || toolCall === undefined
    || !isLocalIdentifier(toolCall.id)
    || typeof toolCall.name !== "string"
    || toolCall.name.trim().length === 0
    || authorityAdmission === undefined
    || typeof authorityAdmission.admissionId !== "string"
    || authorityAdmission.admissionId.trim().length === 0) {
    return undefined;
  }
  if (input.binding.toolCallId !== undefined && input.binding.toolCallId !== toolCall.id) return undefined;
  if (input.binding.toolCallScopeId !== undefined
    && input.binding.toolCallScopeId !== record.toolCallScopeId) return undefined;
  if (input.binding.toolName !== undefined && input.binding.toolName !== toolCall.name) return undefined;
  return value as RuntimeBuiltinToolExecutionContext;
}

function isVisionBinding(input: AgentBackedCapabilityExecutorInput): boolean {
  return input.binding.capabilityId === VISION_ANALYZE_CAPABILITY_ID
    && input.binding.revision === "v1";
}

function combineAbortSignals(primary: AbortSignal, parent: AbortSignal | undefined): AbortSignal {
  if (parent === undefined || parent === primary) return primary;
  return AbortSignal.any([primary, parent]);
}

function failed(diagnosticCode: "invalid_input" | "invalid_output" | "missing_context" | "unavailable" | "idempotency_conflict" | "agent_execution_error"): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  return { status: "failed", diagnosticCode };
}

function cancelled(): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  return { status: "cancelled", diagnosticCode: "cancelled" };
}

function timedOut(): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  return { status: "timed_out", diagnosticCode: "timed_out" };
}

function unknownOutcome(): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  return { status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" };
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value) || value.trim() !== value) {
    throw new TypeError(`Agent Task vision analysis ${field} is invalid.`);
  }
  return value;
}

function isLocalIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value) && value.trim() === value;
}

function isAgentTaskState(value: unknown): value is AgentTaskRecord["state"] {
  return value === "awaiting_approval"
    || value === "queued"
    || value === "running"
    || value === "succeeded"
    || value === "failed"
    || value === "timed_out"
    || value === "interrupted"
    || value === "cancelled";
}

function requireObjective(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Agent Task vision analysis objective is invalid.");
  const objective = value.trim();
  if (objective.length === 0 || objective.length > 12_000) {
    throw new TypeError("Agent Task vision analysis objective is invalid.");
  }
  return objective;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return objectRecord(value) !== undefined;
}

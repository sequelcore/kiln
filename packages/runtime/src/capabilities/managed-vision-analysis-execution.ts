import {
  defineStructuredExecutionResult,
  parseVisionAnalyzeInput,
  parseVisionAnalysis,
  type ManagedAgentExternalRuntimeAttachmentIdentity,
  type ManagedAgentProviderRoute,
  type StructuredExecutionResult,
  type VisionAnalysis,
} from "@kilnai/core";
import type {
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
} from "../session/runtime-session-orchestrator.types.js";
import type {
  AgentBackedCapabilityExecutor,
  AgentBackedCapabilityExecutorInput,
  AgentBackedCapabilityExecutorResult,
} from "./agent-backed-execution.js";

/**
 * The already-attached managed invocation owner used by a vision materialization.
 * Runtime deliberately accepts the executor closure rather than an attachment:
 * attached surfaces keep the invocation owner private to that closure.
 */
export interface ManagedVisionAnalysisCapabilityExecutorOptions {
  readonly managedInvocationExecutor: RuntimeBuiltinToolExecutor;
  readonly agentProfile: string;
  readonly routeId: string;
  readonly providerRoute: Pick<ManagedAgentProviderRoute, "providerId" | "model">;
  /** Exact physical external-runtime target; omitted when the route is not attached. */
  readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
}

/** Runtime-owned managed child executor for the provider-neutral vision contract. */
export class ManagedVisionAnalysisCapabilityExecutor implements AgentBackedCapabilityExecutor<VisionAnalysis> {
  private readonly managedInvocationExecutor: RuntimeBuiltinToolExecutor;
  private readonly agentProfile: string;
  private readonly routeId: string;
  private readonly providerRoute: Pick<ManagedAgentProviderRoute, "providerId" | "model">;
  private readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;

  public constructor(options: ManagedVisionAnalysisCapabilityExecutorOptions) {
    if (!options || typeof options !== "object" || typeof options.managedInvocationExecutor !== "function") {
      throw new TypeError("Managed vision analysis requires the existing managed invocation executor.");
    }
    this.agentProfile = requireIdentifier(options.agentProfile, "agentProfile");
    this.routeId = requireIdentifier(options.routeId, "routeId");
    if (!options.providerRoute || typeof options.providerRoute !== "object") {
      throw new TypeError("Managed vision analysis requires a configured provider route.");
    }
    const providerId = requireIdentifier(options.providerRoute.providerId, "providerRoute.providerId");
    const model = options.providerRoute.model === undefined
      ? undefined
      : requireIdentifier(options.providerRoute.model, "providerRoute.model");
    this.managedInvocationExecutor = options.managedInvocationExecutor;
    this.providerRoute = Object.freeze({
      providerId,
      ...(model === undefined ? {} : { model }),
    });
    this.externalRuntimeAttachment = options.externalRuntimeAttachment === undefined
      ? undefined
      : requireExternalRuntimeAttachment(options.externalRuntimeAttachment);
  }

  public async execute(
    input: AgentBackedCapabilityExecutorInput,
  ): Promise<AgentBackedCapabilityExecutorResult<VisionAnalysis>> {
    let visionInput;
    try {
      visionInput = parseVisionAnalyzeInput(input.input);
    } catch {
      return { status: "failed", diagnosticCode: "invalid_input" };
    }

    let trustedContext: RuntimeBuiltinToolExecutionContext | undefined;
    try {
      trustedContext = readTrustedRuntimeContext(input.trustedContext);
    } catch {
      return { status: "failed", diagnosticCode: "missing_context" };
    }
    if (trustedContext === undefined) {
      return { status: "failed", diagnosticCode: "missing_context" };
    }
    if (input.signal.aborted || trustedContext.abortSignal?.aborted) {
      return { status: "cancelled", diagnosticCode: "cancelled" };
    }

    const request = buildManagedVisionRequest(
      visionInput,
      this.agentProfile,
      this.routeId,
      this.providerRoute,
      this.externalRuntimeAttachment,
    );
    const executionContext = buildManagedExecutionContext(trustedContext, input);

    let result: unknown;
    try {
      result = await this.managedInvocationExecutor(request, executionContext);
    } catch {
      // The canonical executor has been dispatched, but no terminal managed
      // envelope was observed. Keep that ambiguity distinct from a known
      // managed failure so the existing agent port settles it conservatively.
      return { status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" };
    }
    try {
      return mapManagedVisionResult(result, visionInput.resourceUris);
    } catch {
      // A malformed producer envelope must not escape the agent-backed port
      // and bypass its terminal settlement path.
      return { status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" };
    }
  }
}

export function createManagedVisionAnalysisCapabilityExecutor(
  options: ManagedVisionAnalysisCapabilityExecutorOptions,
): ManagedVisionAnalysisCapabilityExecutor {
  return new ManagedVisionAnalysisCapabilityExecutor(options);
}

function buildManagedVisionRequest(
  input: { readonly resourceUris: readonly string[]; readonly instruction: string },
  agentProfile: string,
  routeId: string,
  providerRoute: Pick<ManagedAgentProviderRoute, "providerId" | "model">,
  externalRuntimeAttachment: ManagedAgentExternalRuntimeAttachmentIdentity | undefined,
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    profile: "foundation-readonly-plan",
    routeId,
    providerRoute: Object.freeze({
      providerId: providerRoute.providerId,
      ...(providerRoute.model === undefined ? {} : { model: providerRoute.model }),
    }),
    ...(externalRuntimeAttachment === undefined
      ? {}
      : {
          // The managed tool's raw input contract carries the two opaque
          // identity fields; the canonical service adds kind when it defines
          // the persisted ManagedAgentInvocationRequest.
          externalRuntimeAttachment: Object.freeze({
            runtimeId: externalRuntimeAttachment.runtimeId,
            attachmentId: externalRuntimeAttachment.attachmentId,
          }),
        }),
    requestedAuthority: "read_only",
    task: input.instruction,
    summary: "Analyze only the admitted image resources and return a bounded vision handoff.",
    resourceUris: input.resourceUris,
    agentProfile,
    contextMode: "resources",
    roleIntent: "Analyze the admitted image resources without taking actions outside the read-only context.",
    expectedEvidence: Object.freeze(["A terminal structured vision analysis grounded only in the admitted resource URIs."]),
    requiredResultFields: Object.freeze(["summary", "evidence", "uncertainty", "limitations"]),
    doneCriteria: Object.freeze([
      "Use only the admitted resource URIs.",
      "Return a terminal structured result with summary, uncertainty, limitations, and evidence.",
    ]),
    outputVerbosity: "standard",
  };
  Object.freeze(request);
  return request;
}

function buildManagedExecutionContext(
  trustedContext: RuntimeBuiltinToolExecutionContext,
  input: AgentBackedCapabilityExecutorInput,
): RuntimeBuiltinToolExecutionContext {
  const parentEmitOutput = trustedContext.emitOutput;
  const abortSignal = combineAbortSignals(input.signal, trustedContext.abortSignal);
  return Object.freeze({
    ...trustedContext,
    // Preserve the exact process-local parent bundle; never reconstruct or
    // widen authority while creating the managed child request.
    authorityAdmission: trustedContext.authorityAdmission,
    abortSignal,
    emitOutput: (event: { readonly stream: "stdout" | "stderr"; readonly delta: string }): void => {
      try {
        parentEmitOutput?.(event);
      } catch {
        // A progress observer cannot change managed invocation settlement.
      }
      input.onOutput({ stream: event.stream, text: event.delta });
    },
  });
}

function combineAbortSignals(primary: AbortSignal, parent: AbortSignal | undefined): AbortSignal {
  if (parent === undefined || parent === primary) return primary;
  return AbortSignal.any([primary, parent]);
}

function mapManagedVisionResult(
  value: unknown,
  requestedResourceUris: readonly string[],
): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  const result = objectRecord(value);
  const metadata = objectRecord(result?.metadata);
  if (metadata === undefined || metadata.kind !== "managed-invocation") {
    return { status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" };
  }

  switch (metadata.status) {
    case "denied":
      return { status: "failed", diagnosticCode: "unavailable" };
    case "failed":
      return { status: "failed", diagnosticCode: "agent_execution_error" };
    case "cancelled":
      return { status: "cancelled", diagnosticCode: "cancelled" };
    case "timed_out":
      return { status: "timed_out", diagnosticCode: "timed_out" };
    case "handoff_not_substantive":
      return { status: "failed", diagnosticCode: "invalid_output" };
    case "completed":
      if (result?.isError === true) return { status: "failed", diagnosticCode: "invalid_output" };
      return mapCompletedManagedVisionResult(metadata.resultHandoff, requestedResourceUris);
    default:
      return { status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" };
  }
}

function mapCompletedManagedVisionResult(
  value: unknown,
  requestedResourceUris: readonly string[],
): AgentBackedCapabilityExecutorResult<VisionAnalysis> {
  const handoff = objectRecord(value);
  const structured = handoff?.structuredResult;
  if (!isStructuredExecutionResult(structured)) {
    return { status: "failed", diagnosticCode: "invalid_output" };
  }

  let canonical: StructuredExecutionResult;
  try {
    canonical = defineStructuredExecutionResult(structured);
  } catch {
    return { status: "failed", diagnosticCode: "invalid_output" };
  }
  if (canonical.status !== "completed" || canonical.uncertainty === undefined) {
    return { status: "failed", diagnosticCode: "invalid_output" };
  }

  const evidenceUris = unique([
    ...canonical.evidence.map((evidence) => evidence.uri),
    ...canonical.citations.map((citation) => citation.uri),
    ...canonical.verificationResults.flatMap((verification) => verification.evidenceUris),
  ]);
  const requested = new Set(requestedResourceUris);
  if (evidenceUris.some((uri) => !requested.has(uri))) {
    return { status: "failed", diagnosticCode: "invalid_output" };
  }

  try {
    return {
      status: "completed",
      output: parseVisionAnalysis({
        status: "completed",
        summary: canonical.summary,
        uncertainty: canonical.uncertainty,
        limitations: canonical.limitations,
        evidenceUris,
      }),
    };
  } catch {
    return { status: "failed", diagnosticCode: "invalid_output" };
  }
}

function isStructuredExecutionResult(value: unknown): value is StructuredExecutionResult {
  const record = objectRecord(value);
  return record !== undefined
    && record.version === "structured-execution-result-v1"
    && (record.status === "completed" || record.status === "blocked" || record.status === "failed" || record.status === "cancelled")
    && typeof record.summary === "string"
    && Array.isArray(record.limitations)
    && Array.isArray(record.operatorDecisions)
    && Array.isArray(record.evidence)
    && Array.isArray(record.citations)
    && Array.isArray(record.warnings)
    && Array.isArray(record.failures)
    && Array.isArray(record.approvalRequirements)
    && Array.isArray(record.residualRisks)
    && Array.isArray(record.verificationResults)
    && (record.uncertainty === undefined || typeof record.uncertainty === "number");
}

function readTrustedRuntimeContext(value: unknown): RuntimeBuiltinToolExecutionContext | undefined {
  const record = objectRecord(value);
  const session = objectRecord(record?.session);
  const toolCall = objectRecord(record?.toolCall);
  const authorityAdmission = objectRecord(record?.authorityAdmission);
  if (
    record === undefined
    || session === undefined
    || typeof session.id !== "string"
    || toolCall === undefined
    || typeof toolCall.id !== "string"
    || typeof toolCall.name !== "string"
    || authorityAdmission === undefined
    || typeof authorityAdmission.admissionId !== "string"
  ) {
    return undefined;
  }
  return value as RuntimeBuiltinToolExecutionContext;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`Managed vision analysis ${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function requireExternalRuntimeAttachment(
  value: ManagedAgentExternalRuntimeAttachmentIdentity,
): ManagedAgentExternalRuntimeAttachmentIdentity {
  if (
    value === null
    || typeof value !== "object"
    || value.kind !== "external-runtime"
    || typeof value.runtimeId !== "string"
    || value.runtimeId.trim().length === 0
    || typeof value.attachmentId !== "string"
    || value.attachmentId.trim().length === 0
  ) {
    throw new TypeError("Managed vision analysis external runtime attachment must contain exact non-empty identities.");
  }
  return Object.freeze({
    kind: "external-runtime",
    // These identities are opaque and must not be trimmed or otherwise
    // normalised before canonical managed admission compares them.
    runtimeId: value.runtimeId,
    attachmentId: value.attachmentId,
  });
}

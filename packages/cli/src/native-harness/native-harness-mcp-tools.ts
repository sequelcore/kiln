import type { ManagedJobRecord, ManagedJobReplayQuery, ManagedJobResultQuery } from "@kilnai/runtime";
import { type AccountUsageInspectionService, createAccountUsageInspectionService } from "../application/account-usage-inspection.js";
import type { OperatorProjectManagedJobApplicationPort } from "../application/operator-project-managed-jobs.js";
import type { HarnessIntegrationId } from "../config/harness-integration-capabilities.js";
import { createNativeHarnessInspectionService, type NativeHarnessInspectionService } from "../application/native-harness-inspection.js";

const INSPECTION_TOOL_NAMES = ["kiln_status_inspect", "kiln_work_governance_inspect", "kiln_capability_inspect", "kiln_account_usage_inspect"] as const;
const MANAGED_JOB_TOOL_NAMES = ["kiln_managed_agent_invoke", "kiln_managed_agent_status", "kiln_managed_agent_result", "kiln_managed_agent_cancel", "kiln_managed_agent_replay"] as const;
const TOOL_NAMES = [...INSPECTION_TOOL_NAMES, ...MANAGED_JOB_TOOL_NAMES] as const;

export type NativeHarnessMcpToolName = (typeof TOOL_NAMES)[number];

export interface NativeHarnessMcpToolDefinition {
  readonly name: NativeHarnessMcpToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly annotations: Record<string, boolean>;
}

/** Stable native-harness catalog shared by the global bridge and operator runtime. */
export function nativeHarnessMcpToolCatalog(): readonly NativeHarnessMcpToolDefinition[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: descriptionFor(name),
    inputSchema: inputSchemaFor(name),
    outputSchema: { type: "object" },
    annotations: annotationsFor(name),
  }));
}

/** The canonical application boundary. The MCP adapter must not reimplement it. */
export type ManagedJobApplicationPort = OperatorProjectManagedJobApplicationPort;
type NativeHarnessId = HarnessIntegrationId;

/** Trusted harness identity, supplied by composition rather than MCP arguments. */
export interface NativeHarnessMcpRequestIdentity {
  readonly callerId: string;
  readonly requestId?: string;
  readonly parent?: { readonly invocationId: string; readonly turnId: string };
}

export interface NativeHarnessMcpCallResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent: unknown;
  readonly isError?: true;
}

export interface NativeHarnessMcpToolsOptions {
  readonly harness: NativeHarnessId;
  readonly inspection?: NativeHarnessInspectionService;
  readonly managedJobs?: ManagedJobApplicationPort;
  readonly requestIdentity?: () => NativeHarnessMcpRequestIdentity;
  readonly accountUsage?: AccountUsageInspectionService;
}

export class NativeHarnessMcpTools {
  private readonly harness: NativeHarnessId;
  private readonly inspection: NativeHarnessInspectionService;
  private managedJobs: ManagedJobApplicationPort | undefined;
  private readonly requestIdentity: () => NativeHarnessMcpRequestIdentity;
  private requestSequence = 0;
  private readonly accountUsage: AccountUsageInspectionService;

  constructor(options: NativeHarnessMcpToolsOptions) {
    this.harness = options.harness;
    this.inspection = options.inspection ?? createNativeHarnessInspectionService({ harness: options.harness });
    this.managedJobs = options.managedJobs;
    this.requestIdentity = options.requestIdentity ?? (() => ({ callerId: `${options.harness}-native-harness` }));
    this.accountUsage = options.accountUsage ?? createAccountUsageInspectionService();
  }

  listTools(): readonly NativeHarnessMcpToolDefinition[] {
    return nativeHarnessMcpToolCatalog();
  }

  async callTool(name: string, args: unknown): Promise<NativeHarnessMcpCallResult> {
    const identity = this.trustedIdentity();
    const requestId = identity.requestId ?? `${this.harness}-control-plane-mcp-${++this.requestSequence}`;
    if (MANAGED_JOB_TOOL_NAMES.includes(name as (typeof MANAGED_JOB_TOOL_NAMES)[number])) {
      return this.callManagedJobTool(name as (typeof MANAGED_JOB_TOOL_NAMES)[number], args, identity, requestId);
    }
    if (!isEmptyObject(args)) {
      return this.error("KILN_TOOL_INVALID_REQUEST", "This read-only Kiln inspection tool does not accept arguments.", "Remove request arguments and retry.", requestId);
    }
    if (!INSPECTION_TOOL_NAMES.includes(name as (typeof INSPECTION_TOOL_NAMES)[number])) {
      if (isMutationOperation(name)) {
        return this.error("KILN_TOOL_READ_ONLY", "Managed-agent invocation and configuration mutation are not admitted on this tool surface.", "Use an approved Kiln operator surface for a separately admitted mutation or invocation.", requestId);
      }
      return this.error("KILN_TOOL_UNSUPPORTED", "This Kiln native-harness operation is unsupported.", "Use one of the discovered read-only Kiln inspection tools.", requestId);
    }
    const result = name === "kiln_account_usage_inspect" ? await this.accountUsage.inspect() : name === "kiln_status_inspect" ? await this.inspection.inspectStatus() : name === "kiln_work_governance_inspect" ? await this.inspection.inspectWorkGovernance() : await this.inspection.inspectCapability();
    return this.success(result, requestId);
  }

  private success(value: unknown, requestId: string): NativeHarnessMcpCallResult {
    const result = value as { evidence: Record<string, unknown> };
    const structuredContent = { ...result, evidence: { ...result.evidence, requestId } };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }

  private error(code: string, message: string, operatorAction: string, requestId: string): NativeHarnessMcpCallResult {
    const value = { error: { code, message, operatorAction }, evidence: { requestId, harness: this.harness } };
    return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: true };
  }

  private trustedIdentity(): NativeHarnessMcpRequestIdentity {
    try {
      const identity = this.requestIdentity();
      if (!isIdentifier(identity.callerId)) throw new Error("invalid trusted identity");
      return identity;
    } catch {
      return { callerId: `${this.harness}-native-harness-unresolved` };
    }
  }

  private async callManagedJobTool(name: (typeof MANAGED_JOB_TOOL_NAMES)[number], args: unknown, identity: NativeHarnessMcpRequestIdentity, requestId: string): Promise<NativeHarnessMcpCallResult> {
    if (!this.managedJobs) return this.error("KILN_MANAGED_JOBS_UNAVAILABLE", "The managed-job application owner is unavailable.", "Restart the native harness after the managed-job application boundary is configured.", requestId);
    try {
      if (name === "kiln_managed_agent_invoke") {
        const job = await this.managedJobs.submit(this.invokeRequest(args, identity));
        return this.managedJobSuccess(name, job, identity, requestId);
      }
      const jobId = this.statusRequest(args);
      if (name === "kiln_managed_agent_status") {
        const job = await this.managedJobs.getStatus({ callerId: identity.callerId }, jobId);
        return this.managedJobSuccess(name, job, identity, requestId);
      }
      if (name === "kiln_managed_agent_cancel") {
        const job = await this.managedJobs.cancel({ callerId: identity.callerId }, jobId);
        return this.managedJobSuccess(name, job, identity, requestId);
      }
      if (name === "kiln_managed_agent_replay") {
        const replay = await this.managedJobs.getReplay({ callerId: identity.callerId }, jobId);
        return this.managedJobReplaySuccess(replay, identity, requestId);
      }
      const result = await this.managedJobs.getResult({ callerId: identity.callerId }, jobId);
      return this.managedJobResultSuccess(result, identity, requestId);
    } catch (error) {
      const code = applicationCode(error);
      return this.error(code, "The managed-job application request was not accepted.", operatorActionFor(code), requestId);
    }
  }

  private invokeRequest(args: unknown, identity: NativeHarnessMcpRequestIdentity): Record<string, unknown> {
    if (!isRecord(args) || !hasOnly(args, ["objective", "configuredAgentProfileId", "idempotencyKey"]) || typeof args.objective !== "string" || typeof args.configuredAgentProfileId !== "string" || typeof args.idempotencyKey !== "string") throw applicationInputError();
    const objective = args.objective.trim();
    const configuredAgentProfileId = args.configuredAgentProfileId.trim();
    const idempotencyKey = args.idempotencyKey.trim();
    if (objective.length === 0 || objective.length > 12000 || !isIdentifier(configuredAgentProfileId) || !isIdentifier(idempotencyKey)) throw applicationInputError();
    return {
      objective,
      configuredAgentProfileId,
      idempotencyKey,
      callerId: identity.callerId,
      ...(identity.parent ? { parent: identity.parent } : {}),
    };
  }

  private statusRequest(args: unknown): string {
    if (!isRecord(args) || !hasOnly(args, ["jobId"]) || typeof args.jobId !== "string" || !isIdentifier(args.jobId.trim())) throw applicationInputError();
    return args.jobId.trim();
  }

  private managedJobSuccess(name: (typeof MANAGED_JOB_TOOL_NAMES)[number], job: ManagedJobRecord, identity: NativeHarnessMcpRequestIdentity, requestId: string): NativeHarnessMcpCallResult {
    const structuredContent = {
      operation: name === "kiln_managed_agent_invoke" ? "managed-agent-invoke" : name === "kiln_managed_agent_cancel" ? "managed-agent-cancel" : "managed-agent-status",
      job: {
        id: job.id,
        state: job.state,
        configuredAgentProfileId: job.configuredAgentProfileId,
        admissionProfileId: job.admissionProfileId,
        economicPolicyId: job.economicPolicyId,
        economicPolicyRevision: job.economicPolicyRevision,
        constraints: job.constraints,
        ...(job.result ? { routeId: job.result.routeId } : {}),
        governanceSource: job.governanceSource,
        createdAt: job.createdAt,
        observedAt: job.updatedAt,
        ...(job.diagnostic ? { diagnostic: { code: job.diagnostic, operatorAction: operatorActionFor(job.diagnostic) } } : {}),
      },
      evidence: {
        harness: this.harness,
        adapter: "global-operator-runtime-mcp",
        callerId: identity.callerId,
        requestId,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }

  private managedJobResultSuccess(result: ManagedJobResultQuery, identity: NativeHarnessMcpRequestIdentity, requestId: string): NativeHarnessMcpCallResult {
    const structuredContent = {
      operation: "managed-agent-result",
      result: {
        jobId: result.jobId,
        availability: result.availability,
        lifecycleState: result.lifecycleState,
        configuredAgentProfileId: result.configuredAgentProfileId,
        admissionProfileId: result.admissionProfileId,
        routeId: result.routeId,
        providerId: result.providerId,
        ...(result.completedAt ? { completedAt: result.completedAt } : {}),
        ...(result.provenance ? { provenance: result.provenance } : {}),
        ...(result.handoff ? { handoff: result.handoff } : {}),
        ...(result.diagnostic ? { diagnostic: { code: result.diagnostic, operatorAction: operatorActionFor(result.diagnostic) } } : {}),
      },
      evidence: {
        harness: this.harness,
        adapter: "global-operator-runtime-mcp",
        callerId: identity.callerId,
        requestId,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }

  private managedJobReplaySuccess(replay: ManagedJobReplayQuery, identity: NativeHarnessMcpRequestIdentity, requestId: string): NativeHarnessMcpCallResult {
    const structuredContent = {
      operation: "managed-agent-replay",
      replay: {
        jobId: replay.jobId,
        availability: replay.availability,
        lifecycleState: replay.lifecycleState,
        configuredAgentProfileId: replay.configuredAgentProfileId,
        admissionProfileId: replay.admissionProfileId,
        routeId: replay.routeId,
        providerId: replay.providerId,
        lifecycle: replay.lifecycle,
        resultAvailability: replay.resultAvailability,
        ...(replay.diagnostic ? { diagnostic: { code: replay.diagnostic, operatorAction: operatorActionFor(replay.diagnostic) } } : {}),
      },
      evidence: {
        harness: this.harness,
        adapter: "global-operator-runtime-mcp",
        callerId: identity.callerId,
        requestId,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }
}

export { createNativeHarnessInspectionService };

function emptyObjectSchema(): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: false };
}

function descriptionFor(name: NativeHarnessMcpToolName): string {
  if (name === "kiln_status_inspect") return "Read curated canonical Kiln status and setup diagnostics. Read-only; never exposes secrets or paths.";
  if (name === "kiln_work_governance_inspect") return "Read the resolved Kiln work-governance policy. Read-only; cannot start or update work.";
  if (name === "kiln_capability_inspect") return "Read native harness capability availability from canonical Kiln status. Read-only; cannot invoke managed agents.";
  if (name === "kiln_account_usage_inspect") return "Read sanitized account usage and eligible virtual routes. Read-only; cannot select credentials or mutate routing policy.";
  if (name === "kiln_managed_agent_invoke") return "Submit bounded managed work through the canonical Kiln managed-job application boundary.";
  if (name === "kiln_managed_agent_status") return "Read canonical lifecycle status for one managed-job identifier.";
  if (name === "kiln_managed_agent_result") return "Read the bounded canonical Runtime result handoff for one authorized managed-job identifier.";
  if (name === "kiln_managed_agent_cancel") return "Cancel one authorized active managed job through its Runtime owner.";
  return "Replay canonical lifecycle evidence for one authorized managed-job identifier.";
}

function inputSchemaFor(name: NativeHarnessMcpToolName): Record<string, unknown> {
  if (INSPECTION_TOOL_NAMES.includes(name as (typeof INSPECTION_TOOL_NAMES)[number])) return emptyObjectSchema();
  if (name === "kiln_managed_agent_invoke") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["objective", "configuredAgentProfileId", "idempotencyKey"],
      properties: {
        objective: { type: "string", minLength: 1, maxLength: 12000 },
        configuredAgentProfileId: { type: "string", minLength: 1, maxLength: 200 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 200 },
      },
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["jobId"],
    properties: { jobId: { type: "string", minLength: 1, maxLength: 200 } },
  };
}

function annotationsFor(name: NativeHarnessMcpToolName): Record<string, boolean> {
  if (name === "kiln_managed_agent_invoke" || name === "kiln_managed_agent_cancel") return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
}
function applicationInputError(): Error & { code: "invalid_request" } {
  return Object.assign(new Error("invalid request"), { code: "invalid_request" as const });
}
function applicationCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" && /^[a-z_]{3,80}$/u.test(error.code) ? error.code : "internal_adapter_failure";
}
function operatorActionFor(code: string): string {
  const actions: Record<string, string> = {
    invalid_request: "Provide only valid bounded managed-job fields.",
    project_identity_unavailable: "Restore the trusted project composition boundary.",
    unknown_job: "Verify the managed-job identifier.",
    idempotency_conflict: "Use a new idempotency key for different managed work.",
    "identity-revision-conflict": "Restore the exact admitted policy, candidate, snapshot, and rate-card revisions for this attempt.",
    governance_unavailable: "Restore authoritative Kiln governance evidence.",
    governance_not_authoritative: "Refresh authoritative Kiln governance evidence.",
    admission_denied: "Review the authoritative work-governance policy.",
    profile_unavailable: "Choose a configured admitted agent.",
    route_unavailable: "Restore the configured policy candidate set and current eligibility evidence.",
    job_persistence_unavailable: "Restore the managed-job store and retry safely.",
    job_persistence_corrupt: "Repair the managed-job store before retrying.",
    economic_commitment_unavailable: "Wait until the configured economic commitment authority is available.",
    provider_rejected: "Review the Runtime managed-agent admission diagnostic.",
    provider_timeout: "Review the configured managed-agent timeout.",
    invocation_failed: "Inspect the Runtime managed-agent diagnostic before retrying.",
    internal_adapter_failure: "Retry safely or inspect Kiln status.",
  };
  return actions[code] ?? "Retry safely or inspect Kiln status.";
}

function isMutationOperation(name: string): boolean {
  return /(?:managed[_ .-]?agent|invoke|config|setup|sync|work[_ .-]?item|goal|mutation|apply)/iu.test(name);
}

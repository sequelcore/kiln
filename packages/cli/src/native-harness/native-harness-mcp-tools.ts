import type { AgentTaskRecord, AgentTaskReplayQuery, AgentTaskResultQuery } from "@kilnai/runtime";
import {
  AgentTaskCapabilitySubmissionSchema,
  KilnSettingsApplyRequestSchema,
  KilnSettingsProposalRequestSchema,
} from "@kilnai/gateway-contracts";
import { type AccountUsageInspectionService, createAccountUsageInspectionService } from "../application/account-usage-inspection.js";
import type { ConfigSettingsApplicationPort } from "../application/config-settings-application.js";
import type { OperatorProjectAgentTaskApplicationPort } from "../application/operator-project-agent-tasks.js";
import type { HarnessIntegrationId } from "../config/harness-integration-capabilities.js";
import { createNativeHarnessInspectionService, type NativeHarnessInspectionService } from "../application/native-harness-inspection.js";

const INSPECTION_TOOL_NAMES = ["kiln_status_inspect", "kiln_work_governance_inspect", "kiln_capability_inspect", "kiln_account_usage_inspect"] as const;
const SETTINGS_TOOL_NAMES = ["kiln_settings_read", "kiln_settings_propose", "kiln_settings_apply"] as const;
const AGENT_TASK_TOOL_NAMES = ["kiln_agent_task_submit", "kiln_agent_task_status", "kiln_agent_task_result", "kiln_agent_task_cancel", "kiln_agent_task_replay"] as const;
const TOOL_NAMES = [...INSPECTION_TOOL_NAMES, ...SETTINGS_TOOL_NAMES, ...AGENT_TASK_TOOL_NAMES] as const;

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
export type AgentTaskApplicationPort = OperatorProjectAgentTaskApplicationPort;
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
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly inspection?: NativeHarnessInspectionService;
  readonly agentTasks?: AgentTaskApplicationPort;
  readonly requestIdentity?: () => NativeHarnessMcpRequestIdentity;
  readonly accountUsage?: AccountUsageInspectionService;
  readonly settings?: Pick<ConfigSettingsApplicationPort, "read" | "propose" | "apply">;
}

export class NativeHarnessMcpTools {
  private readonly harness: NativeHarnessId;
  private readonly inspection: NativeHarnessInspectionService;
  private agentTasks: AgentTaskApplicationPort | undefined;
  private readonly requestIdentity: (() => NativeHarnessMcpRequestIdentity) | undefined;
  private requestSequence = 0;
  private readonly accountUsage: AccountUsageInspectionService;
  private readonly settings: Pick<ConfigSettingsApplicationPort, "read" | "propose" | "apply"> | undefined;

  constructor(options: NativeHarnessMcpToolsOptions) {
    this.harness = options.harness;
    this.inspection = options.inspection ?? createNativeHarnessInspectionService({ harness: options.harness });
    this.agentTasks = options.agentTasks;
    this.requestIdentity = options.requestIdentity;
    this.accountUsage = options.accountUsage ?? createAccountUsageInspectionService(undefined, options.kilnHome);
    this.settings = options.settings;
  }

  listTools(): readonly NativeHarnessMcpToolDefinition[] {
    return nativeHarnessMcpToolCatalog();
  }

  async callTool(name: string, args: unknown): Promise<NativeHarnessMcpCallResult> {
    const identity = this.trustedIdentity();
    const requestId = identity?.requestId ?? `${this.harness}-control-plane-mcp-${++this.requestSequence}`;
    if (AGENT_TASK_TOOL_NAMES.includes(name as (typeof AGENT_TASK_TOOL_NAMES)[number])) {
      if (!identity) {
        return this.error("KILN_AGENT_TASK_IDENTITY_UNAVAILABLE", "The trusted native-harness session identity is unavailable.", "Reopen the authenticated native-harness session before using AgentTask operations.", requestId);
      }
      return this.callAgentTaskTool(name as (typeof AGENT_TASK_TOOL_NAMES)[number], args, identity, requestId);
    }
    if (SETTINGS_TOOL_NAMES.includes(name as (typeof SETTINGS_TOOL_NAMES)[number])) {
      if (!identity) {
        return this.error("KILN_SETTINGS_IDENTITY_UNAVAILABLE", "The trusted native-harness session identity is unavailable.", "Reopen the authenticated native-harness session before using settings operations.", requestId);
      }
      return this.callSettingsTool(name as (typeof SETTINGS_TOOL_NAMES)[number], args, identity, requestId);
    }
    if (!isEmptyObject(args)) {
      return this.error("KILN_TOOL_INVALID_REQUEST", "This read-only Kiln inspection tool does not accept arguments.", "Remove request arguments and retry.", requestId);
    }
    if (!INSPECTION_TOOL_NAMES.includes(name as (typeof INSPECTION_TOOL_NAMES)[number])) {
      if (isMutationOperation(name)) {
        return this.error("KILN_TOOL_READ_ONLY", "Agent-task submission and configuration mutation are not admitted on this tool surface.", "Use an approved Kiln operator surface for a separately admitted mutation or invocation.", requestId);
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

  private trustedIdentity(): NativeHarnessMcpRequestIdentity | undefined {
    if (!this.requestIdentity) return undefined;
    try {
      const identity = this.requestIdentity();
      if (!isIdentifier(identity.callerId)) throw new Error("invalid trusted identity");
      return identity;
    } catch {
      return undefined;
    }
  }

  private async callSettingsTool(
    name: (typeof SETTINGS_TOOL_NAMES)[number],
    args: unknown,
    identity: NativeHarnessMcpRequestIdentity,
    requestId: string,
  ): Promise<NativeHarnessMcpCallResult> {
    if (!this.settings) {
      return this.error("KILN_SETTINGS_UNAVAILABLE", "The canonical settings application boundary is unavailable.", "Restart the native harness after the Kiln operator Runtime is ready.", requestId);
    }
    try {
      if (name === "kiln_settings_read") {
        if (!isRecord(args) || !hasOnly(args, ["query", "modified"])
          || (args.query !== undefined && typeof args.query !== "string")
          || (args.modified !== undefined && typeof args.modified !== "boolean")) {
          return this.error("KILN_SETTINGS_INVALID_REQUEST", "The settings read request is invalid.", "Provide only an optional query and modified flag.", requestId);
        }
        const result = await this.settings.read({
          ...(typeof args.query === "string" ? { query: args.query } : {}),
          ...(typeof args.modified === "boolean" ? { modified: args.modified } : {}),
        });
        return this.settingsSuccess("settings-read", result, identity, requestId);
      }
      if (name === "kiln_settings_propose") {
        const request = KilnSettingsProposalRequestSchema.parse(args);
        return this.settingsSuccess("settings-propose", this.settings.propose(request), identity, requestId);
      }
      const request = KilnSettingsApplyRequestSchema.parse(args);
      if (!request.approvalId) {
        return this.error("KILN_SETTINGS_APPROVAL_REQUIRED", "Native-harness settings apply requires an exact operator approval.", "Approve the proposal from a trusted operator surface and retry with its approvalId.", requestId);
      }
      return this.settingsSuccess("settings-apply", await this.settings.apply(request, "model"), identity, requestId);
    } catch {
      return this.error("KILN_SETTINGS_INVALID_REQUEST", "The settings request was not admitted.", "Refresh canonical settings and retry with the exact typed request.", requestId);
    }
  }

  private settingsSuccess(
    operation: "settings-read" | "settings-propose" | "settings-apply",
    result: unknown,
    identity: NativeHarnessMcpRequestIdentity,
    requestId: string,
  ): NativeHarnessMcpCallResult {
    const structuredContent = {
      operation,
      result,
      evidence: {
        harness: this.harness,
        adapter: "global-operator-runtime-mcp",
        callerId: identity.callerId,
        requestId,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }

  private async callAgentTaskTool(name: (typeof AGENT_TASK_TOOL_NAMES)[number], args: unknown, identity: NativeHarnessMcpRequestIdentity, requestId: string): Promise<NativeHarnessMcpCallResult> {
    if (!this.agentTasks) return this.error("KILN_AGENT_TASKS_UNAVAILABLE", "The agent-task application owner is unavailable.", "Restart the native harness after the agent-task application boundary is configured.", requestId);
    try {
      if (name === "kiln_agent_task_submit") {
        const job = await this.agentTasks.accept(this.invokeRequest(args, identity), {
          kind: "external-harness",
          harness: this.harness,
          attachmentId: `native-harness:${this.harness}:${identity.callerId}`,
          evidenceId: requestId,
        });
        return this.agentTaskSuccess(name, job, identity, requestId);
      }
      const jobId = this.statusRequest(args);
      if (name === "kiln_agent_task_status") {
        const job = await this.agentTasks.getStatus({ callerId: identity.callerId }, jobId);
        return this.agentTaskSuccess(name, job, identity, requestId);
      }
      if (name === "kiln_agent_task_cancel") {
        const job = await this.agentTasks.cancel({ callerId: identity.callerId }, jobId);
        return this.agentTaskSuccess(name, job, identity, requestId);
      }
      if (name === "kiln_agent_task_replay") {
        const replay = await this.agentTasks.getReplay({ callerId: identity.callerId }, jobId);
        return this.agentTaskReplaySuccess(replay, identity, requestId);
      }
      const result = await this.agentTasks.getResult({ callerId: identity.callerId }, jobId);
      return this.agentTaskResultSuccess(result, identity, requestId);
    } catch (error) {
      const code = applicationCode(error);
      return this.error(code, "The agent-task application request was not accepted.", operatorActionFor(code), requestId);
    }
  }

  private invokeRequest(args: unknown, identity: NativeHarnessMcpRequestIdentity): Record<string, unknown> {
    if (!isRecord(args) || !hasOnly(args, ["objective", "configuredAgentProfileId", "idempotencyKey", "capability"]) || typeof args.objective !== "string" || typeof args.configuredAgentProfileId !== "string" || typeof args.idempotencyKey !== "string") throw applicationInputError();
    const objective = args.objective.trim();
    const configuredAgentProfileId = args.configuredAgentProfileId.trim();
    const idempotencyKey = args.idempotencyKey.trim();
    if (objective.length === 0 || objective.length > 12000 || !isIdentifier(configuredAgentProfileId) || !isIdentifier(idempotencyKey)) throw applicationInputError();
    const capability = args.capability === undefined ? undefined : AgentTaskCapabilitySubmissionSchema.safeParse(args.capability);
    if (capability !== undefined && !capability.success) throw applicationInputError();
    return {
      objective,
      configuredAgentProfileId,
      idempotencyKey,
      ...(capability ? { capability: capability.data } : {}),
      callerId: identity.callerId,
      ...(identity.parent ? { parent: identity.parent } : {}),
    };
  }

  private statusRequest(args: unknown): string {
    if (!isRecord(args) || !hasOnly(args, ["jobId"]) || typeof args.jobId !== "string" || !isIdentifier(args.jobId.trim())) throw applicationInputError();
    return args.jobId.trim();
  }

  private agentTaskSuccess(name: (typeof AGENT_TASK_TOOL_NAMES)[number], job: AgentTaskRecord, identity: NativeHarnessMcpRequestIdentity, requestId: string): NativeHarnessMcpCallResult {
    const dispatch = job.dispatch.kind === "economic"
      ? {
          kind: "economic" as const,
          economicPolicyId: job.dispatch.economicPolicyId,
          economicPolicyRevision: job.dispatch.economicPolicyRevision,
          constraints: job.dispatch.constraints,
        }
      : {
          kind: "native-harness" as const,
          routeId: job.dispatch.routeId,
          routeRevision: job.dispatch.routeRevision,
          providerId: job.dispatch.providerId,
          model: job.dispatch.model,
          dispatchFenceId: job.dispatch.dispatchFenceId,
    };
    const structuredContent = {
      operation: name === "kiln_agent_task_submit" ? "agent-task-submit" : name === "kiln_agent_task_cancel" ? "agent-task-cancel" : "agent-task-status",
      ...(name === "kiln_agent_task_submit"
        ? { accepted: true, completionChannel: "status-result-replay" as const }
        : {}),
      job: {
        id: job.id,
        state: job.state,
        configuredAgentProfileId: job.configuredAgentProfileId,
        access: job.access,
        ...(job.capability ? { capability: job.capability } : {}),
        dispatch,
        ...(job.result ? { routeId: job.result.routeId } : {}),
        ...(job.result?.dataPolicyProof ? { dataPolicyProof: structuredClone(job.result.dataPolicyProof) } : {}),
        governanceSource: job.governanceSource,
        createdAt: job.createdAt,
        observedAt: job.updatedAt,
        ...(job.diagnostic ? { diagnostic: { code: job.diagnostic, operatorAction: operatorActionFor(job.diagnostic) } } : {}),
        ...(job.failureEvidence ? { failureEvidence: job.failureEvidence } : {}),
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

  private agentTaskResultSuccess(result: AgentTaskResultQuery, identity: NativeHarnessMcpRequestIdentity, requestId: string): NativeHarnessMcpCallResult {
    const structuredContent = {
      operation: "agent-task-result",
      result: {
        jobId: result.jobId,
        availability: result.availability,
        lifecycleState: result.lifecycleState,
        configuredAgentProfileId: result.configuredAgentProfileId,
        access: result.access,
        ...(result.capability ? { capability: result.capability } : {}),
        routeId: result.routeId,
        providerId: result.providerId,
        ...(result.completedAt ? { completedAt: result.completedAt } : {}),
        ...(result.provenance ? { provenance: result.provenance } : {}),
        ...(result.handoff ? { handoff: result.handoff } : {}),
        ...(result.capabilityOutput ? { capabilityOutput: result.capabilityOutput } : {}),
        ...(result.dataPolicyProof ? { dataPolicyProof: structuredClone(result.dataPolicyProof) } : {}),
        ...(result.diagnostic ? { diagnostic: { code: result.diagnostic, operatorAction: operatorActionFor(result.diagnostic) } } : {}),
        ...(result.failureEvidence ? { failureEvidence: result.failureEvidence } : {}),
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

  private agentTaskReplaySuccess(replay: AgentTaskReplayQuery, identity: NativeHarnessMcpRequestIdentity, requestId: string): NativeHarnessMcpCallResult {
    const structuredContent = {
      operation: "agent-task-replay",
      replay: {
        jobId: replay.jobId,
        availability: replay.availability,
        lifecycleState: replay.lifecycleState,
        configuredAgentProfileId: replay.configuredAgentProfileId,
        access: replay.access,
        ...(replay.capability ? { capability: replay.capability } : {}),
        routeId: replay.routeId,
        providerId: replay.providerId,
        lifecycle: replay.lifecycle,
        resultAvailability: replay.resultAvailability,
        ...(replay.capabilityOutput ? { capabilityOutput: replay.capabilityOutput } : {}),
        dispatch: replay.dispatch,
        ...(replay.dataPolicyProof ? { dataPolicyProof: structuredClone(replay.dataPolicyProof) } : {}),
        ...(replay.diagnostic ? { diagnostic: { code: replay.diagnostic, operatorAction: operatorActionFor(replay.diagnostic) } } : {}),
        ...(replay.failureEvidence ? { failureEvidence: replay.failureEvidence } : {}),
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
  if (name === "kiln_settings_read") return "Read the canonical secret-free Kiln settings snapshot with scope, source, activation, and revision evidence.";
  if (name === "kiln_settings_propose") return "Propose one typed canonical Kiln setting change without applying it.";
  if (name === "kiln_settings_apply") return "Apply one settings proposal using an exact operator approval id; model authority alone can never commit it.";
  if (name === "kiln_agent_task_submit") return "Submit bounded managed work through the canonical Kiln agent-task application boundary.";
  if (name === "kiln_agent_task_status") return "Read canonical lifecycle status for one agent-task identifier.";
  if (name === "kiln_agent_task_result") return "Read the bounded canonical Runtime result handoff for one authorized agent-task identifier.";
  if (name === "kiln_agent_task_cancel") return "Cancel one authorized active agent-task through its Runtime owner.";
  return "Replay canonical lifecycle evidence for one authorized agent-task identifier.";
}

function inputSchemaFor(name: NativeHarnessMcpToolName): Record<string, unknown> {
  if (INSPECTION_TOOL_NAMES.includes(name as (typeof INSPECTION_TOOL_NAMES)[number])) return emptyObjectSchema();
  if (name === "kiln_settings_read") {
    return {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" }, modified: { type: "boolean" } },
    };
  }
  if (name === "kiln_settings_propose") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["operation", "scope", "key", "expectedRevision"],
      properties: {
        operation: { enum: ["setting.set", "setting.reset"] },
        scope: { enum: ["project", "global"] },
        key: { type: "string", minLength: 1 },
        expectedRevision: { type: "string", minLength: 1 },
        value: {},
      },
    };
  }
  if (name === "kiln_settings_apply") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["proposalId", "approvalId"],
      properties: {
        proposalId: { type: "string", minLength: 1 },
        approvalId: { type: "string", minLength: 1 },
      },
    };
  }
  if (name === "kiln_agent_task_submit") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["objective", "configuredAgentProfileId", "idempotencyKey"],
      properties: {
        objective: { type: "string", minLength: 1, maxLength: 12000 },
        configuredAgentProfileId: { type: "string", minLength: 1, maxLength: 200 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 200 },
        capability: {
          type: "object",
          additionalProperties: false,
          required: ["capabilityId", "contract", "input"],
          properties: {
            capabilityId: { const: "vision.analyze" },
            contract: { const: "vision.analyze/v1" },
            input: {
              type: "object",
              additionalProperties: false,
              required: ["resourceUris", "instruction"],
              properties: {
                resourceUris: {
                  type: "array",
                  minItems: 1,
                  maxItems: 16,
                  uniqueItems: true,
                  items: {
                    type: "string",
                    minLength: 1,
                    maxLength: 512,
                    pattern: "^kiln://[A-Za-z0-9][A-Za-z0-9.-]*(?:/[A-Za-z0-9][A-Za-z0-9:._%~-]*)+$",
                  },
                },
                instruction: { type: "string", minLength: 1, maxLength: 4096 },
              },
            },
            inputDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          },
        },
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
  if (name === "kiln_agent_task_submit" || name === "kiln_agent_task_cancel" || name === "kiln_settings_propose" || name === "kiln_settings_apply") return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
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
    invalid_request: "Provide only valid bounded agent-task fields.",
    project_identity_unavailable: "Restore the trusted project composition boundary.",
    unknown_job: "Verify the agent-task identifier.",
    idempotency_conflict: "Use a new idempotency key for different managed work.",
    "identity-revision-conflict": "Restore the exact admitted policy, candidate, snapshot, and rate-card revisions for this attempt.",
    governance_unavailable: "Restore authoritative Kiln governance evidence.",
    governance_not_authoritative: "Refresh authoritative Kiln governance evidence.",
    admission_denied: "Review the authoritative work-governance policy.",
    profile_unavailable: "Choose a configured admitted agent.",
    route_unavailable: "Restore the configured policy candidate set and current eligibility evidence.",
    job_persistence_unavailable: "Restore the agent-task store and retry safely.",
    job_persistence_corrupt: "Repair the agent-task store before retrying.",
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

// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// All parse*/read* primitives, work-classification/authority parsing, id/handoff builders.
import {
  defineDeliberationLevelId,
  defineWorkClassification,
} from "@kilnai/core";
import type {
  DeliberationIntent,
  ManagedAgentAdmissionProfile,
  ManagedAgentAuthorityApproval,
  ManagedAgentInvocationContextMode,
  ManagedAgentInvocationContextSelection,
  ManagedAgentInvocationHandoffContract,
  ManagedAgentRequestedAuthority,
  ManagedAgentResultField,
  WorkClassification,
  WorkClassificationInput,
} from "@kilnai/core";
import type { RuntimeBuiltinToolExecutionContext } from "../../../session/runtime-session-orchestrator.types.js";
import { MANAGED_AGENT_INVOKE_TOOL_NAME } from "../tool-names.js";
import type {
  ManagedInvocationContextResolution,
  ManagedInvocationToolInput,
  ManagedInvocationToolOptions,
  ManagedInvocationToolResult,
  ManagedInvocationToolRoute,
} from "./types.js";
import { unique } from "./catalog-descriptions.js";

function parseManagedDeliberationIntent(value: unknown, toolName: string): DeliberationIntent {
  const input = readRecord(value);
  if (!input) throw new Error(`${toolName} providerRoute.deliberationIntent must be an object.`);
  const mode = readText(input.mode);
  const onUnsupported = readText(input.onUnsupported);
  if (onUnsupported !== "deny" && onUnsupported !== "omit" && onUnsupported !== "allow-clamp") {
    throw new Error(`${toolName} providerRoute.deliberationIntent.onUnsupported is invalid.`);
  }
  if (mode === "provider-default") {
    assertManagedDeliberationKeys(input, ["mode", "onUnsupported"], toolName);
    return { mode, onUnsupported };
  }
  const boundsRecord = input.bounds === undefined ? undefined : readRecord(input.bounds);
  if (input.bounds !== undefined && !boundsRecord) {
    throw new Error(`${toolName} providerRoute.deliberationIntent.bounds must be an object.`);
  }
  if (boundsRecord) assertManagedDeliberationKeys(boundsRecord, ["min", "max"], toolName);
  const min = boundsRecord ? readText(boundsRecord.min) : undefined;
  const max = boundsRecord ? readText(boundsRecord.max) : undefined;
  const bounds = boundsRecord
    ? {
        ...(min ? { min: defineDeliberationLevelId(min) } : {}),
        ...(max ? { max: defineDeliberationLevelId(max) } : {}),
      }
    : undefined;
  if (mode === "fixed") {
    assertManagedDeliberationKeys(input, ["mode", "preferredLevel", "bounds", "onUnsupported"], toolName);
    const preferredLevel = readText(input.preferredLevel);
    if (!preferredLevel) throw new Error(`${toolName} fixed deliberation requires preferredLevel.`);
    return {
      mode,
      preferredLevel: defineDeliberationLevelId(preferredLevel),
      ...(bounds ? { bounds } : {}),
      onUnsupported,
    };
  }
  if (mode === "adaptive") {
    assertManagedDeliberationKeys(input, ["mode", "target", "bounds", "onUnsupported"], toolName);
    const target = readText(input.target);
    if (target !== "latency-first" && target !== "balanced" && target !== "quality-first") {
      throw new Error(`${toolName} adaptive deliberation target is invalid.`);
    }
    return { mode, target, ...(bounds ? { bounds } : {}), onUnsupported };
  }
  throw new Error(`${toolName} providerRoute.deliberationIntent.mode is invalid.`);
}

function assertManagedDeliberationKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  toolName: string,
): void {
  const admitted = new Set(allowed);
  const unknown = Object.keys(input).find((key) => !admitted.has(key));
  if (unknown) throw new Error(`${toolName} providerRoute.deliberationIntent has unknown field '${unknown}'.`);
}

export function parseInput(
  input: Record<string, unknown>,
  toolName = MANAGED_AGENT_INVOKE_TOOL_NAME,
): { readonly ok: true; readonly input: ManagedInvocationToolInput } | { readonly ok: false; readonly error: string } {
  const profile = input.profile === undefined ? "foundation-readonly-plan" : input.profile;
  if (
    profile !== "foundation-readonly-plan"
    && profile !== "foundation-propose-writes"
    && profile !== "foundation-apply-approved-writes"
    && profile !== "foundation-memory-write-proposals"
  ) {
    return { ok: false, error: `${toolName} profile is not supported.` };
  }
  const providerRoute = readRecord(input.providerRoute);
  const providerId = readText(providerRoute?.providerId) ?? "";
  const task = readText(input.task);
  if (!task) {
    return { ok: false, error: `${toolName} requires task.` };
  }
  const resourceUris = Array.isArray(input.resourceUris)
    ? input.resourceUris.map(readText).filter((uri): uri is string => uri !== undefined)
    : undefined;
  const skills = Array.isArray(input.skills)
    ? unique(input.skills.map(readText).filter((skill): skill is string => skill !== undefined))
    : undefined;
  const expectedEvidence = readTextArray(input.expectedEvidence);
  const requiredToolNames = readTextArray(input.requiredToolNames);
  const requiredReadPaths = readTextArray(input.requiredReadPaths);
  const requiredResultFields = parseManagedResultFields(input.requiredResultFields);
  if (!requiredResultFields.ok) {
    return { ok: false, error: `${toolName} ${requiredResultFields.error}` };
  }
  const doneCriteria = readTextArray(input.doneCriteria);
  const outputVerbosity = parseAssistantOutputVerbosity(input.outputVerbosity);
  if (input.outputVerbosity !== undefined && !outputVerbosity) {
    return { ok: false, error: `${toolName} outputVerbosity is not supported.` };
  }
  const forbiddenInputFields = readTextArray(input.forbiddenInputFields);
  const workClassification = parseWorkClassification(input.workClassification, toolName);
  if (!workClassification.ok) {
    return { ok: false, error: workClassification.error };
  }
  const requestedAuthority = parseManagedInvocationRequestedAuthority(input.requestedAuthority);
  if (!requestedAuthority.ok) {
    return { ok: false, error: `${toolName} requestedAuthority is not supported.` };
  }
  const contextMode = parseContextMode(input.contextMode);
  if (!contextMode) {
    return { ok: false, error: `${toolName} contextMode is not supported.` };
  }
  if (contextMode === "resources" && (!resourceUris || resourceUris.length === 0)) {
    return { ok: false, error: `${toolName} contextMode resources requires at least one resourceUris entry. Use contextMode isolated when no governed resources are supplied.` };
  }
  const goalRunId = readText(input.goalRunId);
  const workItemId = readText(input.workItemId);
  const attemptId = readText(input.attemptId);
  if ((workItemId || attemptId) && !goalRunId) {
    return { ok: false, error: `${toolName} goalRunId is required when workItemId or attemptId is supplied.` };
  }
  if (attemptId && !workItemId) {
    return { ok: false, error: `${toolName} workItemId is required when attemptId is supplied.` };
  }
  const externalRuntimeAttachment = parseExternalRuntimeAttachment(input.externalRuntimeAttachment, toolName);
  if (!externalRuntimeAttachment.ok) {
    return { ok: false, error: externalRuntimeAttachment.error };
  }
  return {
    ok: true,
    input: {
      profile,
      routeId: readText(input.routeId),
      providerRoute: {
        providerId,
        surface: "configured",
        ...(readText(providerRoute?.model) ? { model: readText(providerRoute?.model) } : {}),
        ...(providerRoute?.deliberationIntent !== undefined
          ? { deliberationIntent: parseManagedDeliberationIntent(providerRoute.deliberationIntent, toolName) }
          : {}),
      },
      ...(externalRuntimeAttachment.value ? { externalRuntimeAttachment: externalRuntimeAttachment.value } : {}),
      ...(requestedAuthority.value ? { requestedAuthority: requestedAuthority.value } : {}),
      task,
      summary: readText(input.summary) ?? task,
      ...(resourceUris && resourceUris.length > 0 ? { resourceUris } : {}),
      ...(readText(input.agentProfile) ? { agentProfile: readText(input.agentProfile) } : {}),
      ...(forbiddenInputFields && forbiddenInputFields.length > 0 ? { forbiddenInputFields } : {}),
      ...(skills && skills.length > 0 ? { skills } : {}),
      ...(workClassification.value ? { workClassification: workClassification.value } : {}),
      contextMode,
      ...(goalRunId ? { goalRunId } : {}),
      ...(workItemId ? { workItemId } : {}),
      ...(attemptId ? { attemptId } : {}),
      ...(readText(input.roleIntent) ? { roleIntent: readText(input.roleIntent) } : {}),
      ...(expectedEvidence && expectedEvidence.length > 0 ? { expectedEvidence } : {}),
      ...(requiredToolNames && requiredToolNames.length > 0 ? { requiredToolNames } : {}),
      ...(requiredReadPaths && requiredReadPaths.length > 0 ? { requiredReadPaths } : {}),
      ...(requiredResultFields.value && requiredResultFields.value.length > 0
        ? { requiredResultFields: requiredResultFields.value }
        : {}),
      ...(doneCriteria && doneCriteria.length > 0 ? { doneCriteria } : {}),
      ...(typeof input.residualRiskRequired === "boolean" ? { residualRiskRequired: input.residualRiskRequired } : {}),
      ...(outputVerbosity ? { outputVerbosity } : {}),
      ...(readRecord(input.executionPhase) ? { executionPhase: readRecord(input.executionPhase)! } : {}),
    },
  };
}

export async function resolveInvocationContext(
  input: ManagedInvocationToolInput,
  options: ManagedInvocationToolOptions,
  route: ManagedInvocationToolRoute | undefined,
): Promise<
  | { readonly ok: true; readonly resolution: ManagedInvocationContextResolution }
  | {
    readonly ok: false;
    readonly error: string;
    readonly status: "denied" | "failed";
    readonly resolution?: ManagedInvocationContextResolution;
  }
> {
  const needsResolver = Boolean(options.contextResolver || input.agentProfile || input.skills?.length || input.workClassification || input.contextMode === "fork");
  if (!needsResolver) {
    return { ok: true, resolution: {} };
  }
  if (!options.contextResolver) {
    return {
      ok: false,
      error: "Managed invocation context resolver is not configured for requested agentProfile, skills, workClassification, or fork context.",
      status: "failed",
    };
  }
  try {
    const resolution = await options.contextResolver({
      agentProfile: input.agentProfile,
      skills: input.skills ?? [],
      contextMode: input.contextMode,
      task: input.task,
      providerRoute: {
        providerId: route?.providerId ?? input.providerRoute.providerId,
        ...(input.providerRoute.model ?? route?.model ? { model: input.providerRoute.model ?? route?.model } : {}),
      },
      ...(route?.taskSuitability ? { taskSuitability: route.taskSuitability } : {}),
      ...(input.workClassification ? { workClassification: input.workClassification } : {}),
    });
    if (resolution.deniedSkills && resolution.deniedSkills.length > 0) {
      return {
        ok: false,
        error: `Managed invocation denied skill(s): ${resolution.deniedSkills.join(", ")}`,
        status: "denied",
        resolution,
      };
    }
    return { ok: true, resolution };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      status: "failed",
    };
  }
}

export function buildManagedInvocationContextMetadata(
  input: ManagedInvocationToolInput,
  resolution: ManagedInvocationContextResolution | undefined,
): ManagedAgentInvocationContextSelection {
  return {
    mode: input.contextMode,
    ...(input.agentProfile ? { agentProfile: input.agentProfile } : {}),
    ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
    ...(input.workClassification ? { workClassification: input.workClassification } : {}),
    ...(resolution?.admittedAgentProfile ? { admittedAgentProfile: resolution.admittedAgentProfile } : {}),
    ...(resolution?.admittedSkills ? { admittedSkills: resolution.admittedSkills } : {}),
    ...(resolution?.admittedInstructionProfiles ? { admittedInstructionProfiles: resolution.admittedInstructionProfiles } : {}),
    ...(resolution?.deniedSkills ? { deniedSkills: resolution.deniedSkills } : {}),
    ...(resolution?.workClassification ? { resolvedWorkClassification: resolution.workClassification } : {}),
    ...(resolution?.workRecommendedSkills ? { workRecommendedSkills: resolution.workRecommendedSkills } : {}),
    ...(resolution?.workRecommendedSkillDiagnostics ? { workRecommendedSkillDiagnostics: resolution.workRecommendedSkillDiagnostics } : {}),
  };
}

export function parseContextMode(input: unknown): ManagedAgentInvocationContextMode | undefined {
  if (input === undefined) {
    return "isolated";
  }
  if (input === "isolated" || input === "resources" || input === "fork") {
    return input;
  }
  return undefined;
}

export function parseWorkClassification(
  input: unknown,
  toolName: string,
): { readonly ok: true; readonly value?: WorkClassification } | { readonly ok: false; readonly error: string } {
  if (input === undefined) {
    return { ok: true };
  }
  const record = readRecord(input);
  if (!record) {
    return { ok: false, error: `${toolName} workClassification must be an object.` };
  }
  const supportedFields = new Set(["intents", "artifacts", "domains", "effects", "modes"]);
  const unsupportedField = Object.keys(record).find((field) => !supportedFields.has(field));
  if (unsupportedField) {
    return { ok: false, error: `${toolName} Unsupported work classification field: ${unsupportedField}.` };
  }
  const intents = parseWorkClassificationFacet(record, "intents", toolName);
  if (!intents.ok) return intents;
  const artifacts = parseWorkClassificationFacet(record, "artifacts", toolName);
  if (!artifacts.ok) return artifacts;
  const domains = parseWorkClassificationFacet(record, "domains", toolName);
  if (!domains.ok) return domains;
  const effects = parseWorkClassificationFacet(record, "effects", toolName);
  if (!effects.ok) return effects;
  const modes = parseWorkClassificationFacet(record, "modes", toolName);
  if (!modes.ok) return modes;
  const classificationInput: WorkClassificationInput = {
    ...(intents.value ? { intents: intents.value } : {}),
    ...(artifacts.value ? { artifacts: artifacts.value } : {}),
    ...(domains.value ? { domains: domains.value } : {}),
    ...(effects.value ? { effects: effects.value } : {}),
    ...(modes.value ? { modes: modes.value } : {}),
  };
  try {
    const value = defineWorkClassification(classificationInput);
    return Object.keys(value).length > 0 ? { ok: true, value } : { ok: true };
  } catch (error) {
    return { ok: false, error: `${toolName} ${error instanceof Error ? error.message : String(error)}.` };
  }
}

function parseWorkClassificationFacet(
  record: Record<string, unknown>,
  field: "intents" | "artifacts" | "domains" | "effects" | "modes",
  toolName: string,
): { readonly ok: true; readonly value?: readonly string[] } | { readonly ok: false; readonly error: string } {
  if (!(field in record)) {
    return { ok: true };
  }
  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { ok: false, error: `${toolName} workClassification.${field} must be an array of strings.` };
  }
  return { ok: true, value };
}

export function parseManagedInvocationRequestedAuthority(
  input: unknown,
): { readonly ok: true; readonly value?: ManagedAgentRequestedAuthority } | { readonly ok: false } {
  if (input === undefined) {
    return { ok: true };
  }
  if (input === "auto" || input === "read_only" || input === "audited" || input === "destructive") {
    return { ok: true, value: input };
  }
  return { ok: false };
}

export function resolveManagedInvocationRequestedAuthority(
  input?: ManagedAgentRequestedAuthority,
  parentRequestedAuthority?: "planning" | "auto" | "read_only" | "audited" | "destructive",
): ManagedAgentRequestedAuthority {
  const requested = input ?? "auto";
  const inherited = normalizeParentRequestedAuthority(parentRequestedAuthority);
  if (!inherited || inherited === "auto") {
    return requested;
  }
  if (requested === "auto") {
    return inherited;
  }
  return managedAuthorityRank(requested) <= managedAuthorityRank(inherited)
    ? requested
    : inherited;
}

function normalizeParentRequestedAuthority(
  parentRequestedAuthority?: "planning" | "auto" | "read_only" | "audited" | "destructive",
): ManagedAgentRequestedAuthority | undefined {
  if (parentRequestedAuthority === "planning") {
    return "read_only";
  }
  return parentRequestedAuthority;
}

function managedAuthorityRank(authority: ManagedAgentRequestedAuthority): number {
  switch (authority) {
    case "read_only":
      return 1;
    case "audited":
      return 2;
    case "auto":
      return 3;
    case "destructive":
      return 4;
  }
}

export function validateManagedInvocationRequestedAuthority(
  requestedAuthority: ManagedAgentRequestedAuthority,
  profile: ManagedAgentAdmissionProfile,
  toolName = MANAGED_AGENT_INVOKE_TOOL_NAME,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (requestedAuthority === "read_only" && profile !== "foundation-readonly-plan") {
    return {
      ok: false,
      error: `${toolName} read_only requested authority cannot select managed profile '${profile}'.`,
    };
  }
  if (
    profile === "foundation-readonly-plan"
    && (requestedAuthority === "audited" || requestedAuthority === "destructive")
  ) {
    return {
      ok: false,
      error: `${toolName} ${requestedAuthority} requested authority cannot select read-only managed profile '${profile}'.`,
    };
  }
  return { ok: true };
}

export async function requestManagedInvocationAuthorityApproval(input: {
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly target:
    | { readonly kind: "route"; readonly routeId: string }
    | { readonly kind: "economic-policy"; readonly economicPolicyId: string };
  readonly profile: ManagedAgentAdmissionProfile;
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly toolName?: string;
}): Promise<
  | { readonly ok: true; readonly authorityApproval?: ManagedAgentAuthorityApproval }
  | { readonly ok: false; readonly error: string }
> {
  const toolName = input.toolName ?? MANAGED_AGENT_INVOKE_TOOL_NAME;
  if (input.requestedAuthority !== "destructive") {
    return { ok: true };
  }
  if (!input.context.requestApproval) {
    return {
      ok: false,
      error: `${toolName} destructive requested authority requires an approval flow before child invocation.`,
    };
  }

  const authorityTarget = input.target.kind === "route"
    ? `route '${input.target.routeId}'`
    : `economic policy '${input.target.economicPolicyId}'`;
  const description = `${toolName} requests destructive authority for ${authorityTarget} and profile '${input.profile}'.`;
  const approval = await input.context.requestApproval(description);
  if (!approval.approved) {
    return {
      ok: false,
      error: `${toolName} destructive requested authority denied: ${approval.reason ?? "approval denied"}`,
    };
  }
  return {
    ok: true,
    authorityApproval: {
      approved: true,
      ...(approval.reason ? { reason: approval.reason } : {}),
    },
  };
}

export function buildHandoffContract(input: ManagedInvocationToolInput): ManagedAgentInvocationHandoffContract | undefined {
  const contract: ManagedAgentInvocationHandoffContract = {
    ...(input.workItemId ? { workItemId: input.workItemId } : {}),
    ...(input.roleIntent ? { roleIntent: input.roleIntent } : {}),
    ...(input.expectedEvidence && input.expectedEvidence.length > 0 ? { expectedEvidence: input.expectedEvidence } : {}),
    ...(input.requiredResultFields && input.requiredResultFields.length > 0 ? { requiredResultFields: input.requiredResultFields } : {}),
    ...(input.doneCriteria && input.doneCriteria.length > 0 ? { doneCriteria: input.doneCriteria } : {}),
    ...(input.residualRiskRequired !== undefined ? { residualRiskRequired: input.residualRiskRequired } : {}),
    ...(input.outputVerbosity !== undefined ? { outputVerbosity: input.outputVerbosity } : {}),
  };
  return Object.keys(contract).length > 0 ? contract : undefined;
}

export function errorResult(
  output: string,
  metadata: Record<string, unknown> = {},
  toolName = MANAGED_AGENT_INVOKE_TOOL_NAME,
): ManagedInvocationToolResult {
  return {
    output,
    isError: true,
    metadata: {
      toolName,
      kind: "managed-invocation",
      status: "failed",
      ...metadata,
    },
  };
}

const EXTERNAL_RUNTIME_ATTACHMENT_FIELDS = new Set(["runtimeId", "attachmentId"]);

// Roadmap 01 Slice 3.1 (F2) - JSON Schema additionalProperties: false only
// constrains the model's tool call, never the runtime. Unknown or malformed
// keys inside externalRuntimeAttachment must be rejected explicitly here,
// never silently stripped - a stripped/misspelled field would otherwise let
// a required-attachment check see absence and fail open through a typo.
export function parseExternalRuntimeAttachment(
  value: unknown,
  toolName: string,
): { readonly ok: true; readonly value?: { readonly runtimeId: string; readonly attachmentId: string } } | { readonly ok: false; readonly error: string } {
  if (value === undefined) {
    return { ok: true };
  }
  const record = readRecord(value);
  if (!record) {
    return { ok: false, error: `${toolName} externalRuntimeAttachment must be an object with runtimeId and attachmentId.` };
  }
  const unknownKeys = Object.keys(record).filter((key) => !EXTERNAL_RUNTIME_ATTACHMENT_FIELDS.has(key));
  if (unknownKeys.length > 0) {
    return { ok: false, error: `${toolName} externalRuntimeAttachment has unsupported field(s): ${unknownKeys.join(", ")}.` };
  }
  const runtimeId = readOpaqueAttachmentIdentity(record.runtimeId);
  if (!runtimeId) {
    return { ok: false, error: `${toolName} externalRuntimeAttachment.runtimeId is required and must be non-empty.` };
  }
  const attachmentId = readOpaqueAttachmentIdentity(record.attachmentId);
  if (!attachmentId) {
    return { ok: false, error: `${toolName} externalRuntimeAttachment.attachmentId is required and must be non-empty.` };
  }
  return { ok: true, value: { runtimeId, attachmentId } };
}

// External-runtime attachment identities are opaque. Unlike readText, this
// validates emptiness without normalising: the exact string the caller sent
// is what admission compares and what evidence persists.
function readOpaqueAttachmentIdentity(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAssistantOutputVerbosity(value: unknown): "concise" | "standard" | "detailed" | undefined {
  return value === "concise" || value === "standard" || value === "detailed" ? value : undefined;
}

export function readTextArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = unique(value.map(readText).filter((item): item is string => item !== undefined));
  return values.length > 0 ? values : undefined;
}

const MANAGED_RESULT_FIELDS = new Set<ManagedAgentResultField>([
  "summary",
  "resourceUris",
  "evidence",
  "verificationResults",
  "uncertainty",
  "limitations",
  "warnings",
  "approvalRequirements",
  "residualRisks",
]);

export function parseManagedResultFields(value: unknown):
  | { readonly ok: true; readonly value?: readonly ManagedAgentResultField[] }
  | { readonly ok: false; readonly error: string } {
  const fields = readTextArray(value);
  if (!fields) return { ok: true };
  const unsupported = fields.filter((field) => !MANAGED_RESULT_FIELDS.has(field as ManagedAgentResultField));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `requiredResultFields contains unsupported canonical fields: ${unsupported.join(", ")}.`,
    };
  }
  return {
    ok: true,
    value: fields as readonly ManagedAgentResultField[],
  };
}

export function resolveManagedInvocationParentTurnId(context: RuntimeBuiltinToolExecutionContext): string {
  return context.turnId ?? `${context.session.id}:turn:${Math.max(context.session.userTurnCount, 1)}`;
}

export function resolveManagedInvocationParentTurnOrdinal(parentTurnId: string, fallbackTurnCount: number): number {
  const match = parentTurnId.match(/:turn:(\d+)$/u);
  if (!match) {
    return Math.max(fallbackTurnCount, 1);
  }
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : Math.max(fallbackTurnCount, 1);
}

export function buildInvocationId(sessionId: string, turnCount: number, toolCallId: string): string {
  return `managed-${sanitizeId(sessionId)}-${Math.max(turnCount, 1)}-${sanitizeId(toolCallId)}`;
}

export function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized.length > 0 ? sanitized.slice(0, 96) : "invocation";
}

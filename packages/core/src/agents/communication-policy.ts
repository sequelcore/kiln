import { sha256ContentIdentity } from "../content-addressing/content-identity.js";

export type ResponseDetailIntent = "provider-default" | "concise" | "standard" | "detailed";

export type CommunicationRequiredContent =
  | "approval-requirement"
  | "citation"
  | "decision"
  | "failure"
  | "finding"
  | "next-action"
  | "residual-risk"
  | "verification"
  | "warning";

export type InteractionBehavior =
  | "audience-calibrated"
  | "findings-first"
  | "next-action-explicit"
  | "outcome-first"
  | "plain-language"
  | "state-visible";

export interface InteractionProfileIntent {
  readonly id: string;
  readonly revision: string;
  readonly behaviors: readonly InteractionBehavior[];
}

export interface CommunicationContractReference {
  readonly id: string;
  readonly revision: string;
}

export interface CommunicationIntent {
  readonly responseDetail?: ResponseDetailIntent;
  readonly interactionProfile?: InteractionProfileIntent;
  readonly locale?: string;
  readonly requiredContent?: readonly CommunicationRequiredContent[];
  readonly artifactContract?: CommunicationContractReference;
  readonly responseSkills?: readonly CommunicationContractReference[];
  readonly onUnsupported?: "deny" | "omit";
}

export type CommunicationIntentSource =
  | "safety-authority"
  | "user"
  | "artifact-contract"
  | "response-skill"
  | "invocation"
  | "agent-profile"
  | "project"
  | "global"
  | "provider-default";

export interface CommunicationIntentCandidate {
  readonly source: CommunicationIntentSource;
  readonly intent: CommunicationIntent;
}

export interface ResolvedCommunicationIntent {
  readonly version: "v1";
  readonly intent: CommunicationIntent & {
    readonly responseDetail: ResponseDetailIntent;
    readonly requiredContent: readonly CommunicationRequiredContent[];
    readonly responseSkills: readonly CommunicationContractReference[];
    readonly onUnsupported: "deny" | "omit";
  };
  readonly authority: {
    readonly responseDetail: CommunicationIntentSource;
    readonly interactionProfile?: CommunicationIntentSource;
    readonly locale?: CommunicationIntentSource;
    readonly artifactContract?: CommunicationIntentSource;
    readonly responseSkills: readonly CommunicationIntentSource[];
    readonly onUnsupported: CommunicationIntentSource;
    readonly requiredContent: Readonly<Partial<Record<CommunicationRequiredContent, readonly CommunicationIntentSource[]>>>;
  };
  readonly identity: string;
}

export interface CommunicationCapabilityEvidence {
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly observedAt: string;
}

export interface ResponseDetailCapabilities {
  readonly mechanism: "native" | "prompt-fallback";
  readonly supported: readonly Exclude<ResponseDetailIntent, "provider-default">[];
  readonly nativeValues?: Readonly<Partial<Record<Exclude<ResponseDetailIntent, "provider-default">, string>>>;
  /** Required when a prompt fallback is admitted by representative evaluation. */
  readonly evaluationId?: string;
}

export interface InteractionProfileCapability {
  readonly profileId: string;
  readonly profileRevision: string;
  readonly supportedBehaviors: readonly InteractionBehavior[];
  readonly mechanism: "native" | "prompt-fallback";
  readonly nativeValue?: string;
  readonly fidelity: "exact" | "translated" | "prompt-fallback";
  readonly semanticLoss: readonly string[];
  /** Required when a prompt fallback is admitted by representative evaluation. */
  readonly evaluationId?: string;
}

export interface ModelCommunicationCapabilities {
  readonly provider: string;
  readonly model: string;
  readonly responseDetail?: ResponseDetailCapabilities;
  readonly interactionProfiles?: readonly InteractionProfileCapability[];
  readonly evidence: CommunicationCapabilityEvidence;
}

export type CommunicationSurface =
  | "cli"
  | "gui"
  | "tui"
  | "sdk"
  | "runtime"
  | "managed-child"
  | "replay"
  | "standalone-harness";

export interface CommunicationExecutionIdentity {
  readonly routeId?: string;
  readonly provider: string;
  readonly model: string;
  readonly surface: CommunicationSurface;
  readonly harness?: "codex" | "claude" | "opencode" | string;
}

export type CommunicationResolutionReason =
  | "not-requested"
  | "provider-default"
  | "capability-unknown"
  | "detail-unsupported"
  | "profile-unsupported";

export interface ResponseDetailResolution {
  readonly requested: ResponseDetailIntent;
  readonly effective?: ResponseDetailIntent;
  readonly status: "exact" | "prompt-fallback" | "defaulted" | "unsupported";
  readonly mechanism: "native" | "prompt" | "default" | "none";
  readonly nativeValue?: string;
  readonly evaluationId?: string;
  readonly reason?: CommunicationResolutionReason;
}

export interface InteractionProfileResolution {
  readonly requestedProfileId?: string;
  readonly effectiveProfileId?: string;
  readonly status: "exact" | "translated" | "prompt-fallback" | "defaulted" | "unsupported";
  readonly mechanism: "native" | "prompt" | "default" | "none";
  readonly nativeValue?: string;
  readonly evaluationId?: string;
  readonly reason?: CommunicationResolutionReason;
}

export interface CommunicationProjectionResolution<T> {
  readonly requested?: T;
  readonly effective?: T;
  readonly status: "exact" | "not-requested";
  readonly mechanism: "prompt" | "contract-reference" | "none";
}

export interface CommunicationResolution {
  readonly version: "v1";
  readonly requested: ResolvedCommunicationIntent;
  readonly execution: CommunicationExecutionIdentity;
  readonly responseDetail: ResponseDetailResolution;
  readonly interactionProfile: InteractionProfileResolution;
  readonly locale: CommunicationProjectionResolution<string>;
  readonly requiredContent: CommunicationProjectionResolution<readonly CommunicationRequiredContent[]>;
  readonly artifactContract: CommunicationProjectionResolution<CommunicationContractReference>;
  readonly responseSkills: CommunicationProjectionResolution<readonly CommunicationContractReference[]>;
  readonly capabilityEvidence?: CommunicationCapabilityEvidence;
  readonly semanticLoss: readonly string[];
  readonly identity: string;
}

const PRECEDENCE: Readonly<Record<CommunicationIntentSource, number>> = {
  "safety-authority": 0,
  user: 1,
  "artifact-contract": 2,
  "response-skill": 3,
  invocation: 4,
  "agent-profile": 5,
  project: 6,
  global: 7,
  "provider-default": 8,
};

export function resolveCommunicationIntent(
  candidates: readonly CommunicationIntentCandidate[],
): ResolvedCommunicationIntent {
  const ordered = [...candidates].sort((left, right) => {
    const rank = PRECEDENCE[left.source] - PRECEDENCE[right.source];
    return rank !== 0 ? rank : stableStringify(left).localeCompare(stableStringify(right));
  });
  for (const candidate of ordered) validateCandidate(candidate);

  const detail = firstField(ordered, "responseDetail");
  const profile = firstField(ordered, "interactionProfile");
  const locale = firstField(ordered, "locale");
  const artifact = firstField(ordered, "artifactContract");
  const onUnsupported = firstField(ordered, "onUnsupported");
  const requiredAuthority: Partial<Record<CommunicationRequiredContent, CommunicationIntentSource[]>> = {};
  const required = new Set<CommunicationRequiredContent>();
  const responseSkillSources = new Set<CommunicationIntentSource>();
  const responseSkills = new Map<string, CommunicationContractReference>();

  for (const candidate of ordered) {
    for (const obligation of candidate.intent.requiredContent ?? []) {
      required.add(obligation);
      (requiredAuthority[obligation] ??= []).push(candidate.source);
    }
    for (const skill of candidate.intent.responseSkills ?? []) {
      responseSkills.set(`${skill.id}\u0000${skill.revision}`, skill);
      responseSkillSources.add(candidate.source);
    }
  }

  const intent = {
    responseDetail: detail?.value ?? "provider-default",
    ...(profile ? { interactionProfile: profile.value } : {}),
    ...(locale ? { locale: locale.value } : {}),
    requiredContent: [...required].sort(),
    ...(artifact ? { artifactContract: artifact.value } : {}),
    responseSkills: [...responseSkills.values()].sort(compareContractReference),
    onUnsupported: onUnsupported?.value ?? "deny",
  } satisfies ResolvedCommunicationIntent["intent"];
  const authority = {
    responseDetail: detail?.source ?? "provider-default",
    ...(profile ? { interactionProfile: profile.source } : {}),
    ...(locale ? { locale: locale.source } : {}),
    ...(artifact ? { artifactContract: artifact.source } : {}),
    responseSkills: [...responseSkillSources].sort(compareSource),
    onUnsupported: onUnsupported?.source ?? "provider-default",
    requiredContent: Object.fromEntries(
      Object.entries(requiredAuthority)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, sources]) => [key, [...new Set(sources)].sort(compareSource)]),
    ),
  } satisfies ResolvedCommunicationIntent["authority"];
  const value = { version: "v1" as const, intent, authority };
  return { ...value, identity: sha256ContentIdentity(stableStringify(value)) };
}

/** Verifies a previously resolved contract without changing its source provenance. */
export function validateResolvedCommunicationIntent(input: ResolvedCommunicationIntent): ResolvedCommunicationIntent {
  if (!input || typeof input !== "object" || input.version !== "v1") {
    throw new Error("Resolved communication intent version is invalid.");
  }
  const unknownKey = Object.keys(input).find((key) => !["version", "intent", "authority", "identity"].includes(key));
  if (unknownKey) throw new Error(`Unknown resolved communication intent field: ${unknownKey}.`);
  validateCandidate({ source: "invocation", intent: input.intent });
  if (!input.authority || typeof input.authority !== "object") {
    throw new Error("Resolved communication intent authority is invalid.");
  }
  const unknownAuthorityKey = Object.keys(input.authority).find((key) => ![
    "responseDetail", "interactionProfile", "locale", "artifactContract",
    "responseSkills", "onUnsupported", "requiredContent",
  ].includes(key));
  if (unknownAuthorityKey || !Array.isArray(input.authority.responseSkills)
    || !input.authority.requiredContent || typeof input.authority.requiredContent !== "object") {
    throw new Error("Resolved communication intent authority is invalid.");
  }
  const sources = new Set<CommunicationIntentSource>(Object.keys(PRECEDENCE) as CommunicationIntentSource[]);
  const scalarSources = [
    input.authority.responseDetail,
    input.authority.interactionProfile,
    input.authority.locale,
    input.authority.artifactContract,
    input.authority.onUnsupported,
    ...input.authority.responseSkills,
    ...Object.values(input.authority.requiredContent).flatMap((value) => value ?? []),
  ].filter((source): source is CommunicationIntentSource => source !== undefined);
  if (scalarSources.some((source) => !sources.has(source))) {
    throw new Error("Resolved communication intent contains an invalid authority source.");
  }
  if ((input.intent.interactionProfile !== undefined) !== (input.authority.interactionProfile !== undefined)
    || (input.intent.locale !== undefined) !== (input.authority.locale !== undefined)
    || (input.intent.artifactContract !== undefined) !== (input.authority.artifactContract !== undefined)) {
    throw new Error("Resolved communication intent authority does not match its requested fields.");
  }
  const requiredKeys = Object.keys(input.authority.requiredContent).sort();
  if (stableStringify(requiredKeys) !== stableStringify([...input.intent.requiredContent].sort())) {
    throw new Error("Resolved communication required-content authority is incomplete.");
  }
  const value = { version: input.version, intent: input.intent, authority: input.authority };
  if (sha256ContentIdentity(stableStringify(value)) !== input.identity) {
    throw new Error("Resolved communication intent identity does not match its content.");
  }
  return input;
}

export function resolveCommunicationProfile(input: {
  readonly intent: ResolvedCommunicationIntent;
  readonly execution: CommunicationExecutionIdentity;
  readonly capabilities?: ModelCommunicationCapabilities;
}): CommunicationResolution {
  if (input.capabilities) validateCapabilities(input.execution, input.capabilities);
  const responseDetail = resolveResponseDetail(input.intent.intent.responseDetail, input.capabilities);
  const interactionProfile = resolveInteractionProfile(
    input.intent.intent.interactionProfile,
    input.capabilities,
  );
  const locale = promptProjection(input.intent.intent.locale);
  const requiredContent = promptProjection(
    input.intent.intent.requiredContent.length > 0 ? input.intent.intent.requiredContent : undefined,
  );
  const artifactContract = contractProjection(input.intent.intent.artifactContract);
  const responseSkills = contractProjection(
    input.intent.intent.responseSkills.length > 0 ? input.intent.intent.responseSkills : undefined,
  );
  const semanticLoss = input.intent.intent.interactionProfile
    ? findInteractionProfileCapability(input.intent.intent.interactionProfile, input.capabilities)?.semanticLoss ?? []
    : [];
  const value = {
    version: "v1" as const,
    requested: input.intent,
    execution: input.execution,
    responseDetail,
    interactionProfile,
    locale,
    requiredContent,
    artifactContract,
    responseSkills,
    ...(input.capabilities ? { capabilityEvidence: input.capabilities.evidence } : {}),
    semanticLoss,
  };
  return { ...value, identity: sha256ContentIdentity(stableStringify(value)) };
}

/**
 * Returns only transport capabilities backed by maintained provider evidence.
 * Unknown providers and models remain unsupported instead of being approximated.
 */
export function knownModelCommunicationCapabilities(
  provider: string,
  model: string,
): ModelCommunicationCapabilities | undefined {
  if (provider !== "codex-oauth" || !/^gpt-5(?:\.|-|$)/u.test(model)) return undefined;
  return {
    provider,
    model,
    responseDetail: {
      mechanism: "native",
      supported: ["concise", "standard", "detailed"],
      nativeValues: { concise: "low", standard: "medium", detailed: "high" },
    },
    evidence: {
      sourceIdentity: "openai-responses-text-verbosity",
      sourceRevision: "2026-08-13",
      observedAt: "2026-08-13T00:00:00.000Z",
    },
  };
}

/** Admits only native communication controls at the provider boundary. */
export function admitCommunicationForExecution(
  resolution: CommunicationResolution | undefined,
): { readonly responseDetail?: string; readonly interactionProfile?: string } {
  if (!resolution) return {};
  const unsupported = resolution.responseDetail.status === "unsupported"
    || resolution.interactionProfile.status === "unsupported";
  if (unsupported && resolution.requested.intent.onUnsupported === "deny") {
    throw new Error("Unsupported communication intent cannot execute under deny policy.");
  }
  if (resolution.responseDetail.status === "prompt-fallback"
    || resolution.interactionProfile.status === "prompt-fallback") {
    throw new Error("Communication prompt fallback must be materialized in the effective prompt before provider execution.");
  }
  if (resolution.capabilityEvidence
    && (!resolution.capabilityEvidence.sourceIdentity.trim()
      || !resolution.capabilityEvidence.sourceRevision.trim())) {
    throw new Error("Executable communication controls require capability evidence identity and revision.");
  }
  return {
    ...(resolution.responseDetail.mechanism === "native" && resolution.responseDetail.nativeValue
      ? { responseDetail: resolution.responseDetail.nativeValue }
      : {}),
    ...(resolution.interactionProfile.mechanism === "native" && resolution.interactionProfile.nativeValue
      ? { interactionProfile: resolution.interactionProfile.nativeValue }
      : {}),
  };
}

/**
 * Renders only explicit prompt-owned communication obligations. Native detail
 * and native profile controls stay out of prompt text, and unsupported axes
 * are never approximated here.
 */
export function renderCommunicationPromptProjection(
  resolution: CommunicationResolution | undefined,
): string | undefined {
  if (!resolution) return undefined;
  const intent = resolution.requested.intent;
  const lines: string[] = [];
  if (intent.locale) {
    lines.push(`Respond using locale '${intent.locale}' unless the user's current message explicitly requires another language or exact format.`);
  }
  if (intent.requiredContent.length > 0) {
    lines.push(
      `Do not omit applicable required content: ${intent.requiredContent.join(", ")}. `
      + "Preserve it even when the requested response detail is concise; do not invent inapplicable content.",
    );
  }
  if (intent.artifactContract) {
    lines.push(`Satisfy admitted artifact contract '${intent.artifactContract.id}@${intent.artifactContract.revision}'.`);
  }
  if (intent.responseSkills.length > 0) {
    lines.push(`Apply admitted response skills: ${intent.responseSkills.map((skill) => `${skill.id}@${skill.revision}`).join(", ")}.`);
  }
  if (resolution.responseDetail.status === "prompt-fallback") {
    lines.push(`Use '${resolution.responseDetail.requested}' response detail without removing required facts or evidence.`);
  }
  if (resolution.interactionProfile.status === "prompt-fallback") {
    const profile = intent.interactionProfile;
    if (profile) {
      lines.push(`Apply interaction profile '${profile.id}@${profile.revision}' through these observable behaviors: ${profile.behaviors.join(", ")}.`);
    }
  }
  if (lines.length === 0) return undefined;
  return `\n\n--- Kiln Communication Contract ---\n${lines.join("\n")}`;
}

function resolveResponseDetail(
  requested: ResponseDetailIntent,
  capabilities: ModelCommunicationCapabilities | undefined,
): ResponseDetailResolution {
  if (requested === "provider-default") {
    return {
      requested,
      status: "defaulted",
      mechanism: "default",
      reason: "provider-default",
    };
  }
  const detail = capabilities?.responseDetail;
  if (!detail) {
    return { requested, status: "unsupported", mechanism: "none", reason: "capability-unknown" };
  }
  if (!detail.supported.includes(requested)) {
    return { requested, status: "unsupported", mechanism: "none", reason: "detail-unsupported" };
  }
  if (detail.mechanism === "native") {
    return {
      requested,
      effective: requested,
      status: "exact",
      mechanism: "native",
      nativeValue: detail.nativeValues![requested],
    };
  }
  return {
    requested,
    effective: requested,
    status: "prompt-fallback",
    mechanism: "prompt",
    evaluationId: detail.evaluationId,
  };
}

function resolveInteractionProfile(
  requested: InteractionProfileIntent | undefined,
  capabilities: ModelCommunicationCapabilities | undefined,
): InteractionProfileResolution {
  if (!requested) {
    return { status: "defaulted", mechanism: "default", reason: "not-requested" };
  }
  if (!capabilities) {
    return {
      requestedProfileId: requested.id,
      status: "unsupported",
      mechanism: "none",
      reason: "capability-unknown",
    };
  }
  const profile = findInteractionProfileCapability(requested, capabilities);
  if (!profile) {
    return {
      requestedProfileId: requested.id,
      status: "unsupported",
      mechanism: "none",
      reason: "profile-unsupported",
    };
  }
  return {
    requestedProfileId: requested.id,
    effectiveProfileId: requested.id,
    status: profile.fidelity,
    mechanism: profile.mechanism === "native" ? "native" : "prompt",
    ...(profile.nativeValue ? { nativeValue: profile.nativeValue } : {}),
    ...(profile.evaluationId ? { evaluationId: profile.evaluationId } : {}),
  };
}

function findInteractionProfileCapability(
  requested: InteractionProfileIntent,
  capabilities: ModelCommunicationCapabilities | undefined,
): InteractionProfileCapability | undefined {
  return capabilities?.interactionProfiles?.find((candidate) =>
    candidate.profileId === requested.id
    && candidate.profileRevision === requested.revision
    && stableStringify([...candidate.supportedBehaviors].sort()) === stableStringify([...requested.behaviors].sort()));
}

function promptProjection<T>(requested: T | undefined): CommunicationProjectionResolution<T> {
  return requested === undefined
    ? { status: "not-requested", mechanism: "none" }
    : { requested, effective: requested, status: "exact", mechanism: "prompt" };
}

function contractProjection<T>(requested: T | undefined): CommunicationProjectionResolution<T> {
  return requested === undefined
    ? { status: "not-requested", mechanism: "none" }
    : { requested, effective: requested, status: "exact", mechanism: "contract-reference" };
}

function validateCandidate(candidate: CommunicationIntentCandidate): void {
  const allowedKeys = new Set([
    "responseDetail", "interactionProfile", "locale", "requiredContent",
    "artifactContract", "responseSkills", "onUnsupported",
  ]);
  const unknownKey = Object.keys(candidate.intent).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown communication intent field: ${unknownKey}.`);
  if (candidate.source === "safety-authority") {
    const keys = Object.keys(candidate.intent).filter((key) => key !== "requiredContent");
    if (keys.length > 0) {
      throw new Error("Safety and authority communication candidates may only add required content.");
    }
  }
  if (candidate.intent.responseDetail !== undefined
    && !["provider-default", "concise", "standard", "detailed"].includes(candidate.intent.responseDetail)) {
    throw new Error("Communication response detail is invalid.");
  }
  if (candidate.intent.onUnsupported !== undefined
    && candidate.intent.onUnsupported !== "deny"
    && candidate.intent.onUnsupported !== "omit") {
    throw new Error("Communication unsupported policy is invalid.");
  }
  const validRequiredContent: readonly CommunicationRequiredContent[] = [
    "approval-requirement", "citation", "decision", "failure", "finding",
    "next-action", "residual-risk", "verification", "warning",
  ];
  if (candidate.intent.requiredContent !== undefined
    && (!Array.isArray(candidate.intent.requiredContent)
      || candidate.intent.requiredContent.some((entry) => !validRequiredContent.includes(entry)))) {
    throw new Error("Communication required content is invalid.");
  }
  if (candidate.intent.responseSkills !== undefined && !Array.isArray(candidate.intent.responseSkills)) {
    throw new Error("Communication response skills must be an array.");
  }
  if (candidate.intent.locale !== undefined && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(candidate.intent.locale)) {
    throw new Error("Communication locale must be a portable language tag.");
  }
  if (candidate.intent.interactionProfile) validateProfile(candidate.intent.interactionProfile);
  if (candidate.intent.artifactContract) validateReference(candidate.intent.artifactContract, "artifact contract");
  for (const skill of candidate.intent.responseSkills ?? []) validateReference(skill, "response skill");
}

function validateProfile(profile: InteractionProfileIntent): void {
  if (!profile || typeof profile !== "object" || !Array.isArray(profile.behaviors)) {
    throw new Error("Communication interaction profile is invalid.");
  }
  const unknownKey = Object.keys(profile).find((key) => !["id", "revision", "behaviors"].includes(key));
  if (unknownKey) throw new Error(`Unknown communication interaction profile field: ${unknownKey}.`);
  validateReferenceFields(profile, "interaction profile");
  const validBehaviors: readonly InteractionBehavior[] = [
    "audience-calibrated", "findings-first", "next-action-explicit",
    "outcome-first", "plain-language", "state-visible",
  ];
  if (profile.behaviors.length === 0 || new Set(profile.behaviors).size !== profile.behaviors.length) {
    throw new Error("Interaction profile behaviors must be non-empty and unique.");
  }
  if (profile.behaviors.some((behavior) => !validBehaviors.includes(behavior))) {
    throw new Error("Communication interaction profile behavior is invalid.");
  }
}

function validateReference(reference: CommunicationContractReference, label: string): void {
  const unknownKey = reference && typeof reference === "object"
    ? Object.keys(reference).find((key) => !["id", "revision"].includes(key))
    : undefined;
  if (unknownKey) throw new Error(`Unknown communication ${label} field: ${unknownKey}.`);
  validateReferenceFields(reference, label);
}

function validateReferenceFields(reference: CommunicationContractReference, label: string): void {
  if (!reference || typeof reference !== "object"
    || typeof reference.id !== "string" || typeof reference.revision !== "string"
    || !portableId(reference.id) || !portableId(reference.revision)) {
    throw new Error(`Communication ${label} id and revision must be portable identifiers.`);
  }
}

function validateCapabilities(
  execution: CommunicationExecutionIdentity,
  capabilities: ModelCommunicationCapabilities,
): void {
  if (capabilities.provider !== execution.provider || capabilities.model !== execution.model) {
    throw new Error("Communication capabilities must match the execution provider and model.");
  }
  if (!capabilities.evidence.sourceIdentity.trim()
    || !capabilities.evidence.sourceRevision.trim()
    || Number.isNaN(Date.parse(capabilities.evidence.observedAt))) {
    throw new Error("Communication capability evidence must have identity, revision, and observation time.");
  }
  const detail = capabilities.responseDetail;
  if (detail) {
    if (detail.supported.length === 0 || new Set(detail.supported).size !== detail.supported.length) {
      throw new Error("Communication response-detail capabilities must be non-empty and unique.");
    }
    if (detail.mechanism === "prompt-fallback" && !detail.evaluationId?.trim()) {
      throw new Error("Communication prompt fallback requires evaluation evidence.");
    }
    if (detail.mechanism === "native") {
      const missing = detail.supported.find((intent) => !detail.nativeValues?.[intent]?.trim());
      if (missing) {
        throw new Error(`Communication native response-detail capability '${missing}' requires a native value.`);
      }
    }
  }
  const ids = capabilities.interactionProfiles?.map((profile) => profile.profileId) ?? [];
  if (new Set(ids).size !== ids.length) {
    throw new Error("Communication interaction-profile capabilities must be unique.");
  }
  for (const profile of capabilities.interactionProfiles ?? []) {
    if (!portableId(profile.profileId)) throw new Error("Communication capability profile id must be portable.");
    if (!portableId(profile.profileRevision)) throw new Error("Communication capability profile revision must be portable.");
    validateProfile({ id: profile.profileId, revision: profile.profileRevision, behaviors: profile.supportedBehaviors });
    if (profile.mechanism === "prompt-fallback" && !profile.evaluationId?.trim()) {
      throw new Error("Communication prompt fallback requires evaluation evidence.");
    }
    if (profile.mechanism === "native" && !profile.nativeValue?.trim()) {
      throw new Error("Communication native interaction-profile capability requires a native value.");
    }
  }
}

function firstField<K extends keyof CommunicationIntent>(
  candidates: readonly CommunicationIntentCandidate[],
  field: K,
): { readonly source: CommunicationIntentSource; readonly value: NonNullable<CommunicationIntent[K]> } | undefined {
  for (const candidate of candidates) {
    const value = candidate.intent[field];
    if (value !== undefined) return { source: candidate.source, value: value as NonNullable<CommunicationIntent[K]> };
  }
  return undefined;
}

function portableId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(value);
}

function compareContractReference(left: CommunicationContractReference, right: CommunicationContractReference): number {
  return `${left.id}\u0000${left.revision}`.localeCompare(`${right.id}\u0000${right.revision}`);
}

function compareSource(left: CommunicationIntentSource, right: CommunicationIntentSource): number {
  return PRECEDENCE[left] - PRECEDENCE[right] || left.localeCompare(right);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

import { createHash } from "node:crypto";
import {
  resolveDirectProviderExecutionProfile,
  defineExecutionDataClassification,
  type ExecutionAccount,
  type ExecutionCatalogInput,
  type ExecutionDataClassification,
  type ExecutionRouteAccountSelection,
  type ExecutionRouteEconomicsConfig,
  type DiscoveredDirectProviderModelCapabilities,
} from "@kilnai/core";
import {
  ExecutionTargetWizardProposalSchema,
  type AvailableModelCatalog,
  type AvailableModelCatalogEntry,
  type ExecutionTargetWizardProposal,
  type ExecutionTargetWizardRequest,
} from "@kilnai/gateway-contracts";
import type {
  ExecutionTargetCatalogIntent,
  ExecutionTargetEvidenceSnapshot,
} from "../config/execution-target-evidence-store.js";
import {
  completeExecutionRouteDraft,
  startExecutionRouteDraft,
  type CompleteExecutionRouteDraft,
  type ExecutionRouteDraftDiscoveryEvidence,
  type ExecutionRouteDraftMaterial,
} from "./execution-route-draft.js";

export type TargetWizardRejectionCode =
  | "TARGET_DISCOVERY_STALE"
  | "TARGET_IDENTITY_CHANGED"
  | "TARGET_REVISION_CONFLICT"
  | "TARGET_ACCOUNT_UNAVAILABLE"
  | "TARGET_DATA_POLICY_UNAVAILABLE"
  | "TARGET_ECONOMICS_UNAVAILABLE"
  | "TARGET_AUTHORITY_APPROVAL_REQUIRED"
  | "TARGET_CREATE_REJECTED";

export type TargetWizardRepairAction =
  | "refresh-and-retry"
  | "select-current-model"
  | "configure-account"
  | "review-data-policy"
  | "review-economics"
  | "approve-and-apply";

export class ExecutionTargetWizardAdmissionError extends Error {
  readonly code: TargetWizardRejectionCode;
  readonly action: TargetWizardRepairAction;

  constructor(code: TargetWizardRejectionCode, action: TargetWizardRepairAction, message: string) {
    super(message);
    this.name = "ExecutionTargetWizardAdmissionError";
    this.code = code;
    this.action = action;
  }
}

export interface ExecutionTargetWizardDiscoveryEvidence {
  readonly entry: AvailableModelCatalogEntry;
  readonly catalogObservedAt: string;
  readonly sourceObservedAt: string;
  readonly expiresAt: string;
  readonly evidenceIdentity: string;
  readonly evidenceRevision: `sha256:${string}`;
  readonly materialRevision: `sha256:${string}`;
  readonly rawEvidence: {
    readonly rawId: string;
    readonly provenance: string;
  };
  readonly modelCapabilities?: Pick<
    DiscoveredDirectProviderModelCapabilities,
    | "supportsFunctionTools"
    | "supportsRuntimeTools"
    | "supportsNativeShellTools"
    | "supportsNativePatchTools"
    | "supportsTools"
  >;
}

export interface ExecutionTargetWizardCurrentEvidence {
  readonly catalog: AvailableModelCatalog;
  readonly executionCatalog: ExecutionCatalogInput;
  readonly targetIntent: ExecutionTargetCatalogIntent;
  readonly targetEvidence: ExecutionTargetEvidenceSnapshot;
  readonly revision: string;
  readonly discoveryEvidence: ExecutionTargetWizardDiscoveryEvidence;
}

export interface ExecutionTargetWizardAdmissionInput {
  readonly request: ExecutionTargetWizardRequest;
  readonly admittedEvidence: ExecutionTargetWizardDiscoveryEvidence;
  readonly current: ExecutionTargetWizardCurrentEvidence;
  readonly now?: Date;
}

export interface AdmittedExecutionTargetWizardRequest {
  readonly proposal: ExecutionTargetWizardProposal;
  readonly draft: CompleteExecutionRouteDraft;
  readonly entry: AvailableModelCatalogEntry;
  readonly current: ExecutionTargetWizardCurrentEvidence;
}

export function admitExecutionTargetWizardRequest(
  input: ExecutionTargetWizardAdmissionInput,
): AdmittedExecutionTargetWizardRequest {
  const { request, admittedEvidence, current } = input;
  const currentEvidence = current.discoveryEvidence;
  if (!sameIdentity(admittedEvidence.entry, request.discoveryIdentity)) {
    throw reject("TARGET_IDENTITY_CHANGED", "select-current-model", "The selected model identity is no longer current.");
  }
  if (!sameIdentity(currentEvidence.entry, request.discoveryIdentity)) {
    throw reject("TARGET_IDENTITY_CHANGED", "select-current-model", "The selected model identity changed during admission.");
  }
  if (current.revision !== request.expectedRevision) {
    throw reject("TARGET_REVISION_CONFLICT", "refresh-and-retry", "The current configuration changed; refresh and preview again.");
  }
  if (currentEvidence.materialRevision !== admittedEvidence.materialRevision) {
    throw reject("TARGET_DISCOVERY_STALE", "refresh-and-retry", "Current discovery evidence changed; refresh and preview again.");
  }
  const exact = current.catalog.entries.find((candidate) => sameIdentity(candidate, request.discoveryIdentity));
  if (!exact
    || exact.discoveryState !== currentEvidence.entry.discoveryState
    || exact.eligibilityState !== currentEvidence.entry.eligibilityState) {
    throw reject("TARGET_DISCOVERY_STALE", "refresh-and-retry", "Current discovery and Available Models evidence no longer agree.");
  }
  if (current.catalog.observedAt !== currentEvidence.catalogObservedAt) {
    throw reject("TARGET_DISCOVERY_STALE", "refresh-and-retry", "Current discovery observation changed; refresh and preview again.");
  }
  if (exact.discoveryState !== "observed" || exact.eligibilityState !== "eligible") {
    throw reject("TARGET_DISCOVERY_STALE", "refresh-and-retry", "The selected model discovery is stale or not eligible.");
  }
  if (!isFuture(currentEvidence.expiresAt, input.now ?? new Date())) {
    throw reject("TARGET_DISCOVERY_STALE", "refresh-and-retry", "The selected model discovery evidence has expired.");
  }
  if (request.dataPolicyConfirmed !== true) {
    throw reject("TARGET_DATA_POLICY_UNAVAILABLE", "review-data-policy", "Operator confirmation of the data policy is required.");
  }

  const draftStart = startExecutionRouteDraft(exact);
  const routeId = createCollisionSafeRouteId(request, current.executionCatalog);
  const label = request.label?.trim() || `${request.discoveryIdentity.providerId}/${request.discoveryIdentity.providerModelId}`;
  const account = resolveAccountSelection(current.executionCatalog, request.discoveryIdentity.providerId);
  const profile = resolveDirectProviderExecutionProfile({
    provider: request.discoveryIdentity.providerId,
    model: request.discoveryIdentity.providerModelId,
    discoveredModelCapabilities: currentEvidence.modelCapabilities,
  });
  if (!profile) {
    throw reject("TARGET_ECONOMICS_UNAVAILABLE", "review-economics", "No direct-provider execution profile is available for this model.");
  }
  const evidenceContext = createEvidenceContext(request, currentEvidence);
  const economics = createEconomics({
    providerId: request.discoveryIdentity.providerId,
    profile,
    accounts: account.accounts,
    evidenceContext,
  });
  const dataPolicyEvidence = createDataPolicyEvidence({
    providerId: request.discoveryIdentity.providerId,
    providerModelId: request.discoveryIdentity.providerModelId,
    classification: request.dataClassification,
    evidenceContext,
  });
  const material: ExecutionRouteDraftMaterial = {
    routeId,
    label,
    accountSelection: account.selection,
    dataClassification: defineExecutionDataClassification(request.dataClassification),
    dataPolicyEvidence,
    economics,
  };
  const discoveryEvidence: ExecutionRouteDraftDiscoveryEvidence = {
    evidenceIdentity: currentEvidence.evidenceIdentity,
    evidenceRevision: currentEvidence.evidenceRevision,
    observedAt: currentEvidence.sourceObservedAt,
    expiresAt: currentEvidence.expiresAt,
  };
  let draft: CompleteExecutionRouteDraft;
  try {
    draft = completeExecutionRouteDraft({
      draft: draftStart,
      material,
      discoveryEvidence,
      catalog: current.executionCatalog,
    });
  } catch (error) {
    throw reject("TARGET_ECONOMICS_UNAVAILABLE", "review-economics", safeAdmissionMessage(error));
  }
  const proposal = createProposal({
    request,
    draft,
    discoveryExpiresAt: currentEvidence.expiresAt,
    evidenceExpiresAt: dataPolicyEvidence.expiresAt,
    billingClass: account.billingClass,
    capabilityPosture: profile.executionMode,
    discoveryMaterialRevision: currentEvidence.materialRevision,
  });
  return { proposal, draft, entry: exact, current };
}

function createProposal(input: {
  readonly request: ExecutionTargetWizardRequest;
  readonly draft: CompleteExecutionRouteDraft;
  readonly discoveryExpiresAt: string;
  readonly evidenceExpiresAt: string;
  readonly billingClass: ExecutionTargetWizardProposal["target"]["billingClass"];
  readonly capabilityPosture: ExecutionTargetWizardProposal["target"]["capabilityPosture"];
  readonly discoveryMaterialRevision: `sha256:${string}`;
}): ExecutionTargetWizardProposal {
  const target = {
    routeId: input.draft.intent.id,
    label: input.draft.intent.label,
    providerId: input.draft.intent.providerId,
    providerModelId: input.draft.intent.providerModelId,
    accountSelectionMode: input.draft.intent.accountSelection.mode,
    dataClassification: input.draft.intent.dataClassification,
    billingClass: input.billingClass,
    capabilityPosture: input.capabilityPosture,
    discoveryExpiresAt: input.discoveryExpiresAt,
    evidenceExpiresAt: input.evidenceExpiresAt,
  };
  const proposalId = `cfg_${sha256({
    request: {
      expectedRevision: input.request.expectedRevision,
      discoveryIdentity: input.request.discoveryIdentity,
      label: input.request.label,
      dataClassification: input.request.dataClassification,
      dataPolicyConfirmed: input.request.dataPolicyConfirmed,
    },
    intent: input.draft.intent,
    target,
    discoveryMaterialRevision: input.discoveryMaterialRevision,
    dataPolicy: dataPolicyApprovalMaterial(input.draft.route.dataPolicyEvidence),
    economics: economicsApprovalMaterial(input.draft.route.economics),
  }).slice("sha256:".length, 30)}`;
  return ExecutionTargetWizardProposalSchema.parse({
    proposalId,
    operation: "target.create",
    scope: "global",
    status: "valid",
    baseRevision: input.request.expectedRevision,
    authorityImpact: "expands-write",
    approvalRequired: true,
    approvalStatus: input.request.action === "apply" ? "approved" : "required",
    activation: "next-session",
    owners: ["execution-routing", "execution-target-evidence"],
    reconciliationTargets: ["execution-routes"],
    diagnostics: [],
    rollback: { restorable: true, summary: "The target mutation can be restored by the governed mutation authority." },
    target,
  });
}

function dataPolicyApprovalMaterial(
  evidence: ExecutionRouteDraftMaterial["dataPolicyEvidence"],
): Omit<typeof evidence, "sourceIdentity" | "sourceRevision" | "sourceDigest" | "observedAt" | "expiresAt"> {
  const {
    sourceIdentity: _sourceIdentity,
    sourceRevision: _sourceRevision,
    sourceDigest: _sourceDigest,
    observedAt: _observedAt,
    expiresAt: _expiresAt,
    ...material
  } = evidence;
  return material;
}

function economicsApprovalMaterial(economics: ExecutionRouteEconomicsConfig): unknown {
  const { evidence: _sourceEvidence, ...priceEvidence } = economics.priceEvidence;
  return { ...economics, priceEvidence };
}

function resolveAccountSelection(catalog: ExecutionCatalogInput, providerId: string): {
  readonly selection: ExecutionRouteAccountSelection;
  readonly accounts: readonly ExecutionAccount[];
  readonly billingClass: ExecutionTargetWizardProposal["target"]["billingClass"];
} {
  const accounts = catalog.accounts.filter((account) => account.providerId === providerId);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const policies = catalog.accountPolicies.filter((policy) => {
    const policyAccounts = policy.accountIds.map((id) => accountById.get(id));
    return policyAccounts.length > 0 && policyAccounts.every((account): account is ExecutionAccount => account !== undefined);
  });
  if (policies.length === 1) {
    const policy = policies[0]!;
    const selectedAccounts = policy.accountIds.map((id) => accountById.get(id)).filter((account): account is ExecutionAccount => account !== undefined);
    return {
      selection: { mode: "automatic", accountPolicyId: policy.id },
      accounts: selectedAccounts,
      billingClass: consistentBillingClass(selectedAccounts),
    };
  }
  if (policies.length > 1 || accounts.length !== 1) {
    throw reject("TARGET_ACCOUNT_UNAVAILABLE", "configure-account", "Exactly one same-provider account policy or account is required.");
  }
  const account = accounts[0]!;
  return {
    selection: { mode: "exact", accountId: account.id },
    accounts: [account],
    billingClass: billingClassOf(account),
  };
}

function consistentBillingClass(accounts: readonly ExecutionAccount[]): ExecutionTargetWizardProposal["target"]["billingClass"] {
  if (accounts.length === 0) {
    throw reject("TARGET_ECONOMICS_UNAVAILABLE", "review-economics", "The selected account policy has no accounts.");
  }
  const first = accounts[0]!.economics;
  if (accounts.some((account) => JSON.stringify(account.economics) !== JSON.stringify(first))) {
    throw reject("TARGET_ECONOMICS_UNAVAILABLE", "review-economics", "Automatic account policy economics are inconsistent.");
  }
  return billingClassOf(accounts[0]!);
}

function billingClassOf(account: ExecutionAccount): ExecutionTargetWizardProposal["target"]["billingClass"] {
  return account.economics.subscriptionClass;
}

function createDataPolicyEvidence(input: {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly classification: ExecutionDataClassification;
  readonly evidenceContext: EvidenceContext;
}) {
  const classifications: readonly ExecutionDataClassification[] = ["public", "internal", "confidential", "restricted"];
  const maximum = classifications.indexOf(input.classification);
  if (maximum < 0) throw reject("TARGET_DATA_POLICY_UNAVAILABLE", "review-data-policy", "The selected data classification is invalid.");
  return {
    providerId: input.providerId,
    providerModelId: input.providerModelId,
    dataUse: "service-operation" as const,
    trainingPosture: "permitted" as const,
    retention: { posture: "bounded" as const, days: 3650 },
    permittedMaximumClassification: input.classification,
    permittedClassifications: classifications.slice(0, maximum + 1),
    sourceIdentity: input.evidenceContext.sourceIdentity,
    sourceRevision: input.evidenceContext.sourceRevision,
    sourceDigest: input.evidenceContext.sourceDigest,
    observedAt: input.evidenceContext.observedAt,
    expiresAt: input.evidenceContext.expiresAt,
  };
}

function createEconomics(input: {
  readonly providerId: string;
  readonly profile: NonNullable<ReturnType<typeof resolveDirectProviderExecutionProfile>>;
  readonly accounts: readonly ExecutionAccount[];
  readonly evidenceContext: EvidenceContext;
}): ExecutionRouteEconomicsConfig {
  const account = input.accounts[0];
  if (!account) throw reject("TARGET_ECONOMICS_UNAVAILABLE", "review-economics", "No configured account economics are available.");
  const billingClass = billingClassOf(account);
  const priceEvidenceBase = {
    rateCardId: canonicalEconomicId(`${input.providerId}-${account.economics.quotaClassId}`),
    rateCardRevision: canonicalEconomicId(account.economics.capacityIdentity),
    evidence: {
      sourceIdentity: input.evidenceContext.sourceIdentity,
      sourceRevision: input.evidenceContext.sourceRevision,
      sourceDigest: input.evidenceContext.sourceDigest,
      observedAt: input.evidenceContext.observedAt,
      validUntil: input.evidenceContext.expiresAt,
      confidence: "high" as const,
      authority: "configured" as const,
    },
  };
  const priceEvidence = billingClass === "metered" || billingClass === "unknown"
    ? { kind: "unknown" as const, reason: "Configured account does not publish a durable per-call price.", ...priceEvidenceBase }
    : billingClass === "included"
      ? { kind: "included" as const, allowanceId: canonicalEconomicId(account.economics.quotaClassId), ...priceEvidenceBase }
      : billingClass === "free"
        ? { kind: "free" as const, ...priceEvidenceBase }
        : { kind: "subscription" as const, ...priceEvidenceBase };
  return {
    adapterCapabilityId: canonicalEconomicId(`adapter-${input.providerId}-${input.profile.executionMode}`),
    adapterCapabilityVersion: "profile-v1",
    authBillingChannel: canonicalEconomicId(`${input.providerId}-${billingClass}`),
    executionMode: input.profile.executionMode,
    serviceTier: "standard",
    rateCardBasis: canonicalEconomicId(account.economics.quotaClassId),
    envelopeSemantics: "provider-default",
    fallbackPosture: account.economics.creditPosture,
    overagePosture: account.economics.overagePosture,
    contextClass: "provider-default",
    cacheClass: "provider-managed",
    priceEvidence,
    auxiliaryCharges: [],
    executionEnvelope: { limits: [] },
  };
}

interface EvidenceContext {
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly sourceDigest: `sha256:${string}`;
  readonly observedAt: string;
  readonly expiresAt: string;
}

function createEvidenceContext(
  request: ExecutionTargetWizardRequest,
  admittedEvidence: ExecutionTargetWizardDiscoveryEvidence,
): EvidenceContext {
  const sourceDigest = sha256({
    request: request.discoveryIdentity,
    expectedRevision: request.expectedRevision,
    discoveryEvidenceIdentity: admittedEvidence.evidenceIdentity,
    discoveryEvidenceRevision: admittedEvidence.evidenceRevision,
    observedAt: admittedEvidence.catalogObservedAt,
    expiresAt: admittedEvidence.expiresAt,
  });
  return {
    sourceIdentity: canonicalEconomicId(`wizard-${sourceDigest.slice(7, 23)}`),
    sourceRevision: canonicalEconomicId(`config-${request.expectedRevision.slice(7, 23)}`),
    sourceDigest,
    observedAt: admittedEvidence.catalogObservedAt,
    expiresAt: admittedEvidence.expiresAt,
  };
}

function createCollisionSafeRouteId(request: ExecutionTargetWizardRequest, catalog: ExecutionCatalogInput): string {
  const base = `target-${slug(request.discoveryIdentity.providerId)}-${slug(request.discoveryIdentity.providerModelId)}-${sha256({
    identity: request.discoveryIdentity,
    expectedRevision: request.expectedRevision,
  }).slice(7, 17)}`;
  const used = new Set(catalog.routes.map((route) => route.id));
  if (!used.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw reject("TARGET_CREATE_REJECTED", "refresh-and-retry", "Unable to derive a collision-safe target identity.");
}

function sameIdentity(left: AvailableModelCatalogEntry, right: AvailableModelCatalogEntry | ExecutionTargetWizardRequest["discoveryIdentity"]): boolean {
  return left.providerId === right.providerId
    && left.providerRouteId === right.providerRouteId
    && left.providerModelId === right.providerModelId;
}

function isFuture(value: string, now: Date): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now.getTime();
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 72) || "model";
}

function canonicalEconomicId(value: string): string {
  const candidate = slug(value);
  return /^[A-Za-z0-9]/u.test(candidate) ? candidate : `id-${candidate}`;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function reject(code: TargetWizardRejectionCode, action: TargetWizardRepairAction, message: string): ExecutionTargetWizardAdmissionError {
  return new ExecutionTargetWizardAdmissionError(code, action, message);
}

function safeAdmissionMessage(error: unknown): string {
  return error instanceof ExecutionTargetWizardAdmissionError
    ? error.message
    : "The selected model could not be admitted with current configured evidence.";
}

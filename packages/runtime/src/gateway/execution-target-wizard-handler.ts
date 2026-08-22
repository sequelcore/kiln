import {
  ExecutionTargetWizardRequestSchema,
  type ExecutionRouteCatalog,
  type ExecutionTargetWizardProposal,
  type ExecutionTargetWizardRequest,
  type GuiInboundFrame,
  type GuiProviderModelCapabilities,
  type GuiProviderModelDiscoveryProjection,
  type GuiProviderModelRawEvidenceSummary,
} from "@kilnai/gateway-contracts";
import { createHash } from "node:crypto";
import { projectAvailableModelCatalogForExecutionRoutes } from "./available-model-catalog-projector.js";

type WizardResultFrame = Extract<GuiInboundFrame, { type: "execution_target_wizard_result" }>;
type ExecutionRoutesRefreshedFrame = Extract<GuiInboundFrame, { type: "execution_routes_refreshed" }>;
const DEFAULT_MANAGED_DISCOVERY_VALIDITY_MS = 365 * 24 * 60 * 60 * 1_000;

export interface ExecutionTargetWizardDiscoveryEvidence {
  readonly entry: import("@kilnai/gateway-contracts").AvailableModelCatalogEntry;
  readonly catalogObservedAt: string;
  readonly sourceObservedAt: string;
  readonly expiresAt: string;
  readonly evidenceIdentity: string;
  readonly evidenceRevision: `sha256:${string}`;
  readonly materialRevision: `sha256:${string}`;
  readonly rawEvidence: GuiProviderModelRawEvidenceSummary;
  readonly modelCapabilities?: GuiProviderModelCapabilities;
}

export type ExecutionTargetWizardApplicationResult =
  | {
      readonly status: "previewed";
      readonly proposal: ExecutionTargetWizardProposal;
      readonly message: string;
    }
  | {
      readonly status: "created" | "committed-refresh-failed";
      readonly proposal: ExecutionTargetWizardProposal;
      readonly revision: `sha256:${string}`;
    }
  | {
      readonly status: "rejected";
      readonly code: Extract<WizardResultFrame, { readonly status: "rejected" }>["code"];
      readonly action: Extract<WizardResultFrame, { readonly status: "rejected" }>["action"];
      readonly message: string;
      readonly diagnostics?: Extract<WizardResultFrame, { readonly status: "rejected" }>["diagnostics"];
      readonly proposal?: ExecutionTargetWizardProposal;
    };

export async function handleExecutionTargetWizard(input: {
  /** Existing GUI operator capability authentication; this is not a client-supplied claim. */
  readonly operatorAuthorized: boolean;
  readonly frame: unknown;
  readonly discovery: GuiProviderModelDiscoveryProjection;
  readonly executionRouteCatalog: ExecutionRouteCatalog;
  readonly runWizard?: (
    request: ExecutionTargetWizardRequest,
    evidence: ExecutionTargetWizardDiscoveryEvidence,
  ) => Promise<ExecutionTargetWizardApplicationResult>;
  readonly readExecutionRouteCatalog: () => Promise<ExecutionRouteCatalog>;
}): Promise<readonly (WizardResultFrame | ExecutionRoutesRefreshedFrame)[]> {
  if (input.operatorAuthorized !== true) {
    return [executionTargetWizardDeniedResult(input.frame)];
  }

  const requestCandidate = stripFrameType(input.frame);
  const parsed = ExecutionTargetWizardRequestSchema.safeParse(requestCandidate);
  if (!parsed.success || !input.runWizard) {
    return [executionTargetWizardDeniedResult(input.frame)];
  }

  const availableModels = projectAvailableModelCatalogForExecutionRoutes({
    discovery: input.discovery,
    executionRouteCatalog: input.executionRouteCatalog,
  });
  const entry = availableModels.entries.find((candidate) =>
    candidate.providerId === parsed.data.discoveryIdentity.providerId
    && candidate.providerRouteId === parsed.data.discoveryIdentity.providerRouteId
    && candidate.providerModelId === parsed.data.discoveryIdentity.providerModelId
  );
  if (!entry) {
    return [rejectedResult(parsed.data.requestId, {
      code: "TARGET_IDENTITY_CHANGED",
      action: "select-current-model",
      message: "The selected model no longer matches current discovery. Select a current model and retry.",
    })];
  }
  if (entry.discoveryState !== "observed") {
    return [rejectedResult(parsed.data.requestId, {
      code: "TARGET_DISCOVERY_STALE",
      action: "refresh-and-retry",
      message: "Current model discovery evidence is unavailable or stale. Refresh models and retry.",
    })];
  }
  if (entry.eligibilityState !== "eligible") {
    return [executionTargetWizardDeniedResult(input.frame)];
  }

  let evidence: ExecutionTargetWizardDiscoveryEvidence;
  try {
    evidence = executionTargetWizardDiscoveryEvidence(input.discovery, entry);
  } catch {
    return [rejectedResult(parsed.data.requestId, {
      code: "TARGET_DISCOVERY_STALE",
      action: "refresh-and-retry",
      message: "Current model discovery evidence expired. Refresh models and retry.",
    })];
  }

  try {
    const result = await input.runWizard(parsed.data, evidence);
    if (result.status === "previewed") {
      return [{
        type: "execution_target_wizard_result",
        requestId: parsed.data.requestId,
        status: "previewed",
        code: "EXECUTION_TARGET_PREVIEWED",
        action: "approve-and-apply",
        message: result.message,
        proposal: result.proposal,
      }];
    }
    if (result.status === "rejected") {
      return [rejectedResult(parsed.data.requestId, result)];
    }
    if (result.status === "committed-refresh-failed") {
      return [{
        type: "execution_target_wizard_result",
        requestId: parsed.data.requestId,
        status: "committed-refresh-failed",
        code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED",
        action: "refresh-catalog",
        message: "Execution target was committed, but refreshed route evidence is unavailable.",
        revision: result.revision,
        proposal: result.proposal,
      }];
    }

    let executionRouteCatalog: ExecutionRouteCatalog;
    try {
      executionRouteCatalog = await input.readExecutionRouteCatalog();
    } catch {
      return [{
        type: "execution_target_wizard_result",
        requestId: parsed.data.requestId,
        status: "committed-refresh-failed",
        code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED",
        action: "refresh-catalog",
        message: "Execution target was committed, but refreshed route evidence is unavailable.",
        revision: result.revision,
        proposal: result.proposal,
      }];
    }
    const refreshedAvailableModels = projectAvailableModelCatalogForExecutionRoutes({
      discovery: input.discovery,
      executionRouteCatalog,
    });
    return [
      {
        type: "execution_routes_refreshed",
        executionRouteCatalog,
        availableModels: refreshedAvailableModels,
      },
      {
        type: "execution_target_wizard_result",
        requestId: parsed.data.requestId,
        status: "created",
        code: "EXECUTION_TARGET_CREATED",
        action: "none",
        message: "Execution target created.",
        revision: result.revision,
        proposal: result.proposal,
        executionRouteCatalog,
        availableModels: refreshedAvailableModels,
      },
    ];
  } catch {
    return [rejectedResult(parsed.data.requestId, {
      code: "TARGET_CREATE_REJECTED",
      action: "refresh-and-retry",
      message: "Execution target creation was rejected. Refresh current evidence and retry.",
    })];
  }
}

export function executionTargetWizardDeniedResult(frame: unknown): WizardResultFrame {
  return rejectedResult(requestIdOf(frame), {
    code: "TARGET_CREATE_REJECTED",
    action: "select-current-model",
    message: "The selected model is not currently eligible for target creation.",
  });
}

export function executionTargetWizardDiscoveryEvidence(
  discovery: GuiProviderModelDiscoveryProjection,
  entry: import("@kilnai/gateway-contracts").AvailableModelCatalogEntry,
): ExecutionTargetWizardDiscoveryEvidence {
  const source = discovery.entries.find((candidate) =>
    candidate.providerRoute.providerId === entry.providerId
    && candidate.providerRoute.scope === entry.providerRouteId
    && candidate.providerRoute.providerModelId === entry.providerModelId
  );
  if (!source || source.freshness.status !== "fresh") {
    throw new Error("Execution target creation requires current discovery evidence.");
  }
  const observedAt = Date.parse(source.freshness.observedAt);
  const expiresAt = source.freshness.expiresAt
    ?? (Number.isFinite(observedAt)
      ? managedDiscoveryExpiresAt(observedAt)
      : undefined);
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
    throw new Error("Execution target creation requires current discovery evidence with a valid managed-evidence horizon.");
  }
  const evidenceIdentity = `${discovery.catalogEvidence.source.kind}:${discovery.catalogEvidence.source.id}`;
  const material = {
    evidenceIdentity,
    catalogSource: discovery.catalogEvidence.source,
    entry,
    expiresAt,
    rawEvidence: source.rawEvidence,
    credentialEvidence: source.credentialEvidence,
    entitlementEvidence: source.entitlementEvidence,
    routeHealth: source.routeHealth,
    policyAdmission: source.policyAdmission,
    eligibility: source.eligibility,
    modelCapabilities: source.modelCapabilities,
  };
  const stable = stableStringify({
    ...material,
    catalogEvidence: discovery.catalogEvidence,
    sourceObservedAt: source.freshness.observedAt,
  });
  return {
    entry,
    catalogObservedAt: discovery.catalogEvidence.observedAt,
    sourceObservedAt: source.freshness.observedAt,
    expiresAt,
    evidenceIdentity,
    evidenceRevision: `sha256:${createHash("sha256").update(stable).digest("hex")}`,
    materialRevision: `sha256:${createHash("sha256").update(stableStringify(material)).digest("hex")}`,
    rawEvidence: source.rawEvidence,
    ...(source.modelCapabilities ? { modelCapabilities: source.modelCapabilities } : {}),
  };
}

function managedDiscoveryExpiresAt(observedAt: number): string {
  const observed = new Date(observedAt);
  const dayStart = Date.UTC(observed.getUTCFullYear(), observed.getUTCMonth(), observed.getUTCDate());
  return new Date(dayStart + DEFAULT_MANAGED_DISCOVERY_VALIDITY_MS).toISOString();
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

function rejectedResult(
  requestId: string,
  result: Extract<ExecutionTargetWizardApplicationResult, { readonly status: "rejected" }> | {
    readonly code: Extract<WizardResultFrame, { readonly status: "rejected" }>["code"];
    readonly action: Extract<WizardResultFrame, { readonly status: "rejected" }>["action"];
    readonly message: string;
  },
): WizardResultFrame {
  return {
    type: "execution_target_wizard_result",
    requestId,
    status: "rejected",
    code: result.code,
    action: result.action,
    message: result.message,
    ...("diagnostics" in result && result.diagnostics ? { diagnostics: result.diagnostics } : {}),
    ...("proposal" in result && result.proposal ? { proposal: result.proposal } : {}),
  };
}

function stripFrameType(frame: unknown): unknown {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return frame;
  const { type: _type, ...request } = frame as Record<string, unknown>;
  return request;
}

function requestIdOf(frame: unknown): string {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return "unknown";
  const requestId = (frame as Record<string, unknown>).requestId;
  return typeof requestId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(requestId)
    ? requestId
    : "unknown";
}

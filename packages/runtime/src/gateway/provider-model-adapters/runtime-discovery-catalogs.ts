import type {
  GuiProviderAuthState,
  GuiProviderDiscoveryStatus,
} from "@kilnai/gateway-contracts";
import {
  normalizeProviderCatalogObservation,
  type NormalizedProviderCatalogObservation,
  type ProviderCatalogObservationStatus,
  type ProviderCatalogStateEvidenceInput,
} from "./catalog-normalization.js";
import type { ProviderModelEvidenceFreshness } from "@kilnai/core";

export type RuntimeProviderAdapterFamily =
  | "claude-harness"
  | "codex-harness"
  | "opencode-harness"
  | "opencode-service"
  | "direct-provider"
  | "openrouter"
  | "local-provider";

export interface RuntimeProviderModelDiscoverySnapshot {
  readonly models: readonly string[];
  readonly status: GuiProviderDiscoveryStatus;
  readonly reason: string;
  readonly authState: GuiProviderAuthState;
}

export interface RuntimeProviderCatalogInput {
  readonly providerId: string;
  readonly family: RuntimeProviderAdapterFamily;
  readonly discovery: RuntimeProviderModelDiscoverySnapshot;
  readonly observedAt: string;
  readonly freshness: ProviderModelEvidenceFreshness;
  readonly sourceVersion?: string;
  readonly harnessId?: string;
  readonly reportedProviderId?: string;
}

export function normalizeRuntimeProviderDiscoveryCatalog(
  input: RuntimeProviderCatalogInput,
): NormalizedProviderCatalogObservation {
  const sourceId = `${input.family}:${input.providerId}:models`;
  return normalizeProviderCatalogObservation({
    providerId: input.providerId,
    ...(input.harnessId && input.reportedProviderId
      ? { harness: { harnessId: input.harnessId, reportedProviderId: input.reportedProviderId } }
      : {}),
    source: {
      kind: "runtime-adapter",
      id: sourceId,
      ...(input.sourceVersion ? { version: input.sourceVersion } : {}),
    },
    observedAt: input.observedAt,
    freshness: input.freshness,
    status: mapDiscoveryStatus(input.discovery.status),
    entries: input.discovery.models.map((model) => ({
      rawId: model,
      providerModelId: model,
      scope: input.family,
      normalizedFamily: normalizedFamily(model),
      aliases: [model],
      metadata: {
        adapterFamily: input.family,
        discoveryStatus: input.discovery.status,
      },
    })),
    failures: input.discovery.status === "available"
      ? []
      : [{
          classification: input.discovery.status,
          summary: input.discovery.reason,
          retryable: isRetryableDiscoveryStatus(input.discovery.status),
        }],
    stateEvidence: [
      authenticationEvidence(input.discovery.authState),
      ...interactiveSelectionEvidence(input),
    ],
  });
}

function mapDiscoveryStatus(status: GuiProviderDiscoveryStatus): ProviderCatalogObservationStatus {
  switch (status) {
    case "available":
      return "available";
    case "empty_model_list":
      return "partial";
    case "endpoint_timeout":
    case "endpoint_error":
      return "failed";
    case "auth_expired":
    case "cli_missing":
    case "daemon_unreachable":
    case "missing_auth":
    case "model_selection_not_required":
    case "model_version_unsupported":
    case "stale":
      return "unavailable";
  }
}

function authenticationEvidence(authState: GuiProviderAuthState): ProviderCatalogStateEvidenceInput {
  switch (authState) {
    case "authenticated":
      return { state: "authenticated", value: "confirmed", authority: "runtime-observed" };
    case "expired":
    case "missing":
      return { state: "authenticated", value: "denied", authority: "runtime-observed" };
    case "not_required":
      return { state: "authenticated", value: "not-required", authority: "runtime-observed" };
    case "unknown":
      return { state: "authenticated", value: "unknown", authority: "runtime-observed" };
  }
}

function interactiveSelectionEvidence(input: RuntimeProviderCatalogInput): ProviderCatalogStateEvidenceInput[] {
  if (input.discovery.status !== "available") {
    return [];
  }
  const evidence: ProviderCatalogStateEvidenceInput[] = [
    {
      state: "policyAdmitted",
      value: "confirmed",
      authority: "runtime-observed",
      provenance: `${input.family}:${input.providerId}:interactive-policy`,
    },
    {
      state: "routeHealthy",
      value: "confirmed",
      authority: "runtime-observed",
      provenance: `${input.family}:${input.providerId}:catalog-health`,
    },
  ];
  if (isAccountScopedEntitlementCatalog(input)) {
    evidence.push({
      state: "entitled",
      value: "confirmed",
      authority: "provider-authoritative",
      provenance: `${input.family}:${input.providerId}:account-model-entitlement`,
    });
    evidence.push({
      state: "selectable",
      value: "confirmed",
      authority: "runtime-observed",
      provenance: `${input.family}:${input.providerId}:interactive-selectable`,
    });
  }
  return evidence;
}

function isAccountScopedEntitlementCatalog(input: RuntimeProviderCatalogInput): boolean {
  if (input.discovery.authState !== "authenticated") {
    return false;
  }
  if (input.family === "opencode-service") {
    return true;
  }
  if (input.family !== "direct-provider") {
    return false;
  }
  return input.providerId === "codex-oauth"
    || input.providerId === "anthropic"
    || input.providerId === "deepseek"
    || input.providerId === "openai";
}

function isRetryableDiscoveryStatus(status: GuiProviderDiscoveryStatus): boolean {
  return status === "endpoint_error" || status === "endpoint_timeout" || status === "daemon_unreachable";
}

function normalizedFamily(model: string): string {
  const trimmed = model.trim();
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? trimmed;
}

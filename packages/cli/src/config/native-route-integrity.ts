import type { ResolvedKilnConfig } from "../kiln-yaml-types.js";
import type { HarnessIntegrationId } from "./harness-integration-capabilities.js";
import { encodeNativeAgentModel } from "./harness-integration-capabilities.js";

export interface NativeRoute {
  readonly providerId: string;
  readonly model: string;
}

export type NativeDefaultRouteProjectionStatus =
  | "project"
  | "remove-stale"
  | "missing-default"
  | "unsupported";

export interface NativeDefaultRouteProjection {
  readonly status: NativeDefaultRouteProjectionStatus;
  readonly canonicalRoute?: NativeRoute;
  readonly nativeModel?: string;
  readonly managedFields: readonly string[];
  readonly reason?: string;
}

export type NativeRouteCatalogStatus =
  | "available"
  | "authentication-failed"
  | "authorization-failed"
  | "unknown-model"
  | "unavailable-route"
  | "stale-catalog"
  | "disabled-provider"
  | "missing-default"
  | "not-observable";

export interface NativeRouteCatalogEvidence {
  readonly status: NativeRouteCatalogStatus;
  readonly providerId?: string;
  readonly model?: string;
  readonly reason?: string;
}

export type NativeRouteProbeStatus =
  | "succeeded"
  | "authentication-failed"
  | "authorization-failed"
  | "unknown-model"
  | "unavailable-route"
  | "timeout"
  | "not-run";

export interface NativeRouteProbeEvidence {
  readonly status: NativeRouteProbeStatus;
  readonly credentialSource: "env" | "kiln-auth-store" | "native-auth-store" | "none" | "unknown";
  readonly reason?: string;
}

export type NativeRouteIntegrityClassification =
  | "ok"
  | "authentication-failure"
  | "authorization-failure"
  | "unknown-model"
  | "unavailable-route"
  | "stale-catalog"
  | "projection-drift"
  | "ambient-fallback-mismatch"
  | "missing-default"
  | "unsupported-proof"
  | "transient";

export interface NativeRouteIntegrityInput {
  readonly harness: HarnessIntegrationId;
  readonly canonicalRoute?: NativeRoute;
  readonly nativeConfiguredDefault?: NativeRoute;
  readonly selectedRuntimeRoute?: NativeRoute;
  readonly explicitProbe: NativeRouteProbeEvidence;
  readonly catalogStatus: NativeRouteCatalogEvidence;
  readonly projectionDrift?: boolean;
  readonly bareProofSupported?: boolean;
  readonly observedError?: {
    readonly message?: string;
  };
}

export interface NativeRouteIntegrityDiagnostic {
  readonly harness: HarnessIntegrationId;
  readonly classification: NativeRouteIntegrityClassification;
  readonly credentialStatus: "valid" | "invalid" | "unauthorized" | "not-tested" | "unknown";
  readonly routeStatus:
    | "matches-canonical"
    | "native-default-invalid"
    | "missing-default"
    | "unavailable"
    | "unknown-model"
    | "stale-catalog"
    | "drifted"
    | "unsupported-proof"
    | "unknown";
  readonly canonicalRoute?: NativeRoute;
  readonly nativeConfiguredDefault?: NativeRoute;
  readonly selectedRuntimeRoute?: NativeRoute;
  readonly catalogStatus: NativeRouteCatalogEvidence;
  readonly explicitProbeStatus: NativeRouteProbeStatus;
  readonly credentialSource: NativeRouteProbeEvidence["credentialSource"];
  readonly bareProofSupported: boolean;
  readonly message: string;
}

export function resolveNativeDefaultRouteProjection(
  harness: HarnessIntegrationId,
  kilnYaml: ResolvedKilnConfig,
): NativeDefaultRouteProjection {
  const providerId = kilnYaml.provider?.trim();
  const model = kilnYaml.model?.default?.trim();
  const managedFields = ["model"];

  if (!providerId) {
    return {
      status: "unsupported",
      managedFields: [],
      reason: "canonical provider is missing",
    };
  }
  if (!model) {
    return {
      status: "missing-default",
      canonicalRoute: { providerId, model: "" },
      managedFields,
      reason: "canonical model is missing",
    };
  }

  const nativeModel = nativeModelForHarness(harness, providerId, model);
  if (nativeModel) {
    return {
      status: "project",
      canonicalRoute: { providerId, model },
      nativeModel,
      managedFields,
    };
  }

  return {
    status: harness === "claude" ? "unsupported" : "remove-stale",
    canonicalRoute: { providerId, model },
    managedFields,
    reason: `provider '${providerId}' is not a native default route for ${harness}`,
  };
}

export function classifyNativeRouteIntegrity(
  input: NativeRouteIntegrityInput,
): NativeRouteIntegrityDiagnostic {
  const catalog = input.catalogStatus.status;
  const explicit = input.explicitProbe.status;
  const selectedDiffers = !sameRoute(input.selectedRuntimeRoute, input.canonicalRoute);
  const nativeDefaultDiffers = !sameRoute(input.nativeConfiguredDefault, input.canonicalRoute);

  if (input.projectionDrift) {
    return diagnostic(input, "projection-drift", "unknown", "drifted", "Native projection drift changed a managed route field.");
  }
  if (!input.canonicalRoute || catalog === "missing-default") {
    return diagnostic(input, "missing-default", "not-tested", "missing-default", "Canonical routing is missing a provider/model default.");
  }
  if (catalog === "disabled-provider" || catalog === "unavailable-route") {
    return diagnostic(input, "unavailable-route", "not-tested", "unavailable", `Route ${formatRoute(input.canonicalRoute)} is unavailable before credential probing.`);
  }
  if (catalog === "stale-catalog") {
    return diagnostic(input, "stale-catalog", credentialStatus(explicit), "stale-catalog", `Provider catalog for ${formatRoute(input.canonicalRoute)} is stale.`);
  }
  if (catalog === "unknown-model") {
    const staleRoute = input.selectedRuntimeRoute ?? input.nativeConfiguredDefault ?? routeFromCatalog(input.catalogStatus);
    if (explicit === "succeeded" && staleRoute && !sameRoute(staleRoute, input.canonicalRoute)) {
      return diagnostic(
        input,
        "ambient-fallback-mismatch",
        "valid",
        "native-default-invalid",
        `Explicit probe succeeded for ${formatRoute(input.canonicalRoute)}, but native default selected ${formatRoute(staleRoute)}.`,
      );
    }
    return diagnostic(input, "unknown-model", credentialStatus(explicit), "unknown-model", `Model ${input.catalogStatus.model ?? input.canonicalRoute.model} is not in the provider catalog.`);
  }
  if (explicit === "authentication-failed") {
    return diagnostic(input, "authentication-failure", "invalid", routeMatchStatus(input), "Credential was rejected for a catalog-valid route.");
  }
  if (explicit === "authorization-failed") {
    return diagnostic(input, "authorization-failure", "unauthorized", routeMatchStatus(input), "Credential is authenticated but not authorized for the selected route.");
  }
  if (explicit === "timeout") {
    return diagnostic(input, "transient", "unknown", routeMatchStatus(input), "Route probe timed out before credential status could be confirmed.");
  }
  if (input.bareProofSupported === false && !input.nativeConfiguredDefault && !input.selectedRuntimeRoute) {
    return diagnostic(input, "unsupported-proof", credentialStatus(explicit), "unsupported-proof", "Bare native route proof is unsupported for this harness.");
  }
  if (selectedDiffers || nativeDefaultDiffers) {
    const staleRoute = input.selectedRuntimeRoute ?? input.nativeConfiguredDefault;
    return diagnostic(
      input,
      "ambient-fallback-mismatch",
      credentialStatus(explicit),
      "native-default-invalid",
      staleRoute
        ? `Native default selected ${formatRoute(staleRoute)} instead of canonical route ${formatRoute(input.canonicalRoute)}.`
        : `Native default does not match canonical route ${formatRoute(input.canonicalRoute)}.`,
    );
  }
  return diagnostic(input, "ok", credentialStatus(explicit), "matches-canonical", `Native route matches ${formatRoute(input.canonicalRoute)}.`);
}

function nativeModelForHarness(harness: HarnessIntegrationId, providerId: string, model: string): string | undefined {
  if (harness === "codex") {
    return providerId === "codex" || providerId === "codex-oauth" ? model : undefined;
  }
  if (harness === "opencode") {
    if (providerId === "opencode") return model;
    return encodeNativeAgentModel("opencode", providerId, model);
  }
  return undefined;
}

function diagnostic(
  input: NativeRouteIntegrityInput,
  classification: NativeRouteIntegrityClassification,
  credentialStatusValue: NativeRouteIntegrityDiagnostic["credentialStatus"],
  routeStatus: NativeRouteIntegrityDiagnostic["routeStatus"],
  message: string,
): NativeRouteIntegrityDiagnostic {
  return {
    harness: input.harness,
    classification,
    credentialStatus: credentialStatusValue,
    routeStatus,
    ...(input.canonicalRoute ? { canonicalRoute: input.canonicalRoute } : {}),
    ...(input.nativeConfiguredDefault ? { nativeConfiguredDefault: input.nativeConfiguredDefault } : {}),
    ...(input.selectedRuntimeRoute ? { selectedRuntimeRoute: input.selectedRuntimeRoute } : {}),
    catalogStatus: input.catalogStatus,
    explicitProbeStatus: input.explicitProbe.status,
    credentialSource: input.explicitProbe.credentialSource,
    bareProofSupported: input.bareProofSupported !== false,
    message,
  };
}

function credentialStatus(status: NativeRouteProbeStatus): NativeRouteIntegrityDiagnostic["credentialStatus"] {
  switch (status) {
    case "succeeded":
      return "valid";
    case "authentication-failed":
      return "invalid";
    case "authorization-failed":
      return "unauthorized";
    case "not-run":
      return "not-tested";
    default:
      return "unknown";
  }
}

function routeMatchStatus(input: NativeRouteIntegrityInput): NativeRouteIntegrityDiagnostic["routeStatus"] {
  if (!input.canonicalRoute) return "missing-default";
  if (sameRoute(input.selectedRuntimeRoute ?? input.nativeConfiguredDefault, input.canonicalRoute)) {
    return "matches-canonical";
  }
  return input.selectedRuntimeRoute || input.nativeConfiguredDefault ? "native-default-invalid" : "unknown";
}

function routeFromCatalog(catalog: NativeRouteCatalogEvidence): NativeRoute | undefined {
  return catalog.providerId && catalog.model
    ? { providerId: catalog.providerId, model: catalog.model }
    : undefined;
}

function sameRoute(left: NativeRoute | undefined, right: NativeRoute | undefined): boolean {
  if (!left || !right) return left === right;
  return left.providerId === right.providerId && left.model === right.model;
}

function formatRoute(route: NativeRoute): string {
  return `${route.providerId}/${route.model}`;
}

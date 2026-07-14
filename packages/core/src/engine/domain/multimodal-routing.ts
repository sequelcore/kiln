import type { Modality } from "./modality.js";

export type MultimodalTransportModality = Modality | "document" | "screenshot";
export type MultimodalCapability =
  | "vision"
  | "document"
  | "audio"
  | "screenshot-review"
  | "transcription"
  | "speech-synthesis";

export interface MultimodalChecksum {
  readonly algorithm: "sha256";
  readonly value: string;
}

export interface MultimodalArtifactSource {
  readonly kind:
    | "local-file"
    | "uploaded-file"
    | "webhook-attachment"
    | "tool-output"
    | "managed-child"
    | "generated-screenshot"
    | "transform-output";
  readonly id: string;
}

export interface MultimodalArtifactRetention {
  readonly scope: "session" | "verification";
  readonly maxArtifacts?: number;
}

export interface MultimodalReplayReference {
  readonly uri: string;
}

export interface MultimodalDimensions {
  readonly width: number;
  readonly height: number;
}

export interface MultimodalArtifact {
  readonly uri: string;
  readonly modality: MultimodalTransportModality;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: MultimodalChecksum;
  readonly source: MultimodalArtifactSource;
  readonly retention: MultimodalArtifactRetention;
  readonly replay: MultimodalReplayReference;
  readonly dimensions?: MultimodalDimensions;
  readonly durationMs?: number;
}

export interface ProviderModalityConstraints {
  readonly supportsBase64: boolean;
  readonly supportsUrl: boolean;
  readonly supportsDocuments: boolean;
  readonly maxInputArtifacts?: number;
  readonly maxBytesPerArtifact?: number;
}

export interface ProviderModalityCapabilities {
  readonly provider: string;
  readonly model: string;
  readonly supportedCapabilities: readonly MultimodalCapability[];
  readonly inputModalities: readonly MultimodalTransportModality[];
  readonly outputModalities: readonly MultimodalTransportModality[];
  readonly toolResultModalities: readonly MultimodalTransportModality[];
  readonly constraints: ProviderModalityConstraints;
  readonly degradationBehavior: readonly string[];
}

export interface AuxiliaryModalityRoute {
  readonly routeId: string;
  readonly provider: string;
  readonly model: string;
  readonly agentProfile?: string;
  readonly authorityProfileId: string;
  readonly routeHealth: MultimodalRouteHealth;
  readonly capabilities: ProviderModalityCapabilities;
}

export interface MultimodalRouteHealth {
  readonly status: "healthy" | "unhealthy";
  readonly evidence: string;
}

export interface MultimodalTransformCandidate {
  readonly transform: "ocr" | "document-extraction" | "thumbnail" | "downsample" | "transcription";
  readonly sourceModalities: readonly MultimodalTransportModality[];
  readonly outputModality: MultimodalTransportModality;
  readonly available: boolean;
  readonly provenance: string;
  readonly degradation: string;
}

export interface MultimodalRoutingPolicy {
  readonly allowNative: boolean;
  readonly allowDelegation: boolean;
  readonly allowTransforms: boolean;
}

export interface MultimodalRoutingRequest {
  readonly requestedCapability: MultimodalCapability;
  readonly requiredInputModalities: readonly MultimodalTransportModality[];
  readonly artifacts: readonly MultimodalArtifact[];
  readonly activeRoute: ProviderModalityCapabilities;
  readonly policy: MultimodalRoutingPolicy;
  readonly auxiliaryRoutes?: readonly AuxiliaryModalityRoute[];
  readonly transforms?: readonly MultimodalTransformCandidate[];
}

export type MultimodalRoutingStrategy = "native" | "delegated" | "transform" | "unsupported";
export type MultimodalDiagnosticSeverity = "info" | "warning" | "error";

export interface MultimodalRoutingDiagnostic {
  readonly code: string;
  readonly severity: MultimodalDiagnosticSeverity;
  readonly message: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface MultimodalRoutingReason {
  readonly code: string;
  readonly message: string;
}

export interface NativeMultimodalRouteEvidence {
  readonly provider: string;
  readonly model: string;
  readonly serializedModalities: readonly MultimodalTransportModality[];
}

export interface MultimodalDelegationEvidence {
  readonly routeId: string;
  readonly provider: string;
  readonly model: string;
  readonly agentProfile?: string;
  readonly authorityProfileId: string;
  readonly routeHealth: MultimodalRouteHealth;
  readonly policyDecision: MultimodalDelegationPolicyDecision;
  readonly costBudgetDecision: MultimodalDelegationCostBudgetDecision;
  readonly expectedResult: MultimodalDelegationExpectedResult;
  readonly uncertainty: MultimodalDelegationUncertainty;
  readonly artifactUris: readonly string[];
  readonly requestedCapability: MultimodalCapability;
}

export interface MultimodalDelegationPolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface MultimodalDelegationCostBudgetDecision {
  readonly status: "not-evaluated" | "within-budget" | "denied";
  readonly evidence: string;
}

export interface MultimodalDelegationExpectedResult {
  readonly format: "structured-handoff";
  readonly requiredFields: readonly string[];
}

export interface MultimodalDelegationUncertainty {
  readonly level: "unknown" | "low" | "medium" | "high";
  readonly limitations: readonly string[];
}

export interface MultimodalTransformEvidence {
  readonly transform: MultimodalTransformCandidate["transform"];
  readonly sourceArtifactUris: readonly string[];
  readonly outputModality: MultimodalTransportModality;
  readonly provenance: string;
  readonly degradation: string;
}

export interface MultimodalRoutingDecision {
  readonly strategy: MultimodalRoutingStrategy;
  readonly reason: MultimodalRoutingReason;
  readonly diagnostics: readonly MultimodalRoutingDiagnostic[];
  readonly native?: NativeMultimodalRouteEvidence;
  readonly delegation?: MultimodalDelegationEvidence;
  readonly transform?: MultimodalTransformEvidence;
}

export function planMultimodalRoute(request: MultimodalRoutingRequest): MultimodalRoutingDecision {
  const diagnostics: MultimodalRoutingDiagnostic[] = [];

  if (request.policy.allowNative && routeSupportsRequest(request.activeRoute, request)) {
    return {
      strategy: "native",
      reason: {
        code: "native_supported",
        message: "The active provider/model can accept the required modality.",
      },
      diagnostics,
      native: {
        provider: request.activeRoute.provider,
        model: request.activeRoute.model,
        serializedModalities: effectiveRequiredInputModalities(request),
      },
    };
  }
  diagnostics.push(nativeDiagnostic(request));

  if (request.policy.allowDelegation) {
    const delegatedRoute = (request.auxiliaryRoutes ?? []).find((route) =>
      route.routeHealth.status === "healthy" && routeSupportsRequest(route.capabilities, request)
    );
    if (delegatedRoute) {
      return {
        strategy: "delegated",
        reason: {
          code: "delegation_route_available",
          message: "A managed auxiliary route can accept the required modality.",
        },
        diagnostics,
        delegation: {
          routeId: delegatedRoute.routeId,
          provider: delegatedRoute.provider,
          model: delegatedRoute.model,
          ...(delegatedRoute.agentProfile !== undefined ? { agentProfile: delegatedRoute.agentProfile } : {}),
          authorityProfileId: delegatedRoute.authorityProfileId,
          routeHealth: delegatedRoute.routeHealth,
          policyDecision: {
            allowed: true,
            reason: "Managed auxiliary delegation is allowed by policy.",
          },
          costBudgetDecision: {
            status: "not-evaluated",
            evidence: "No cost budget input was provided to the modality planner.",
          },
          expectedResult: {
            format: "structured-handoff",
            requiredFields: ["summary", "artifactUris", "uncertainty", "limitations"],
          },
          uncertainty: {
            level: "unknown",
            limitations: ["Auxiliary route has not executed yet."],
          },
          artifactUris: request.artifacts.map((artifact) => artifact.uri),
          requestedCapability: request.requestedCapability,
        },
      };
    }
  }
  diagnostics.push(delegationDiagnostic(request));

  if (request.policy.allowTransforms) {
    const transformSourceArtifacts = artifactsRequiringTransform(request);
    const transformSourceModalities = uniqueModalities(transformSourceArtifacts);
    const transform = (request.transforms ?? []).find((candidate) =>
      candidate.available
      && transformSourceModalities.length > 0
      && includesAll(candidate.sourceModalities, transformSourceModalities)
      && request.activeRoute.inputModalities.includes(candidate.outputModality)
    );
    if (transform) {
      return {
        strategy: "transform",
        reason: {
          code: "transform_available",
          message: "A governed transform can produce a modality accepted by the active route.",
        },
        diagnostics,
        transform: {
          transform: transform.transform,
          sourceArtifactUris: transformSourceArtifacts.map((artifact) => artifact.uri),
          outputModality: transform.outputModality,
          provenance: transform.provenance,
          degradation: transform.degradation,
        },
      };
    }
  }
  diagnostics.push(transformDiagnostic(request));

  return {
    strategy: "unsupported",
    reason: {
      code: "unsupported_modality",
      message: "No governed native, delegated, or transform route can satisfy the requested modality.",
    },
    diagnostics,
  };
}

function routeSupportsRequest(
  capabilities: ProviderModalityCapabilities,
  request: MultimodalRoutingRequest,
): boolean {
  return routeSupportFailure(capabilities, request) === undefined;
}

function routeSupportFailure(
  capabilities: ProviderModalityCapabilities,
  request: MultimodalRoutingRequest,
): string | undefined {
  if (!capabilities.supportedCapabilities.includes(request.requestedCapability)) {
    return "missing_capability";
  }
  const requiredInputModalities = effectiveRequiredInputModalities(request);
  if (!includesAll(capabilities.inputModalities, requiredInputModalities)) {
    return "missing_modality";
  }
  if (!capabilities.outputModalities.includes(outputModalityForCapability(request.requestedCapability))) {
    return "missing_output_modality";
  }
  const toolResultModalities = uniqueModalities(request.artifacts.filter(isToolResultLikeArtifact));
  if (toolResultModalities.length > 0
    && !includesAll(capabilities.toolResultModalities, toolResultModalities)) {
    return "missing_tool_result_modality";
  }
  if (capabilities.constraints.maxInputArtifacts !== undefined
    && request.artifacts.length > capabilities.constraints.maxInputArtifacts) {
    return "input_artifact_limit_exceeded";
  }
  if (capabilities.constraints.maxBytesPerArtifact !== undefined
    && request.artifacts.some((artifact) => artifact.sizeBytes > capabilities.constraints.maxBytesPerArtifact!)) {
    return "artifact_size_limit_exceeded";
  }
  if (requiredInputModalities.includes("document") && !capabilities.constraints.supportsDocuments) {
    return "document_unsupported";
  }
  return undefined;
}

function effectiveRequiredInputModalities(request: MultimodalRoutingRequest): readonly MultimodalTransportModality[] {
  return [...new Set([
    ...request.requiredInputModalities,
    ...request.artifacts.map((artifact) => artifact.modality),
  ])];
}

function outputModalityForCapability(capability: MultimodalCapability): MultimodalTransportModality {
  switch (capability) {
    case "audio":
    case "speech-synthesis":
      return "audio";
    case "document":
    case "screenshot-review":
    case "transcription":
    case "vision":
      return "text";
  }
}

function isToolResultLikeArtifact(artifact: MultimodalArtifact): boolean {
  return artifact.source.kind === "tool-output"
    || artifact.source.kind === "managed-child"
    || artifact.source.kind === "generated-screenshot"
    || artifact.source.kind === "transform-output";
}

function artifactsRequiringTransform(request: MultimodalRoutingRequest): readonly MultimodalArtifact[] {
  return request.artifacts.filter((artifact) => artifactRequiresTransform(artifact, request));
}

function artifactRequiresTransform(
  artifact: MultimodalArtifact,
  request: MultimodalRoutingRequest,
): boolean {
  if (!request.activeRoute.inputModalities.includes(artifact.modality)) {
    return true;
  }
  if (request.activeRoute.constraints.maxBytesPerArtifact !== undefined
    && artifact.sizeBytes > request.activeRoute.constraints.maxBytesPerArtifact) {
    return true;
  }
  if (artifact.modality === "document" && !request.activeRoute.constraints.supportsDocuments) {
    return true;
  }
  if (isToolResultLikeArtifact(artifact)
    && !request.activeRoute.toolResultModalities.includes(artifact.modality)) {
    return true;
  }
  return false;
}

function uniqueModalities(artifacts: readonly MultimodalArtifact[]): readonly MultimodalTransportModality[] {
  return [...new Set(artifacts.map((artifact) => artifact.modality))];
}

function includesAll(
  available: readonly MultimodalTransportModality[],
  required: readonly MultimodalTransportModality[],
): boolean {
  return required.every((modality) => available.includes(modality));
}

function nativeDiagnostic(request: MultimodalRoutingRequest): MultimodalRoutingDiagnostic {
  if (!request.policy.allowNative) {
    return {
      code: "native_route_disallowed",
      severity: "info",
      message: "Native multimodal handling is disabled by policy.",
      provider: request.activeRoute.provider,
      model: request.activeRoute.model,
    };
  }
  const failure = routeSupportFailure(request.activeRoute, request);
  if (failure === "missing_capability") {
    return {
      code: "native_route_missing_capability",
      severity: "info",
      message: "The active provider/model cannot satisfy the requested multimodal capability.",
      provider: request.activeRoute.provider,
      model: request.activeRoute.model,
    };
  }
  if (failure === "missing_output_modality") {
    return {
      code: "native_route_missing_output_modality",
      severity: "info",
      message: "The active provider/model cannot emit the modality required by the requested capability.",
      provider: request.activeRoute.provider,
      model: request.activeRoute.model,
    };
  }
  if (failure === "missing_tool_result_modality") {
    return {
      code: "native_route_missing_tool_result_modality",
      severity: "info",
      message: "The active provider/model cannot accept this modality from tool-result history.",
      provider: request.activeRoute.provider,
      model: request.activeRoute.model,
    };
  }
  if (failure === "document_unsupported") {
    return {
      code: "native_route_document_unsupported",
      severity: "info",
      message: "The active provider/model is not admitted for document artifacts.",
      provider: request.activeRoute.provider,
      model: request.activeRoute.model,
    };
  }
  return {
    code: "native_route_missing_modality",
    severity: "info",
    message: "The active provider/model cannot accept the required modality.",
    provider: request.activeRoute.provider,
    model: request.activeRoute.model,
  };
}

function delegationDiagnostic(request: MultimodalRoutingRequest): MultimodalRoutingDiagnostic {
  if (!request.policy.allowDelegation) {
    return {
      code: "delegation_route_disallowed",
      severity: "info",
      message: "Managed auxiliary delegation is disabled by policy.",
    };
  }
  return {
    code: "delegation_route_unavailable",
    severity: "info",
    message: "No healthy managed auxiliary route can accept the required modality.",
  };
}

function transformDiagnostic(request: MultimodalRoutingRequest): MultimodalRoutingDiagnostic {
  if (!request.policy.allowTransforms) {
    return {
      code: "transform_disallowed",
      severity: "info",
      message: "Multimodal transforms are disabled by policy.",
    };
  }
  return {
    code: "transform_unavailable",
    severity: "info",
    message: "No governed transform can produce a modality accepted by the active route.",
  };
}

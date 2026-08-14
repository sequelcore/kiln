import {
  ExecutionRouteCreationRequestSchema,
  type ExecutionRouteCatalog,
  type ExecutionRouteCreationRequest,
  type GuiInboundFrame,
  type GuiProviderModelDiscoveryProjection,
} from "@kilnai/gateway-contracts";
import { createHash } from "node:crypto";
import { projectAvailableModelCatalogForExecutionRoutes } from "./available-model-catalog-projector.js";

type ExecutionRouteCreateResultFrame = Extract<GuiInboundFrame, { type: "execution_route_create_result" }>;
type ExecutionRoutesRefreshedFrame = Extract<GuiInboundFrame, { type: "execution_routes_refreshed" }>;
export interface ExecutionRouteCreationDiscoveryEvidence {
  readonly entry: import("@kilnai/gateway-contracts").AvailableModelCatalogEntry;
  readonly catalogObservedAt: string;
  readonly evidenceIdentity: string;
  readonly evidenceRevision: `sha256:${string}`;
}

export async function handleExecutionRouteCreate(input: {
  /** Existing GUI operator capability authentication; this is not a client-supplied claim. */
  readonly operatorAuthorized: boolean;
  readonly frame: unknown;
  readonly discovery: GuiProviderModelDiscoveryProjection;
  readonly executionRouteCatalog: ExecutionRouteCatalog;
  readonly createExecutionRoute?: (request: ExecutionRouteCreationRequest, evidence: ExecutionRouteCreationDiscoveryEvidence) => Promise<{ readonly status: "created" | "committed-refresh-failed"; readonly revision: string }>;
  readonly readExecutionRouteCatalog: () => Promise<ExecutionRouteCatalog>;
}): Promise<readonly (ExecutionRouteCreateResultFrame | ExecutionRoutesRefreshedFrame)[]> {
  if (input.operatorAuthorized !== true) {
    return [executionRouteCreateDeniedResult(input.frame)];
  }
  const requestCandidate = stripFrameType(input.frame);
  const parsed = ExecutionRouteCreationRequestSchema.safeParse(requestCandidate);
  const entry = parsed.success
    ? projectAvailableModelCatalogForExecutionRoutes({
        discovery: input.discovery,
        executionRouteCatalog: input.executionRouteCatalog,
      }).entries.find((candidate) => candidate.providerId === parsed.data.discoveryIdentity.providerId
        && candidate.providerRouteId === parsed.data.discoveryIdentity.providerRouteId
        && candidate.providerModelId === parsed.data.discoveryIdentity.providerModelId)
    : undefined;

  if (!parsed.success || !entry || entry.discoveryState !== "observed"
    || entry.eligibilityState !== "eligible" || !input.createExecutionRoute) {
    return [executionRouteCreateDeniedResult(input.frame)];
  }

  try {
    const result = await input.createExecutionRoute(parsed.data, executionRouteCreationDiscoveryEvidence(input.discovery, entry));
    if (result.status === "committed-refresh-failed") {
      return [{
        type: "execution_route_create_result",
        requestId: parsed.data.requestId,
        status: "committed-refresh-failed",
        code: "EXECUTION_ROUTE_COMMITTED_REFRESH_FAILED",
        message: "Execution route was committed, but refreshed route evidence is unavailable.",
        revision: result.revision,
      }];
    }
    const executionRouteCatalog = await input.readExecutionRouteCatalog();
    const availableModels = projectAvailableModelCatalogForExecutionRoutes({
      discovery: input.discovery,
      executionRouteCatalog,
    });
    return [
      { type: "execution_routes_refreshed", executionRouteCatalog, availableModels },
      {
        type: "execution_route_create_result",
        requestId: parsed.data.requestId,
        status: "created",
        code: "EXECUTION_ROUTE_CREATED",
        message: "Execution route created.",
        revision: result.revision,
        executionRouteCatalog,
        availableModels,
      },
    ];
  } catch {
    const refreshed = await input.readExecutionRouteCatalog().then((executionRouteCatalog) => ({
      executionRouteCatalog,
      availableModels: projectAvailableModelCatalogForExecutionRoutes({ discovery: input.discovery, executionRouteCatalog }),
    })).catch(() => undefined);
    return [
      ...(refreshed ? [{ type: "execution_routes_refreshed" as const, ...refreshed }] : []),
      {
      type: "execution_route_create_result",
      requestId: parsed.data.requestId,
      status: "rejected",
      code: "EXECUTION_ROUTE_CREATE_REJECTED",
      message: "Execution route creation was rejected. Refresh and repair the route material.",
      },
    ];
  }
}

export function executionRouteCreateDeniedResult(frame: unknown): ExecutionRouteCreateResultFrame {
  return {
    type: "execution_route_create_result",
    requestId: requestIdOf(frame),
    status: "rejected",
    code: "EXECUTION_ROUTE_CREATE_DENIED",
    message: "The model is not currently eligible for route creation.",
  };
}

export function executionRouteCreationDiscoveryEvidence(
  discovery: GuiProviderModelDiscoveryProjection,
  entry: import("@kilnai/gateway-contracts").AvailableModelCatalogEntry,
): ExecutionRouteCreationDiscoveryEvidence {
  const evidenceIdentity = `${discovery.catalogEvidence.source.kind}:${discovery.catalogEvidence.source.id}`;
  const stable = JSON.stringify({ evidenceIdentity, entry });
  return { entry, catalogObservedAt: discovery.catalogEvidence.observedAt, evidenceIdentity, evidenceRevision: `sha256:${createHash("sha256").update(stable).digest("hex")}` };
}

function stripFrameType(frame: unknown): unknown {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return frame;
  const { type: _type, ...request } = frame as Record<string, unknown>;
  return request;
}

function requestIdOf(frame: unknown): string {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return "unknown";
  const requestId = (frame as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? requestId : "unknown";
}

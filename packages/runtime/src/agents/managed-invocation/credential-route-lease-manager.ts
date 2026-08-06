import type { ManagedAgentInvocationRequest, ManagedAgentResourceLeaseEvidence } from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { uniqueStrings } from "./runtime-primitives.js";
import type {
  ManagedAgentWorktreeLeaseManagerInput as ManagedAgentCredentialRouteLeaseManagerInputBase,
  ManagedAgentWorktreeLeaseReleaseInput as ManagedAgentCredentialRouteLeaseReleaseInputBase,
} from "./worktree-lease-manager.js";

export type ManagedAgentCredentialRouteLeaseManagerInput = ManagedAgentCredentialRouteLeaseManagerInputBase;

export type ManagedAgentCredentialRouteLeaseReleaseInput = ManagedAgentCredentialRouteLeaseReleaseInputBase;

export interface ManagedAgentCredentialRouteLeaseManager {
  acquire(input: ManagedAgentCredentialRouteLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentCredentialRouteLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export interface ManagedRuntimeCredentialRouteLeaseManagerConfig {
  readonly allowedRouteIds?: readonly string[];
}

export class ManagedRuntimeCredentialRouteLeaseManager implements ManagedAgentCredentialRouteLeaseManager {
  private readonly allowedRouteIds: ReadonlySet<string> | undefined;

  constructor(config: ManagedRuntimeCredentialRouteLeaseManagerConfig = {}) {
    this.allowedRouteIds = config.allowedRouteIds === undefined
      ? undefined
      : new Set(config.allowedRouteIds.map((routeId) => validateCredentialRouteId(routeId)));
  }

  async acquire(input: ManagedAgentCredentialRouteLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const routeId = this.resolveRuntimeSelectedRouteId(input.request);
    if (routeId === undefined) {
      return input.lease;
    }
    return {
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: uniqueStrings([
        ...input.lease.resourceUris,
        credentialRouteResourceUri(input.request.invocationId, routeId),
      ]),
    };
  }

  async release(input: ManagedAgentCredentialRouteLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const routeId = this.resolveRuntimeSelectedRouteId(input.request);
    if (routeId === undefined) {
      return input.lease;
    }
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        credentialRouteReleaseUri(input.request.invocationId, routeId),
      ]),
    };
  }

  private resolveRuntimeSelectedRouteId(request: ManagedAgentInvocationRequest): string | undefined {
    const credentialRoute = request.authority.credentialRoute;
    if (credentialRoute.mode === "credentialless") {
      return undefined;
    }
    const routeId = validateCredentialRouteId(credentialRoute.routeId);
    if (this.allowedRouteIds !== undefined && !this.allowedRouteIds.has(routeId)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed credential route is not admitted by the credential route lease manager");
    }
    return routeId;
  }
}

export function credentialRouteResourceUri(invocationId: string, routeId: string): string {
  return `kiln://artifacts/${invocationId}/credential-route/${encodeURIComponent(routeId)}`;
}

export function credentialRouteReleaseUri(invocationId: string, routeId: string): string {
  return `kiln://artifacts/${invocationId}/credential-route-release/${encodeURIComponent(routeId)}`;
}

export function validateCredentialRouteId(routeId: string): string {
  const normalized = routeId.trim();
  if (normalized.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed credential route id is required");
  }
  return normalized;
}

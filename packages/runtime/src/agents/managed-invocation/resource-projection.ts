import {
  type ArtifactResourceStore,
  type ManagedAgentAuthorityProfile,
  type ManagedAgentCapabilitySnapshot,
  type ManagedAgentInvocationRecord,
  type ManagedAgentInvocationRequest,
  type ManagedAgentResourceLeaseEvidence,
  type ManagedAgentWriteAuthority,
} from "@kilnai/core";

export const MANAGED_AGENT_RESOURCE_PREFIX = "kiln://managed-agents/invocations";
const MANAGED_INVOCATION_INTERNAL_HOST = "managed-invocations";
const MANAGED_AGENT_PUBLIC_HOST = "managed-agents";

export interface ManagedInvocationResourceProjectionOptions {
  readonly artifactStore?: ArtifactResourceStore;
  readonly artifactUriCache?: Map<string, string>;
}

export interface ManagedInvocationResourceReference {
  readonly invocationId: string;
  readonly resourcePath: string;
}

const artifactUriCaches = new WeakMap<ArtifactResourceStore, Map<string, string>>();

export function projectManagedInvocationRecordResources(
  record: ManagedAgentInvocationRecord,
  options: ManagedInvocationResourceProjectionOptions = {},
): ManagedAgentInvocationRecord {
  const projectionOptions = {
    ...options,
    artifactUriCache: options.artifactUriCache ?? defaultArtifactUriCache(options.artifactStore),
  };
  const mapUri = (uri: string): string => projectManagedInvocationResourceUri(record, uri, projectionOptions);
  const transcriptUri = record.transcript ? mapUri(record.transcript.uri) : undefined;
  return {
    ...record,
    ...(record.authority !== undefined ? { authority: projectManagedInvocationAuthorityResources(record.authority, mapUri) } : {}),
    capabilitySnapshot: projectManagedInvocationCapabilitySnapshotResources(record.capabilitySnapshot, mapUri),
    ...(record.resourceLease !== undefined ? { resourceLease: projectManagedInvocationResourceLeaseResources(record.resourceLease, mapUri) } : {}),
    ...(record.transcript !== undefined
      ? {
          transcript: {
            ...record.transcript,
            uri: transcriptUri!,
            ...(transcriptUri !== record.transcript.uri
              ? {
                  persisted: true,
                  retention: options.artifactStore ? "session" : record.transcript.retention,
                }
              : {}),
          },
        }
      : {}),
    ...(record.diagnostics !== undefined
      ? {
          diagnostics: record.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            uri: mapUri(diagnostic.uri),
          })),
        }
      : {}),
    ...(record.resultHandoff !== undefined
      ? {
          resultHandoff: {
            ...record.resultHandoff,
            resourceUris: mapUris(record.resultHandoff.resourceUris, mapUri),
            memoryWriteProposalUris: mapUris(record.resultHandoff.memoryWriteProposalUris, mapUri),
          },
        }
      : {}),
    ...(record.writeEvidence !== undefined
      ? {
          writeEvidence: record.writeEvidence.map((evidence) => ({
            ...evidence,
            resourceUris: mapUris(evidence.resourceUris, mapUri),
          })),
        }
      : {}),
  } as ManagedAgentInvocationRecord;
}

export function managedInvocationPublicResourceUri(invocationId: string, resourcePath: string): string {
  const normalized = normalizeResourcePath(resourcePath);
  const baseUri = invocationResourceUri(invocationId);
  if (normalized === "transcript") {
    return `${baseUri}/transcript`;
  }
  if (normalized === "handoff") {
    return `${baseUri}/handoff`;
  }
  return `${baseUri}/resources/${encodeResourcePath(normalized)}`;
}

export function projectManagedInvocationRequestResources(
  request: ManagedAgentInvocationRequest,
  mapUri: (uri: string) => string,
): ManagedAgentInvocationRequest {
  return {
    ...request,
    authority: projectManagedInvocationAuthorityResources(request.authority, mapUri),
    input: {
      ...request.input,
      ...(request.input.resourceUris !== undefined ? { resourceUris: mapUris(request.input.resourceUris, mapUri) } : {}),
    },
  };
}

export function projectManagedInvocationCapabilitySnapshotResources(
  snapshot: ManagedAgentCapabilitySnapshot,
  mapUri: (uri: string) => string,
): ManagedAgentCapabilitySnapshot {
  return {
    ...snapshot,
    ...(snapshot.authorityProfile !== undefined
      ? { authorityProfile: projectManagedInvocationAuthorityResources(snapshot.authorityProfile, mapUri) }
      : {}),
    ...(snapshot.resourcePlane !== undefined
      ? {
          resourcePlane: {
            ...snapshot.resourcePlane,
            resourceUris: mapUris(snapshot.resourcePlane.resourceUris, mapUri),
          },
        }
      : {}),
    ...(snapshot.resourceLease !== undefined
      ? { resourceLease: projectManagedInvocationResourceLeaseResources(snapshot.resourceLease, mapUri) }
      : {}),
  };
}

export function projectManagedInvocationAuthorityResources(
  authority: ManagedAgentAuthorityProfile,
  mapUri: (uri: string) => string,
): ManagedAgentAuthorityProfile {
  const writeAuthority = authority.writeAuthority ? projectWriteAuthority(authority.writeAuthority, mapUri) : undefined;
  return {
    ...authority,
    ...(writeAuthority ? { writeAuthority } : {}),
  };
}

export function projectManagedInvocationResourceLeaseResources(
  lease: ManagedAgentResourceLeaseEvidence,
  mapUri: (uri: string) => string,
): ManagedAgentResourceLeaseEvidence {
  return {
    ...lease,
    resourceUris: mapUris(lease.resourceUris, mapUri),
    diagnosticUris: mapUris(lease.diagnosticUris, mapUri),
    ...(lease.worktreeReview !== undefined
      ? {
          worktreeReview: {
            ...lease.worktreeReview,
            resourceUris: mapUris(lease.worktreeReview.resourceUris, mapUri),
            diagnosticUris: mapUris(lease.worktreeReview.diagnosticUris, mapUri),
          },
        }
      : {}),
    ...(lease.worktreeConflict !== undefined
      ? {
          worktreeConflict: {
            ...lease.worktreeConflict,
            resourceUris: mapUris(lease.worktreeConflict.resourceUris, mapUri),
            diagnosticUris: mapUris(lease.worktreeConflict.diagnosticUris, mapUri),
          },
        }
      : {}),
  };
}

export function invocationResourceUri(invocationId: string): string {
  return `${MANAGED_AGENT_RESOURCE_PREFIX}/${encodeURIComponent(invocationId)}`;
}

export function managedInvocationResourcePath(uri: string, invocationId: string): string | undefined {
  const reference = managedInvocationResourceReference(uri);
  return reference?.invocationId === invocationId ? reference.resourcePath : undefined;
}

export function managedInvocationResourceReference(uri: string): ManagedInvocationResourceReference | undefined {
  return parseInternalManagedInvocationUri(uri) ?? parsePublicManagedInvocationUri(uri);
}

export function projectManagedInvocationPublicResourceUri(uri: string): string {
  const reference = managedInvocationResourceReference(uri);
  return reference ? managedInvocationPublicResourceUri(reference.invocationId, reference.resourcePath) : uri;
}

export function formatManagedInvocationTranscript(record: ManagedAgentInvocationRecord): string {
  return [
    "# Managed Invocation Transcript",
    "",
    `Invocation ID: ${record.invocationId}`,
    `Status: ${record.lifecycleState}`,
    `Profile: ${record.profile}`,
    `Provider: ${record.providerRoute.providerId}`,
    record.providerRoute.model ? `Model: ${record.providerRoute.model}` : undefined,
    `Surface: ${record.providerRoute.surface}`,
    `Adapter: ${record.adapterKind}`,
    `Execution: ${record.executionMode}`,
    "",
    "## Capability Snapshot",
    "",
    `Snapshot ID: ${record.capabilitySnapshot.snapshotId}`,
    `Captured at: ${record.capabilitySnapshot.capturedAt}`,
    `Route ID: ${record.capabilitySnapshot.routeId}`,
    `Route health: ${record.capabilitySnapshot.routeHealth.status}`,
    `Route health reason: ${record.capabilitySnapshot.routeHealth.reason}`,
    `Provider proof: ${record.capabilitySnapshot.providerModelProof.status}`,
    `Provider proof source: ${record.capabilitySnapshot.providerModelProof.source}`,
    `Context mode: ${record.capabilitySnapshot.contextMode}`,
    `Resource plane: ${record.capabilitySnapshot.resourcePlane.available ? "available" : "unavailable"}`,
    `Child identity: ${formatChildIdentity(record.capabilitySnapshot.childIdentity)}`,
    record.childSessionId ? `Child session: ${record.childSessionId}` : undefined,
    record.childTurnId ? `Child turn: ${record.childTurnId}` : undefined,
    "",
    "## Result",
    "",
    record.resultHandoff?.summary ?? "No result summary was recorded.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

export function projectManagedInvocationResourceUri(
  record: ManagedAgentInvocationRecord,
  uri: string,
  options: ManagedInvocationResourceProjectionOptions,
): string {
  const artifactUriCache = options.artifactUriCache ?? defaultArtifactUriCache(options.artifactStore);
  const reference = managedInvocationResourceReference(uri);
  if (!reference) {
    return uri;
  }
  if (reference.invocationId !== record.invocationId) {
    return managedInvocationPublicResourceUri(reference.invocationId, reference.resourcePath);
  }
  if (options.artifactStore) {
    return persistManagedInvocationResource(
      record,
      uri,
      reference.resourcePath,
      options.artifactStore,
      artifactUriCache,
    );
  }
  return managedInvocationPublicResourceUri(record.invocationId, reference.resourcePath);
}

function persistManagedInvocationResource(
  record: ManagedAgentInvocationRecord,
  sourceUri: string,
  resourcePath: string,
  artifactStore: ArtifactResourceStore,
  artifactUriCache: Map<string, string> | undefined,
): string {
  const cacheKey = managedInvocationPublicResourceUri(record.invocationId, resourcePath);
  const existing = artifactUriCache?.get(cacheKey);
  if (existing) {
    return existing;
  }
  const artifact = artifactStore.put({
    namespace: "managed-invocations",
    title: managedInvocationResourceTitle(record.invocationId, resourcePath),
    mimeType: "text/markdown",
    content: { type: "text", text: formatManagedInvocationResource(record, resourcePath) },
    producer: { kind: "managed-invocation", name: record.providerRoute.providerId },
    retention: { scope: "session" },
  });
  const resourceUri = `kiln://artifacts/managed-invocations/${artifact.id}/content`;
  artifactUriCache?.set(cacheKey, resourceUri);
  artifactUriCache?.set(sourceUri, resourceUri);
  return resourceUri;
}

function defaultArtifactUriCache(artifactStore: ArtifactResourceStore | undefined): Map<string, string> | undefined {
  if (!artifactStore) {
    return undefined;
  }
  const existing = artifactUriCaches.get(artifactStore);
  if (existing) {
    return existing;
  }
  const cache = new Map<string, string>();
  artifactUriCaches.set(artifactStore, cache);
  return cache;
}

function formatManagedInvocationResource(record: ManagedAgentInvocationRecord, resourcePath: string): string {
  if (normalizeResourcePath(resourcePath) === "transcript") {
    return formatManagedInvocationTranscript(record);
  }
  return [
    "# Managed Invocation Resource",
    "",
    `Invocation ID: ${record.invocationId}`,
    `Resource: ${normalizeResourcePath(resourcePath)}`,
    `Status: ${record.lifecycleState}`,
    `Provider: ${record.providerRoute.providerId}`,
    record.providerRoute.model ? `Model: ${record.providerRoute.model}` : undefined,
    `Capability snapshot: ${record.capabilitySnapshot.snapshotId}`,
    "",
    record.resultHandoff?.summary ?? "No resource summary was recorded.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function managedInvocationResourceTitle(invocationId: string, resourcePath: string): string {
  const normalized = normalizeResourcePath(resourcePath).replace(/[/-]+/gu, " ");
  return `Managed invocation ${invocationId} ${normalized}`;
}

function projectWriteAuthority(
  writeAuthority: ManagedAgentWriteAuthority,
  mapUri: (uri: string) => string,
): ManagedAgentWriteAuthority {
  return {
    ...writeAuthority,
    scope: {
      ...writeAuthority.scope,
      artifacts: {
        ...writeAuthority.scope.artifacts,
        resourceUris: mapUris(writeAuthority.scope.artifacts.resourceUris, mapUri),
      },
    },
    approval: {
      ...writeAuthority.approval,
      ...(writeAuthority.approval.evidenceUris !== undefined
        ? { evidenceUris: mapUris(writeAuthority.approval.evidenceUris, mapUri) }
        : {}),
    },
  };
}

function mapUris(values: readonly string[], mapUri: (uri: string) => string): readonly string[] {
  return values.map(mapUri);
}

function parseInternalManagedInvocationUri(uri: string): {
  readonly invocationId: string;
  readonly resourcePath: string;
} | undefined {
  const parsed = parseKilnUri(uri);
  if (!parsed || parsed.hostname !== MANAGED_INVOCATION_INTERNAL_HOST) {
    return undefined;
  }
  const [invocationId, ...resourcePath] = parsed.path;
  if (!invocationId || resourcePath.length === 0) {
    return undefined;
  }
  return {
    invocationId,
    resourcePath: normalizeResourcePath(resourcePath.join("/")),
  };
}

function parsePublicManagedInvocationUri(uri: string): {
  readonly invocationId: string;
  readonly resourcePath: string;
} | undefined {
  const parsed = parseKilnUri(uri);
  if (!parsed || parsed.hostname !== MANAGED_AGENT_PUBLIC_HOST || parsed.path[0] !== "invocations") {
    return undefined;
  }
  const invocationId = parsed.path[1];
  const section = parsed.path[2];
  if (!invocationId || !section) {
    return undefined;
  }
  if (section === "transcript" || section === "handoff") {
    return { invocationId, resourcePath: section };
  }
  if (section === "resources" && parsed.path.length > 3) {
    return {
      invocationId,
      resourcePath: normalizeResourcePath(parsed.path.slice(3).join("/")),
    };
  }
  return undefined;
}

function parseKilnUri(uri: string): {
  readonly hostname: string;
  readonly path: readonly string[];
} | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "kiln:") {
    return undefined;
  }
  const path: string[] = [];
  for (const segment of parsed.pathname.split("/").filter((part) => part.length > 0)) {
    try {
      path.push(decodeURIComponent(segment));
    } catch {
      return undefined;
    }
  }
  return { hostname: parsed.hostname, path };
}

function encodeResourcePath(resourcePath: string): string {
  return normalizeResourcePath(resourcePath).split("/").map(encodeURIComponent).join("/");
}

function normalizeResourcePath(resourcePath: string): string {
  return resourcePath.split("/").filter((part) => part.trim().length > 0).join("/");
}

function formatChildIdentity(identity: ManagedAgentInvocationRecord["capabilitySnapshot"]["childIdentity"]): string {
  return identity.displayName ?? identity.admittedAgentProfile ?? identity.requestedAgentProfile ?? identity.agentId;
}

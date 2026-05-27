import {
  createSessionBuiltinToolOptions,
  type DefaultBuiltinToolRegistryOptions,
  type ArtifactResourceStore,
  type ManagedAgentResourceLeaseEvidence,
  rejectResourceReadCursor,
  type ToolResourceDescriptor,
  type ToolResourceProvider,
  type ToolResourceReadOptions,
  type ToolResourceReadResult,
  type ToolResourceTemplateDescriptor,
} from "@kilnai/core";
import type { ManagedAgentRuntimeInvocationSnapshot } from "./index.js";
import {
  MANAGED_AGENT_RESOURCE_PREFIX,
  formatManagedInvocationTranscript,
  invocationResourceUri,
  managedInvocationPublicResourceUri,
  managedInvocationResourceReference,
  projectManagedInvocationCapabilitySnapshotResources,
  projectManagedInvocationRecordResources,
  projectManagedInvocationRequestResources,
  projectManagedInvocationResourceUri,
} from "./resource-projection.js";

const JSON_MIME_TYPE = "application/json";
const MARKDOWN_MIME_TYPE = "text/markdown";
export const MANAGED_AGENT_INVOCATION_RESOURCE_PROVIDER_KIND = "managed-invocation-resource-provider";

export interface ManagedAgentInvocationResourceProviderInput {
  readonly service: {
    list(): readonly ManagedAgentRuntimeInvocationSnapshot[];
  };
  readonly artifactStore?: ArtifactResourceStore;
}

export function createManagedAgentInvocationResourceProvider(
  input: ManagedAgentInvocationResourceProviderInput,
): ToolResourceProvider {
  return new ManagedAgentInvocationResourceProvider(input.service, input.artifactStore);
}

export function withManagedAgentInvocationResourceProvider(
  options: DefaultBuiltinToolRegistryOptions | undefined,
  input: ManagedAgentInvocationResourceProviderInput | undefined,
): DefaultBuiltinToolRegistryOptions {
  const sessionOptions = createSessionBuiltinToolOptions(options);
  if (!input || sessionOptions.resourceProviders?.some(isManagedAgentInvocationResourceProvider) === true) {
    return sessionOptions;
  }
  return createSessionBuiltinToolOptions({
    ...sessionOptions,
    resourceProviders: [
      ...(sessionOptions.resourceProviders ?? []),
      createManagedAgentInvocationResourceProvider({
        service: input.service,
        artifactStore: input.artifactStore ?? sessionOptions.artifactResources?.store,
      }),
    ],
  });
}

export function isManagedAgentInvocationResourceProvider(provider: unknown): boolean {
  return typeof provider === "object"
    && provider !== null
    && (provider as { readonly kind?: unknown }).kind === MANAGED_AGENT_INVOCATION_RESOURCE_PROVIDER_KIND;
}

class ManagedAgentInvocationResourceProvider implements ToolResourceProvider {
  readonly kind = MANAGED_AGENT_INVOCATION_RESOURCE_PROVIDER_KIND;

  constructor(
    private readonly service: ManagedAgentInvocationResourceProviderInput["service"],
    private readonly artifactStore: ArtifactResourceStore | undefined,
  ) {}

  listResources(): readonly ToolResourceDescriptor[] {
    const invocations = this.sortedInvocations();
    return [
      {
        uri: MANAGED_AGENT_RESOURCE_PREFIX,
        name: "managed_agent_invocations",
        title: "Managed Agent Invocations",
        description: "Read-only snapshot of managed child invocation lifecycle state.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      ...invocations.flatMap((snapshot) => this.invocationResources(snapshot)),
    ];
  }

  listTemplates(): readonly ToolResourceTemplateDescriptor[] {
    return [{
      uriTemplate: `${MANAGED_AGENT_RESOURCE_PREFIX}/{invocationId}`,
      name: "managed_agent_invocation",
      title: "Managed Agent Invocation",
      description: "Read one managed child invocation lifecycle snapshot by id.",
      mimeType: JSON_MIME_TYPE,
      annotations: { readOnlyHint: true },
    }, {
      uriTemplate: `${MANAGED_AGENT_RESOURCE_PREFIX}/{invocationId}/transcript`,
      name: "managed_agent_invocation_transcript",
      title: "Managed Agent Invocation Transcript",
      description: "Read one managed child invocation transcript body.",
      mimeType: MARKDOWN_MIME_TYPE,
      annotations: { readOnlyHint: true },
    }, {
      uriTemplate: `${MANAGED_AGENT_RESOURCE_PREFIX}/{invocationId}/handoff`,
      name: "managed_agent_invocation_handoff",
      title: "Managed Agent Invocation Handoff",
      description: "Read one managed child invocation result handoff summary and resource pointers.",
      mimeType: JSON_MIME_TYPE,
      annotations: { readOnlyHint: true },
    }, {
      uriTemplate: `${MANAGED_AGENT_RESOURCE_PREFIX}/{invocationId}/resources`,
      name: "managed_agent_invocation_resources",
      title: "Managed Agent Invocation Resource Bundle",
      description: "Read one managed child invocation transcript, handoff, write evidence, lease, and diagnostic resource URI bundle.",
      mimeType: JSON_MIME_TYPE,
      annotations: { readOnlyHint: true },
    }];
  }

  async read(uri: string, options: ToolResourceReadOptions = {}): Promise<ToolResourceReadResult | undefined> {
    const parsed = parseManagedAgentResourceUri(uri);
    if (!parsed) {
      return undefined;
    }
    rejectResourceReadCursor(uri, options);
    if (!parsed.invocationId) {
      return jsonResource(uri, {
        total: this.sortedInvocations().length,
        invocations: this.sortedInvocations().map(projectInvocationSummary),
      });
    }

    const rawSnapshot = this.sortedRawInvocations().find((candidate) => candidate.invocationId === parsed.invocationId);
    if (!rawSnapshot) {
      return undefined;
    }
    const snapshot = this.projectSnapshot(rawSnapshot);

    if (!parsed.section) {
      return jsonResource(uri, {
        invocation: projectInvocationDetail(snapshot),
      });
    }
    if (parsed.section === "transcript") {
      const record = snapshot.record;
      if (!record?.transcript) {
        return undefined;
      }
      return textResource(uri, MARKDOWN_MIME_TYPE, formatManagedInvocationTranscript(record));
    }
    if (parsed.section === "handoff") {
      const handoff = snapshot.record?.resultHandoff;
      if (!handoff) {
        return undefined;
      }
      return jsonResource(uri, {
        invocationId: snapshot.invocationId,
        handoff,
      });
    }
    if (parsed.section === "resources" && parsed.resourcePath) {
      const projectedResourceUri = this.projectSnapshotUri(rawSnapshot, uri);
      return jsonResource(uri, {
        invocationId: snapshot.invocationId,
        resource: projectInvocationResource(snapshot, uri, projectedResourceUri, parsed.resourcePath),
      });
    }
    if (parsed.section === "resources") {
      return jsonResource(uri, {
        invocationId: snapshot.invocationId,
        resourceUris: resourceUrisForInvocation(snapshot),
      });
    }
    return undefined;
  }

  private sortedInvocations(): readonly ManagedAgentRuntimeInvocationSnapshot[] {
    return this.sortedRawInvocations().map((snapshot) => this.projectSnapshot(snapshot));
  }

  private sortedRawInvocations(): readonly ManagedAgentRuntimeInvocationSnapshot[] {
    return [...this.service.list()].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt) || a.invocationId.localeCompare(b.invocationId)
    );
  }

  private projectSnapshot(snapshot: ManagedAgentRuntimeInvocationSnapshot): ManagedAgentRuntimeInvocationSnapshot {
    const mapUri = (uri: string): string => this.projectSnapshotUri(snapshot, uri);
    const record = snapshot.record
      ? projectManagedInvocationRecordResources(snapshot.record, { artifactStore: this.artifactStore })
      : undefined;
    return {
      ...snapshot,
      request: projectManagedInvocationRequestResources(snapshot.request, mapUri),
      decision: {
        ...snapshot.decision,
        capabilitySnapshot: projectManagedInvocationCapabilitySnapshotResources(
          snapshot.decision.capabilitySnapshot,
          mapUri,
        ),
      },
      ...(record ? { record } : {}),
    };
  }

  private projectSnapshotUri(snapshot: ManagedAgentRuntimeInvocationSnapshot, uri: string): string {
    if (snapshot.record) {
      return projectManagedInvocationResourceUri(snapshot.record, uri, { artifactStore: this.artifactStore });
    }
    const reference = managedInvocationResourceReference(uri);
    return reference ? managedInvocationPublicResourceUri(reference.invocationId, reference.resourcePath) : uri;
  }

  private invocationResources(snapshot: ManagedAgentRuntimeInvocationSnapshot): readonly ToolResourceDescriptor[] {
    const baseUri = invocationResourceUri(snapshot.invocationId);
    return [
      {
        uri: baseUri,
        name: `managed_agent_invocation_${safeResourceName(snapshot.invocationId)}`,
        title: `Managed Agent ${snapshot.invocationId}`,
        description: "Read-only managed child invocation lifecycle snapshot.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      ...(snapshot.record?.transcript ? [{
        uri: `${baseUri}/transcript`,
        name: `managed_agent_invocation_${safeResourceName(snapshot.invocationId)}_transcript`,
        title: `Managed Agent ${snapshot.invocationId} Transcript`,
        description: "Read-only managed child transcript body.",
        mimeType: MARKDOWN_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      ...(snapshot.record?.resultHandoff ? [{
        uri: `${baseUri}/handoff`,
        name: `managed_agent_invocation_${safeResourceName(snapshot.invocationId)}_handoff`,
        title: `Managed Agent ${snapshot.invocationId} Handoff`,
        description: "Read-only managed child result handoff summary and resources.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      }] : []),
      {
        uri: `${baseUri}/resources`,
        name: `managed_agent_invocation_${safeResourceName(snapshot.invocationId)}_resources`,
        title: `Managed Agent ${snapshot.invocationId} Resources`,
        description: "Read-only managed child transcript, handoff, write evidence, lease, and diagnostic resource URI bundle.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
    ];
  }
}

function projectInvocationSummary(snapshot: ManagedAgentRuntimeInvocationSnapshot): Record<string, unknown> {
  return {
    invocationId: snapshot.invocationId,
    agentId: snapshot.agentId,
    parentSessionId: snapshot.parentSessionId,
    parentTurnId: snapshot.parentTurnId,
    profile: snapshot.profile,
    providerRoute: snapshot.providerRoute,
    adapterKind: snapshot.adapterKind,
    executionMode: snapshot.executionMode,
    authorityProfileId: snapshot.authorityProfileId,
    lifecycleState: snapshot.lifecycleState,
    startedAt: snapshot.startedAt,
    ...(snapshot.finishedAt ? { finishedAt: snapshot.finishedAt } : {}),
    ...(snapshot.durationMs !== undefined ? { durationMs: snapshot.durationMs } : {}),
    ...(snapshot.record?.transcript?.uri ? { transcriptUri: snapshot.record.transcript.uri } : {}),
    ...(snapshot.record?.resultHandoff?.summary ? { resultSummary: snapshot.record.resultHandoff.summary } : {}),
    handoffResourceUris: snapshot.record?.resultHandoff?.resourceUris ?? [],
    writeEvidenceResourceUris: writeEvidenceUrisForInvocation(snapshot),
    diagnosticResourceUris: diagnosticUrisForInvocation(snapshot),
    resourceUris: resourceUrisForInvocation(snapshot),
  };
}

function projectInvocationDetail(snapshot: ManagedAgentRuntimeInvocationSnapshot): Record<string, unknown> {
  return {
    ...projectInvocationSummary(snapshot),
    request: {
      summary: snapshot.request.input.summary,
      contextMode: snapshot.request.input.context?.mode,
      requestedAuthority: snapshot.request.requestedAuthority,
      profile: snapshot.request.profile,
      requestedBy: snapshot.request.requestedBy,
      requestSource: snapshot.request.requestSource,
      workingDirectory: snapshot.request.authority.workingDirectory,
      resourceUris: snapshot.request.input.resourceUris ?? [],
      handoff: snapshot.request.input.handoff,
    },
    admission: {
      status: snapshot.decision.status,
      resourceLease: snapshot.decision.capabilitySnapshot.resourceLease,
    },
    ...(snapshot.record?.transcript ? { transcript: snapshot.record.transcript } : {}),
    ...(snapshot.record?.diagnostics ? { diagnostics: snapshot.record.diagnostics } : {}),
    ...(snapshot.record?.resultHandoff ? { resultHandoff: snapshot.record.resultHandoff } : {}),
    writeEvidenceResourceUris: writeEvidenceUrisForInvocation(snapshot),
    ...(snapshot.record?.resourceLease ? { resourceLease: snapshot.record.resourceLease } : {}),
  };
}

function projectInvocationResource(
  snapshot: ManagedAgentRuntimeInvocationSnapshot,
  resourceUri: string,
  projectedResourceUri: string,
  resourcePath: string,
): Record<string, unknown> {
  const resultHandoff = snapshot.record?.resultHandoff;
  const matchesResource = (uri: string): boolean => uri === resourceUri || uri === projectedResourceUri;
  const diagnostics = (snapshot.record?.diagnostics ?? []).filter((diagnostic) => matchesResource(diagnostic.uri));
  const writeEvidence = (snapshot.record?.writeEvidence ?? []).filter((evidence) =>
    evidence.resourceUris.some(matchesResource)
  );
  return {
    invocationId: snapshot.invocationId,
    resourceUri,
    resourcePath,
    lifecycleState: snapshot.lifecycleState,
    providerRoute: snapshot.providerRoute,
    ...(resultHandoff?.resourceUris.some(matchesResource) ? { resultHandoff } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(writeEvidence.length > 0 ? { writeEvidence } : {}),
    ...(resourceLeaseReferencesUri(snapshot.record?.resourceLease, matchesResource)
      ? { resourceLease: snapshot.record?.resourceLease }
      : {}),
    ...(resourceLeaseReferencesUri(snapshot.record?.capabilitySnapshot.resourceLease, matchesResource)
      ? { capabilityResourceLease: snapshot.record?.capabilitySnapshot.resourceLease }
      : {}),
    ...(resourceLeaseReferencesUri(snapshot.decision.capabilitySnapshot.resourceLease, matchesResource)
      ? { admissionResourceLease: snapshot.decision.capabilitySnapshot.resourceLease }
      : {}),
    ...(snapshot.record?.resultHandoff?.summary ? { resultSummary: snapshot.record.resultHandoff.summary } : {}),
  };
}

function resourceUrisForInvocation(snapshot: ManagedAgentRuntimeInvocationSnapshot): readonly string[] {
  return uniqueStrings([
    ...(snapshot.record?.transcript?.uri ? [snapshot.record.transcript.uri] : []),
    ...(snapshot.record?.resultHandoff?.resourceUris ?? []),
    ...(snapshot.record?.resultHandoff?.memoryWriteProposalUris ?? []),
    ...writeEvidenceUrisForInvocation(snapshot),
    ...diagnosticUrisForInvocation(snapshot),
    ...resourceUrisForLease(snapshot.record?.resourceLease),
    ...resourceUrisForLease(snapshot.record?.capabilitySnapshot.resourceLease),
    ...resourceUrisForLease(snapshot.decision.capabilitySnapshot.resourceLease),
  ]);
}

function diagnosticUrisForInvocation(snapshot: ManagedAgentRuntimeInvocationSnapshot): readonly string[] {
  return uniqueStrings((snapshot.record?.diagnostics ?? []).map((diagnostic) => diagnostic.uri));
}

function writeEvidenceUrisForInvocation(snapshot: ManagedAgentRuntimeInvocationSnapshot): readonly string[] {
  return uniqueStrings((snapshot.record?.writeEvidence ?? []).flatMap((evidence) => evidence.resourceUris));
}

function resourceUrisForLease(lease: ManagedAgentResourceLeaseEvidence | undefined): readonly string[] {
  return [
    ...(lease?.resourceUris ?? []),
    ...(lease?.diagnosticUris ?? []),
    ...(lease?.worktreeReview?.resourceUris ?? []),
    ...(lease?.worktreeReview?.diagnosticUris ?? []),
    ...(lease?.worktreeConflict?.resourceUris ?? []),
    ...(lease?.worktreeConflict?.diagnosticUris ?? []),
  ];
}

function resourceLeaseReferencesUri(
  lease: ManagedAgentResourceLeaseEvidence | undefined,
  matchesResource: (uri: string) => boolean,
): boolean {
  return resourceUrisForLease(lease).some(matchesResource);
}

function parseManagedAgentResourceUri(uri: string): {
  readonly invocationId?: string;
  readonly section?: string;
  readonly resourcePath?: string;
} | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname !== "managed-agents") {
    return undefined;
  }
  const path = parsed.pathname.split("/").filter((part) => part.length > 0);
  if (path[0] !== "invocations") {
    return undefined;
  }
  if (path.length === 1) {
    return {};
  }
  if (path.length === 2) {
    const invocationId = decodeResourcePathSegment(path[1]!);
    return invocationId === undefined ? undefined : { invocationId };
  }
  if (path.length === 3) {
    const invocationId = decodeResourcePathSegment(path[1]!);
    if (invocationId === undefined) {
      return undefined;
    }
    return {
      invocationId,
      section: path[2],
    };
  }
  if (path.length > 3 && path[2] === "resources") {
    const invocationId = decodeResourcePathSegment(path[1]!);
    const resourcePath = decodeResourcePath(path.slice(3));
    if (invocationId === undefined || resourcePath === undefined) {
      return undefined;
    }
    return {
      invocationId,
      section: "resources",
      resourcePath,
    };
  }
  return undefined;
}

function decodeResourcePathSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function decodeResourcePath(segments: readonly string[]): string | undefined {
  const decoded: string[] = [];
  for (const segment of segments) {
    const value = decodeResourcePathSegment(segment);
    if (value === undefined) {
      return undefined;
    }
    decoded.push(value);
  }
  return decoded.join("/");
}

function jsonResource(uri: string, value: unknown): ToolResourceReadResult {
  return {
    contents: [{
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function textResource(uri: string, mimeType: string, text: string): ToolResourceReadResult {
  return {
    contents: [{
      uri,
      mimeType,
      text,
    }],
  };
}

function safeResourceName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "unknown";
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

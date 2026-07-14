import { createHash } from "node:crypto";
import {
  createSessionBuiltinToolOptions,
  projectManagedAgentCoordinationUsageAllocations,
  projectCostUpdatedEventToLifecycleLedger,
  projectVerificationUsageAllocations,
  projectVerifiedEfficiencyEvidence,
  reconcileLifecycleAttributionLedger,
  type DefaultBuiltinToolRegistryOptions,
  type ArtifactResourceStore,
  type ManagedAgentReplayResource,
  type ManagedAgentResourceLeaseEvidence,
  rejectResourceReadCursor,
  type ToolResourceDescriptor,
  type ToolResourceProvider,
  type ToolResourceReadOptions,
  type ToolResourceReadResult,
  type ToolResourceReadSummary,
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
  readonly parentSessionId: string;
  readonly artifactStore?: ArtifactResourceStore;
}

export function createManagedAgentInvocationResourceProvider(
  input: ManagedAgentInvocationResourceProviderInput,
): ToolResourceProvider {
  return new ManagedAgentInvocationResourceProvider(
    input.service,
    requireParentSessionId(input.parentSessionId),
    input.artifactStore,
  );
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
        parentSessionId: input.parentSessionId,
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

function requireParentSessionId(value: string): string {
  const parentSessionId = value.trim();
  if (parentSessionId.length === 0) {
    throw new Error("Managed invocation resources require a parent session id.");
  }
  return parentSessionId;
}

class ManagedAgentInvocationResourceProvider implements ToolResourceProvider {
  readonly kind = MANAGED_AGENT_INVOCATION_RESOURCE_PROVIDER_KIND;

  constructor(
    private readonly service: ManagedAgentInvocationResourceProviderInput["service"],
    private readonly parentSessionId: string,
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
      const invocations = this.sortedInvocations();
      return jsonResource(uri, {
        total: invocations.length,
        invocations: invocations.map(projectInvocationSummary),
      }, summarizeManagedInvocations(invocations));
    }

    const rawSnapshot = this.sortedRawInvocations().find((candidate) => candidate.invocationId === parsed.invocationId);
    if (!rawSnapshot) {
      return undefined;
    }
    const snapshot = this.projectSnapshot(rawSnapshot);

    if (!parsed.section) {
      return jsonResource(uri, {
        invocation: projectInvocationDetail(snapshot, this.artifactStore),
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
      const replayResource = replayResourceForUri(snapshot.record, uri, projectedResourceUri);
      if (replayResource) {
        return textResource(uri, replayResource.mimeType, replayResource.text);
      }
      return jsonResource(uri, {
        invocationId: snapshot.invocationId,
        resource: projectInvocationResource(snapshot, uri, projectedResourceUri, parsed.resourcePath),
      });
    }
    if (parsed.section === "resources") {
      return jsonResource(uri, {
        invocationId: snapshot.invocationId,
        sourceResourceUris: sourceResourceUrisForInvocation(snapshot),
        resourceUris: resourceUrisForInvocation(snapshot),
      });
    }
    return undefined;
  }

  private sortedInvocations(): readonly ManagedAgentRuntimeInvocationSnapshot[] {
    return this.sortedRawInvocations().map((snapshot) => this.projectSnapshot(snapshot));
  }

  private sortedRawInvocations(): readonly ManagedAgentRuntimeInvocationSnapshot[] {
    return this.service.list()
      .filter((snapshot) => snapshot.parentSessionId === this.parentSessionId)
      .sort((a, b) =>
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
    ...projectInvocationTimeoutEvidence(snapshot),
    startedAt: snapshot.startedAt,
    ...(snapshot.finishedAt ? { finishedAt: snapshot.finishedAt } : {}),
    ...(snapshot.durationMs !== undefined ? { durationMs: snapshot.durationMs } : {}),
    ...(snapshot.record?.transcript?.uri ? { transcriptUri: snapshot.record.transcript.uri } : {}),
    ...(snapshot.record?.resultHandoff?.summary ? { resultSummary: snapshot.record.resultHandoff.summary } : {}),
    sourceResourceUris: sourceResourceUrisForInvocation(snapshot),
    handoffResourceUris: snapshot.record?.resultHandoff?.resourceUris ?? [],
    writeEvidenceResourceUris: writeEvidenceUrisForInvocation(snapshot),
    diagnosticResourceUris: diagnosticUrisForInvocation(snapshot),
    resourceUris: resourceUrisForInvocation(snapshot),
  };
}

function projectInvocationDetail(
  snapshot: ManagedAgentRuntimeInvocationSnapshot,
  artifactStore: ArtifactResourceStore | undefined,
): Record<string, unknown> {
  const efficiencyEvidence = projectInvocationEfficiencyEvidence(snapshot, artifactStore);
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
    ...(snapshot.record?.usage ? { usage: snapshot.record.usage } : {}),
    ...(snapshot.record?.coordinationUsage ? { coordinationUsage: snapshot.record.coordinationUsage } : {}),
    ...(efficiencyEvidence
      ? {
          efficiencyEvidenceStatus: "available",
          efficiencyEvidence: efficiencyEvidence.projection,
          lifecycleAttribution: efficiencyEvidence.lifecycleAttribution,
        }
      : { efficiencyEvidenceStatus: "unavailable" }),
    writeEvidenceResourceUris: writeEvidenceUrisForInvocation(snapshot),
    ...(snapshot.record?.resourceLease ? { resourceLease: snapshot.record.resourceLease } : {}),
  };
}

function projectInvocationEfficiencyEvidence(
  snapshot: ManagedAgentRuntimeInvocationSnapshot,
  artifactStore: ArtifactResourceStore | undefined,
) {
  const usage = snapshot.record?.usage;
  if (!usage || typeof usage.cost.amount !== "number" || !Number.isFinite(usage.cost.amount)
    || usage.cost.amount < 0 || usage.cost.currency !== "USD") return undefined;
  if (new Set(usage.tokenClasses.map((tokenClass) => tokenClass.name)).size !== usage.tokenClasses.length
    || usage.tokenClasses.some((tokenClass) => tokenClass.value !== "unknown"
      && (!Number.isSafeInteger(tokenClass.value) || tokenClass.value < 0))) {
    return undefined;
  }
  const tokenValues = new Map(usage.tokenClasses.map((tokenClass) => [tokenClass.name, tokenClass.value]));
  const requiredTokenClasses = new Set<typeof usage.tokenClasses[number]["name"]>([
    "input",
    "output",
    ...(snapshot.record.capabilitySnapshot.adapterDescriptor?.usage.tokenClasses
      ?? snapshot.decision.capabilitySnapshot.adapterDescriptor?.usage.tokenClasses
      ?? []),
  ]);
  if ([...requiredTokenClasses].some((tokenClass) => !tokenValues.has(tokenClass))) {
    return undefined;
  }
  if ([...tokenValues.values()].some((value) => value === "unknown")) return undefined;
  const inputTokens = numberTokenValue(tokenValues.get("input"));
  const outputTokens = numberTokenValue(tokenValues.get("output"));
  const cacheReadTokens = numberTokenValue(tokenValues.get("cache_read"));
  const cacheWriteTokens = numberTokenValue(tokenValues.get("cache_write"));
  const observedAt = snapshot.finishedAt ?? snapshot.startedAt;
  const timestamp = new Date(observedAt);
  if (Number.isNaN(timestamp.getTime())) return undefined;
  const providerReported = usage.source === "provider";
  const quality = providerReported ? "provider_reported" as const
    : usage.source === "runtime" || usage.source === "adapter" ? "estimated" as const
      : "unknown" as const;
  const evidenceUris = uniqueStrings([
    ...(snapshot.record?.transcript?.uri ? [snapshot.record.transcript.uri] : []),
    ...(snapshot.record?.resultHandoff?.resourceUris ?? []),
  ]);
  const costEvent = {
    eventId: `${snapshot.invocationId}:managed-efficiency-cost`,
    kilnSessionId: snapshot.parentSessionId,
    sequence: 0,
    timestamp,
    kind: "cost_updated" as const,
    turnId: snapshot.parentTurnId,
    provider: {
      provider: snapshot.providerRoute.providerId,
      model: snapshot.providerRoute.model ?? "unknown",
      canonicalModel: snapshot.providerRoute.model ?? "unknown",
    },
    usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
    cost: { currency: "USD" as const, deltaUsd: usage.cost.amount, totalUsd: usage.cost.amount },
    source: { actor: "runtime" as const, surface: "runtime" as const, component: "managed-invocation-resource-provider" },
  };
  const coordinationAllocations = snapshot.record.coordinationUsage?.reconciliation === "mutually-exclusive"
    ? projectManagedAgentCoordinationUsageAllocations(snapshot.record.coordinationUsage)
    : [];
  const verificationAllocations = snapshot.record.resultHandoff?.verificationUsage
    ? projectVerificationUsageAllocations(snapshot.record.resultHandoff.verificationUsage)
      .map((allocation) => ({ ...allocation, workerId: snapshot.invocationId }))
    : [];
  const knownAllocations = [...coordinationAllocations, ...verificationAllocations];
  const attributedOutputTokens = knownAllocations.reduce(
    (total, allocation) => total + (allocation.providerTokenClass === "output" ? allocation.tokens : 0),
    0,
  );
  const attributedInputTokens = knownAllocations.reduce(
    (total, allocation) => total + (allocation.providerTokenClass === "input" ? allocation.tokens : 0),
    0,
  );
  if (attributedInputTokens > inputTokens || attributedOutputTokens > outputTokens) return undefined;
  const allocations = [
    ...knownAllocations,
    inputTokens > attributedInputTokens ? {
      source: "unknown" as const,
      tokenClass: "admitted" as const,
      providerTokenClass: "input" as const,
      tokens: inputTokens - attributedInputTokens,
      quality,
      evidenceUris,
      workerId: snapshot.invocationId,
    } : undefined,
    outputTokens > attributedOutputTokens ? {
      source: "final_output" as const,
      tokenClass: "generated" as const,
      providerTokenClass: "output" as const,
      tokens: outputTokens - attributedOutputTokens,
      quality,
      evidenceUris,
      workerId: snapshot.invocationId,
    } : undefined,
  ].filter((allocation): allocation is NonNullable<typeof allocation> => allocation !== undefined);
  let ledger;
  let reconciled;
  try {
    ledger = projectCostUpdatedEventToLifecycleLedger(costEvent, {
      allocations,
      context: {
        workItemId: snapshot.invocationId,
        parentTurnId: snapshot.parentTurnId,
        policyVersion: "managed-invocation-admission-v1",
        route: snapshot.decision.capabilitySnapshot.routeId,
      },
    });
    reconciled = reconcileLifecycleAttributionLedger(costEvent, ledger);
  } catch {
    return undefined;
  }
  const verificationResults = (snapshot.record?.resultHandoff?.structuredResult?.verificationResults ?? [])
    .filter((result) => result.evidenceUris.length > 0 && result.evidenceUris.every((uri) =>
      isTrustedInvocationEvidenceUri(snapshot, uri, artifactStore)
    ))
    .map((result) => ({
      verificationResultId: result.requirementId,
      status: result.status === "passed" ? "passed" as const
        : result.status === "failed" ? "failed" as const
          : "unknown" as const,
      method: result.method,
      evidenceUris: result.evidenceUris,
    }));
  const configurationHash = `sha256:${createHash("sha256").update(JSON.stringify({
    profile: snapshot.profile,
    routeId: snapshot.decision.capabilitySnapshot.routeId,
    contextMode: snapshot.decision.capabilitySnapshot.contextMode,
    authorityProfileId: snapshot.authorityProfileId,
  })).digest("hex")}`;
  return {
    projection: projectVerifiedEfficiencyEvidence({
      lifecycleEvidence: { costEvent, ledger, summary: reconciled.summary },
      observedAt,
      policy: {
        owner: "ManagedInvocationService",
        policyId: "managed-invocation-admission-v1",
        configurationHash,
      },
      verificationResults,
      outcome: snapshot.lifecycleState === "completed" ? "succeeded"
        : snapshot.lifecycleState === "failed" || snapshot.lifecycleState === "timed_out" || snapshot.lifecycleState === "cancelled"
          ? "failed"
          : "unknown",
    }),
    lifecycleAttribution: { ledger, summary: reconciled.summary },
  };
}

function numberTokenValue(value: number | "unknown" | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isTrustedInvocationEvidenceUri(
  snapshot: ManagedAgentRuntimeInvocationSnapshot,
  uri: string,
  artifactStore: ArtifactResourceStore | undefined,
): boolean {
  const trustedUris = new Set(uniqueStrings([
    ...sourceResourceUrisForInvocation(snapshot),
    ...(snapshot.record?.transcript?.uri ? [snapshot.record.transcript.uri] : []),
    ...(snapshot.record?.replayResources ?? []).map((resource) => resource.uri),
    ...diagnosticUrisForInvocation(snapshot),
    ...writeEvidenceUrisForInvocation(snapshot),
    ...resourceUrisForLease(snapshot.record?.resourceLease),
    ...resourceUrisForLease(snapshot.record?.capabilitySnapshot.resourceLease),
    ...resourceUrisForLease(snapshot.decision.capabilitySnapshot.resourceLease),
  ]));
  if (!trustedUris.has(uri)) return false;

  const managedReference = parseManagedAgentResourceUri(uri);
  if (managedReference) {
    return managedReference.invocationId === snapshot.invocationId;
  }

  const artifactReference = parseArtifactResourceUri(uri);
  if (!artifactReference || !artifactStore) return false;
  return artifactStore.get(artifactReference.namespace, artifactReference.id) !== undefined;
}

function parseArtifactResourceUri(uri: string): { readonly namespace: string; readonly id: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname !== "artifacts") return undefined;
  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return undefined;
    }
  });
  if (segments.length !== 3 || segments[2] !== "content" || segments.some((segment) => !segment)) {
    return undefined;
  }
  return { namespace: segments[0]!, id: segments[1]! };
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
    ...projectInvocationTimeoutEvidence(snapshot),
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

function projectInvocationTimeoutEvidence(snapshot: ManagedAgentRuntimeInvocationSnapshot): Record<string, unknown> {
  const authorityProfile = snapshot.decision.capabilitySnapshot.authorityProfile;
  if (!authorityProfile || !Number.isFinite(authorityProfile.timeoutMs)) {
    return {};
  }
  return {
    timeoutMs: authorityProfile.timeoutMs,
    ...(authorityProfile.timeoutSource ? { timeoutSource: authorityProfile.timeoutSource } : {}),
  };
}

function replayResourceForUri(
  record: ManagedAgentRuntimeInvocationSnapshot["record"] | undefined,
  resourceUri: string,
  projectedResourceUri: string,
): ManagedAgentReplayResource | undefined {
  return record?.replayResources?.find((resource) =>
    resource.uri === resourceUri || resource.uri === projectedResourceUri
  );
}

function resourceUrisForInvocation(snapshot: ManagedAgentRuntimeInvocationSnapshot): readonly string[] {
  return uniqueStrings([
    ...sourceResourceUrisForInvocation(snapshot),
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

function sourceResourceUrisForInvocation(snapshot: ManagedAgentRuntimeInvocationSnapshot): readonly string[] {
  return uniqueStrings([
    ...(snapshot.request.input.resourceUris ?? []),
    ...(snapshot.decision.capabilitySnapshot.resourcePlane.resourceUris ?? []),
    ...(snapshot.record?.capabilitySnapshot.resourcePlane.resourceUris ?? []),
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

function jsonResource(
  uri: string,
  value: unknown,
  summary?: ToolResourceReadSummary,
): ToolResourceReadResult {
  return {
    ...(summary ? { summary } : {}),
    contents: [{
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function summarizeManagedInvocations(
  snapshots: readonly ManagedAgentRuntimeInvocationSnapshot[],
): ToolResourceReadSummary {
  return {
    kind: "managed-agent-invocations",
    totalCount: snapshots.length,
    counts: {
      invocation: snapshots.length,
      completed: countWhere(snapshots, (snapshot) => snapshot.lifecycleState === "completed"),
      failed: countWhere(snapshots, (snapshot) => snapshot.lifecycleState === "failed"),
      timedOut: countWhere(snapshots, (snapshot) => snapshot.lifecycleState === "timed_out"),
      cancelled: countWhere(snapshots, (snapshot) => snapshot.lifecycleState === "cancelled"),
      stale: countWhere(snapshots, (snapshot) => snapshot.lifecycleState === "stale"),
      recovered: countWhere(snapshots, (snapshot) => snapshot.lifecycleState === "recovered"),
      running: countWhere(snapshots, (snapshot) => !isTerminalLifecycleState(snapshot.lifecycleState)),
      transcript: countWhere(snapshots, (snapshot) => !!snapshot.record?.transcript),
      handoff: countWhere(snapshots, (snapshot) => !!snapshot.record?.resultHandoff),
      sourceResource: sum(snapshots, (snapshot) => sourceResourceUrisForInvocation(snapshot).length),
      resource: sum(snapshots, (snapshot) => resourceUrisForInvocation(snapshot).length),
      diagnostic: sum(snapshots, (snapshot) => diagnosticUrisForInvocation(snapshot).length),
      writeEvidence: sum(snapshots, (snapshot) => writeEvidenceUrisForInvocation(snapshot).length),
    },
    facets: {
      agentIds: uniqueSorted(snapshots.map((snapshot) => snapshot.agentId)),
      profiles: uniqueSorted(snapshots.map((snapshot) => snapshot.profile)),
      adapterKinds: uniqueSorted(snapshots.map((snapshot) => snapshot.adapterKind)),
      providerIds: uniqueSorted(snapshots.map((snapshot) => snapshot.providerRoute.providerId)),
    },
  };
}

function isTerminalLifecycleState(lifecycleState: ManagedAgentRuntimeInvocationSnapshot["lifecycleState"]): boolean {
  return lifecycleState === "completed"
    || lifecycleState === "failed"
    || lifecycleState === "timed_out"
    || lifecycleState === "cancelled"
    || lifecycleState === "stale"
    || lifecycleState === "recovered";
}

function countWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

function sum<T>(items: readonly T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
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

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

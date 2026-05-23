import type {
  ToolResourceDescriptor,
  ToolResourceProvider,
  ToolResourceReadResult,
  ToolResourceTemplateDescriptor,
} from "@kilnai/core";
import type { ManagedAgentRuntimeInvocationSnapshot } from "./index.js";

const JSON_MIME_TYPE = "application/json";
const MANAGED_AGENT_RESOURCE_PREFIX = "kiln://managed-agents/invocations";

export interface ManagedAgentInvocationResourceProviderInput {
  readonly service: {
    list(): readonly ManagedAgentRuntimeInvocationSnapshot[];
  };
}

export function createManagedAgentInvocationResourceProvider(
  input: ManagedAgentInvocationResourceProviderInput,
): ToolResourceProvider {
  return new ManagedAgentInvocationResourceProvider(input.service);
}

class ManagedAgentInvocationResourceProvider implements ToolResourceProvider {
  constructor(private readonly service: ManagedAgentInvocationResourceProviderInput["service"]) {}

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
      description: "Read one managed child invocation transcript pointer.",
      mimeType: JSON_MIME_TYPE,
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
      description: "Read one managed child invocation transcript, handoff, lease, and diagnostic resource URI bundle.",
      mimeType: JSON_MIME_TYPE,
      annotations: { readOnlyHint: true },
    }];
  }

  async read(uri: string): Promise<ToolResourceReadResult | undefined> {
    const parsed = parseManagedAgentResourceUri(uri);
    if (!parsed) {
      return undefined;
    }
    if (!parsed.invocationId) {
      return jsonResource(uri, {
        total: this.sortedInvocations().length,
        invocations: this.sortedInvocations().map(projectInvocationSummary),
      });
    }

    const snapshot = this.sortedInvocations().find((candidate) => candidate.invocationId === parsed.invocationId);
    if (!snapshot) {
      return undefined;
    }

    if (!parsed.section) {
      return jsonResource(uri, {
        invocation: projectInvocationDetail(snapshot),
      });
    }
    if (parsed.section === "transcript") {
      const transcript = snapshot.record?.transcript;
      if (!transcript) {
        return undefined;
      }
      return jsonResource(uri, {
        invocationId: snapshot.invocationId,
        transcript,
      });
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
    if (parsed.section === "resources") {
      return jsonResource(uri, {
        invocationId: snapshot.invocationId,
        resourceUris: resourceUrisForInvocation(snapshot),
      });
    }
    return undefined;
  }

  private sortedInvocations(): readonly ManagedAgentRuntimeInvocationSnapshot[] {
    return [...this.service.list()].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt) || a.invocationId.localeCompare(b.invocationId)
    );
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
        description: "Read-only managed child transcript pointer.",
        mimeType: JSON_MIME_TYPE,
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
        description: "Read-only managed child transcript, handoff, lease, and diagnostic resource URI bundle.",
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
    ...(snapshot.record?.resultHandoff ? { resultHandoff: snapshot.record.resultHandoff } : {}),
    ...(snapshot.record?.resourceLease ? { resourceLease: snapshot.record.resourceLease } : {}),
  };
}

function resourceUrisForInvocation(snapshot: ManagedAgentRuntimeInvocationSnapshot): readonly string[] {
  return uniqueStrings([
    ...(snapshot.record?.transcript?.uri ? [snapshot.record.transcript.uri] : []),
    ...(snapshot.record?.resultHandoff?.resourceUris ?? []),
    ...(snapshot.record?.resultHandoff?.memoryWriteProposalUris ?? []),
    ...(snapshot.record?.resourceLease?.resourceUris ?? []),
    ...(snapshot.record?.resourceLease?.diagnosticUris ?? []),
    ...(snapshot.record?.capabilitySnapshot.resourceLease.resourceUris ?? []),
    ...(snapshot.record?.capabilitySnapshot.resourceLease.diagnosticUris ?? []),
    ...((snapshot.decision.capabilitySnapshot.resourceLease.resourceUris) ?? []),
    ...((snapshot.decision.capabilitySnapshot.resourceLease.diagnosticUris) ?? []),
  ]);
}

function invocationResourceUri(invocationId: string): string {
  return `${MANAGED_AGENT_RESOURCE_PREFIX}/${encodeURIComponent(invocationId)}`;
}

function parseManagedAgentResourceUri(uri: string): {
  readonly invocationId?: string;
  readonly section?: string;
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
  return undefined;
}

function decodeResourcePathSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
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

function safeResourceName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "unknown";
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

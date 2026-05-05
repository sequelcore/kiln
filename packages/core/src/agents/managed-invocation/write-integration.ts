import type { MemoryScope } from "../../memory/domain/scope.js";
import type {
  ArtifactContent,
  ArtifactResourceMetadata,
  ArtifactResourceStore,
} from "../../tools/index.js";
import {
  defineManagedAgentWriteEvidence,
  defineManagedAgentWriteProposal,
  isManagedAgentWriteAuthorityProfile,
} from "./write-authority.js";
import type {
  ManagedAgentMemoryWriteOperation,
  ManagedAgentWriteEvidence,
  ManagedAgentWriteProposal,
  ManagedAgentWriteRisk,
} from "./write-authority.js";
import type { ManagedAgentInvocationRequest } from "./index.js";

const DEFAULT_ARTIFACT_NAMESPACE = "managed-agent-write-proposals";
const JSON_MIME_TYPE = "application/json";
const TEXT_MIME_TYPE = "text/plain";
const DEFAULT_RISK: ManagedAgentWriteRisk = {
  level: "medium",
  reasons: ["child-produced write requires governed review"],
};

export interface ManagedAgentMemoryWriteProposalInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly proposalId: string;
  readonly childSessionId?: string;
  readonly operation: ManagedAgentMemoryWriteOperation;
  readonly scope: MemoryScope;
  readonly recordId?: string;
  readonly summary: string;
  readonly evidenceUris: readonly string[];
  readonly risk?: ManagedAgentWriteRisk;
  readonly createdAt: string;
}

export interface ManagedAgentArtifactWriteProposalInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly artifactStore: ArtifactResourceStore;
  readonly proposalId: string;
  readonly childSessionId?: string;
  readonly namespace?: string;
  readonly title: string;
  readonly content: ArtifactContent;
  readonly mimeType?: string;
  readonly summary: string;
  readonly risk?: ManagedAgentWriteRisk;
  readonly createdAt: string;
}

export interface ManagedAgentArtifactWriteProposalResult {
  readonly proposal: ManagedAgentWriteProposal;
  readonly evidence: ManagedAgentWriteEvidence;
  readonly artifact: ArtifactResourceMetadata;
  readonly artifactUri: string;
}

export function createManagedAgentMemoryWriteProposal(
  input: ManagedAgentMemoryWriteProposalInput,
): ManagedAgentWriteProposal {
  assertManagedWriteProfile(input.request);
  const writeAuthority = input.request.authority.writeAuthority;
  if (
    !writeAuthority ||
    writeAuthority.scope.memory.mode === "none" ||
    input.request.authority.memoryScope.access !== "write-proposals"
  ) {
    throw new Error("Managed agent memory write proposals require admitted memory proposal authority");
  }
  if (!writeAuthority.scope.memory.scope || !sameScope(writeAuthority.scope.memory.scope, input.scope)) {
    throw new Error("Managed agent memory write proposal scope is outside admitted memory scope");
  }
  if (!writeAuthority.scope.memory.operations.includes(input.operation)) {
    throw new Error("Managed agent memory write proposal operation is outside admitted memory operations");
  }

  return defineManagedAgentWriteProposal({
    proposalId: input.proposalId,
    invocationId: input.request.invocationId,
    parentSessionId: input.request.parentSessionId,
    parentTurnId: input.request.parentTurnId,
    ...(input.childSessionId !== undefined ? { childSessionId: input.childSessionId } : {}),
    target: {
      kind: "memory",
      scope: input.scope,
      operation: input.operation,
      ...(input.recordId !== undefined ? { recordId: input.recordId } : {}),
    },
    summary: input.summary,
    evidenceUris: input.evidenceUris,
    risk: input.risk ?? DEFAULT_RISK,
    createdAt: input.createdAt,
  });
}

export function storeManagedAgentArtifactWriteProposal(
  input: ManagedAgentArtifactWriteProposalInput,
): ManagedAgentArtifactWriteProposalResult {
  assertManagedWriteProfile(input.request);
  const writeAuthority = input.request.authority.writeAuthority;
  if (!writeAuthority || writeAuthority.scope.artifacts.mode === "none") {
    throw new Error("Managed agent artifact write proposals require admitted artifact proposal authority");
  }

  const namespace = input.namespace ?? DEFAULT_ARTIFACT_NAMESPACE;
  const namespaceUri = `kiln://artifacts/${namespace}`;
  if (!writeAuthority.scope.artifacts.resourceUris.some((uri) => uri === namespaceUri || uri.startsWith(`${namespaceUri}/`))) {
    throw new Error("Managed agent artifact write proposal namespace is outside admitted artifact scope");
  }

  const artifact = input.artifactStore.put({
    namespace,
    title: input.title,
    mimeType: input.mimeType ?? mimeTypeForContent(input.content),
    content: input.content,
    producer: {
      kind: "managed-agent",
      name: input.request.invocationId,
    },
    retention: { scope: "session" },
  });
  const artifactUri = `${namespaceUri}/${artifact.id}/content`;
  const proposal = defineManagedAgentWriteProposal({
    proposalId: input.proposalId,
    invocationId: input.request.invocationId,
    parentSessionId: input.request.parentSessionId,
    parentTurnId: input.request.parentTurnId,
    ...(input.childSessionId !== undefined ? { childSessionId: input.childSessionId } : {}),
    target: {
      kind: "artifact",
      uri: artifactUri,
    },
    summary: input.summary,
    evidenceUris: [artifactUri],
    risk: input.risk ?? DEFAULT_RISK,
    createdAt: input.createdAt,
  });
  const evidence = defineManagedAgentWriteEvidence({
    evidenceId: `${input.proposalId}:artifact-stored`,
    invocationId: input.request.invocationId,
    kind: "write-proposal-created",
    proposalId: input.proposalId,
    summary: input.summary,
    resourceUris: [artifactUri],
    recordedAt: input.createdAt,
  });

  return {
    proposal,
    evidence,
    artifact,
    artifactUri,
  };
}

function assertManagedWriteProfile(request: ManagedAgentInvocationRequest): void {
  if (!isManagedAgentWriteAuthorityProfile(request.profile)) {
    throw new Error("Managed agent write integration requires a managed write authority profile");
  }
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function mimeTypeForContent(content: ArtifactContent): string {
  if (content.type === "json") {
    return JSON_MIME_TYPE;
  }
  return TEXT_MIME_TYPE;
}

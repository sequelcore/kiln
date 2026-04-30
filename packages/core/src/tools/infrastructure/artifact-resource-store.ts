import { KilnError } from "../../engine/errors.js";
import type {
  ToolResourceDescriptor,
  ToolResourceProvider,
  ToolResourceReadResult,
  ToolResourceTemplateDescriptor,
} from "../domain/tool-resource-registry.js";
import type { ToolResourceChangeNotifier } from "../domain/tool-resource-notifications.js";

const JSON_MIME_TYPE = "application/json";
const DEFAULT_MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACTS_PER_NAMESPACE = 100;
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ArtifactRetentionPolicy {
  readonly scope: "session";
  readonly maxArtifacts?: number;
}

export interface ArtifactProducer {
  readonly kind: string;
  readonly name: string;
}

export type ArtifactContent =
  | {
    readonly type: "json";
    readonly value: unknown;
  }
  | {
    readonly type: "text";
    readonly text: string;
  }
  | {
    readonly type: "blob";
    readonly blob: string;
  };

export interface ArtifactResourceMetadata {
  readonly id: string;
  readonly namespace: string;
  readonly title: string;
  readonly mimeType: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly producer: ArtifactProducer;
  readonly size: number;
  readonly sequence: number;
  readonly retention: ArtifactRetentionPolicy;
}

export interface ArtifactResource extends ArtifactResourceMetadata {
  readonly content: ArtifactContent;
}

export interface ArtifactNamespaceSummary {
  readonly namespace: string;
  readonly artifactCount: number;
  readonly updatedAt: string;
  readonly sequence: number;
}

export interface ArtifactResourceStore {
  put(input: ArtifactResourcePutInput): ArtifactResourceMetadata;
  listNamespaces(): readonly ArtifactNamespaceSummary[];
  list(namespace: string): readonly ArtifactResourceMetadata[];
  get(namespace: string, id: string): ArtifactResource | undefined;
  setResourceChangeNotifier?(notifier: ToolResourceChangeNotifier): void;
}

export interface ArtifactResourcePutInput {
  readonly namespace: string;
  readonly title: string;
  readonly mimeType: string;
  readonly content: ArtifactContent;
  readonly producer: ArtifactProducer;
  readonly retention: ArtifactRetentionPolicy;
}

export interface MemoryArtifactResourceStoreOptions {
  readonly now?: () => string;
  readonly maxContentBytes?: number;
  readonly maxArtifactsPerNamespace?: number;
  readonly resourceNotifications?: ToolResourceChangeNotifier;
}

export interface ArtifactResourceProviderOptions {
  readonly store: ArtifactResourceStore;
}

export class MemoryArtifactResourceStore implements ArtifactResourceStore {
  private readonly artifactsByNamespace = new Map<string, readonly ArtifactResource[]>();
  private readonly now: () => string;
  private readonly maxContentBytes: number;
  private readonly maxArtifactsPerNamespace: number;
  private resourceNotifications: ToolResourceChangeNotifier | undefined;
  private sequence = 0;

  constructor(options: MemoryArtifactResourceStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxContentBytes = clampPositive(options.maxContentBytes, DEFAULT_MAX_CONTENT_BYTES);
    this.maxArtifactsPerNamespace = clampPositive(
      options.maxArtifactsPerNamespace,
      DEFAULT_MAX_ARTIFACTS_PER_NAMESPACE,
    );
    this.resourceNotifications = options.resourceNotifications;
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.resourceNotifications = notifier;
  }

  put(input: ArtifactResourcePutInput): ArtifactResourceMetadata {
    validateNamespace(input.namespace);
    validateRetention(input.retention);
    const contentSize = measureContentSize(input.content);
    if (contentSize > this.maxContentBytes) {
      throw artifactError("Artifact content exceeds configured limit", {
        namespace: input.namespace,
        size: contentSize,
        maxContentBytes: this.maxContentBytes,
      });
    }

    const timestamp = this.now();
    const sequence = this.sequence + 1;
    this.sequence = sequence;
    const artifact: ArtifactResource = {
      id: `artifact_${sequence}`,
      namespace: input.namespace,
      title: input.title,
      mimeType: input.mimeType,
      createdAt: timestamp,
      updatedAt: timestamp,
      producer: input.producer,
      size: contentSize,
      sequence,
      retention: input.retention,
      content: input.content,
    };
    const previousArtifacts = this.artifactsByNamespace.get(input.namespace) ?? [];
    const artifacts = [...previousArtifacts, artifact];
    this.artifactsByNamespace.set(input.namespace, applyRetention(artifacts, input.retention, this.maxArtifactsPerNamespace));
    this.notifyArtifactChanged(artifact, previousArtifacts.length === 0);
    return projectArtifactMetadata(artifact);
  }

  listNamespaces(): readonly ArtifactNamespaceSummary[] {
    const summaries: ArtifactNamespaceSummary[] = [];
    for (const [namespace, artifacts] of this.artifactsByNamespace.entries()) {
      if (artifacts.length === 0) continue;
      const latest = artifacts[artifacts.length - 1]!;
      summaries.push({
        namespace,
        artifactCount: artifacts.length,
        updatedAt: latest.updatedAt,
        sequence: latest.sequence,
      });
    }
    return summaries.sort((left, right) => left.namespace.localeCompare(right.namespace, "en"));
  }

  list(namespace: string): readonly ArtifactResourceMetadata[] {
    validateNamespace(namespace);
    return (this.artifactsByNamespace.get(namespace) ?? []).map(projectArtifactMetadata);
  }

  get(namespace: string, id: string): ArtifactResource | undefined {
    validateNamespace(namespace);
    return this.artifactsByNamespace.get(namespace)?.find((artifact) => artifact.id === id);
  }

  private notifyArtifactChanged(artifact: ArtifactResource, namespaceWasAdded: boolean): void {
    if (namespaceWasAdded) {
      this.resourceNotifications?.notifyResourceListChanged();
    }
    this.resourceNotifications?.notifyResourceUpdated(`kiln://artifacts/${artifact.namespace}`);
    this.resourceNotifications?.notifyResourceUpdated(`kiln://artifacts/${artifact.namespace}/${artifact.id}`);
    this.resourceNotifications?.notifyResourceUpdated(`kiln://artifacts/${artifact.namespace}/${artifact.id}/content`);
  }
}

export class ArtifactResourceProvider implements ToolResourceProvider {
  private readonly store: ArtifactResourceStore;

  constructor(options: ArtifactResourceProviderOptions) {
    this.store = options.store;
  }

  listResources(): readonly ToolResourceDescriptor[] {
    return this.store.listNamespaces().map((summary) => ({
      uri: `kiln://artifacts/${summary.namespace}`,
      name: `artifacts_${summary.namespace}`,
      title: `Artifacts: ${summary.namespace}`,
      description: `Read-only artifact namespace index for ${summary.namespace}.`,
      mimeType: JSON_MIME_TYPE,
      annotations: { readOnlyHint: true },
      _meta: {
        artifactCount: summary.artifactCount,
        updatedAt: summary.updatedAt,
        sequence: summary.sequence,
      },
    }));
  }

  listTemplates(): readonly ToolResourceTemplateDescriptor[] {
    return [
      {
        uriTemplate: "kiln://artifacts/{namespace}",
        name: "artifact_namespace",
        title: "Artifact Namespace",
        description: "Read artifact metadata for one artifact namespace.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://artifacts/{namespace}/{id}",
        name: "artifact_metadata",
        title: "Artifact Metadata",
        description: "Read metadata for one artifact by namespace and id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://artifacts/{namespace}/{id}/content",
        name: "artifact_content",
        title: "Artifact Content",
        description: "Read one artifact content payload by namespace and id.",
        annotations: { readOnlyHint: true },
      },
    ];
  }

  async read(uri: string): Promise<ToolResourceReadResult | undefined> {
    const parsed = parseArtifactUri(uri);
    if (!parsed) {
      return undefined;
    }
    if (parsed.path.length === 1) {
      const namespace = parsed.path[0]!;
      const artifacts = this.store.list(namespace);
      return jsonContent(uri, {
        namespace,
        artifactCount: artifacts.length,
        artifacts,
      }, {
        namespace,
        relation: "namespace",
        artifactCount: artifacts.length,
      });
    }
    if (parsed.path.length === 2) {
      const [namespace, id] = parsed.path;
      const artifact = this.store.get(namespace!, id!);
      if (!artifact) {
        throw artifactNotFound(uri);
      }
      return jsonContent(uri, projectArtifactMetadata(artifact), {
        namespace,
        id,
        relation: "metadata",
      });
    }
    if (parsed.path.length === 3 && parsed.path[2] === "content") {
      const [namespace, id] = parsed.path;
      const artifact = this.store.get(namespace!, id!);
      if (!artifact) {
        throw artifactNotFound(uri);
      }
      return contentResource(uri, artifact);
    }
    return undefined;
  }
}

function contentResource(uri: string, artifact: ArtifactResource): ToolResourceReadResult {
  const meta = {
    ...projectArtifactMetadata(artifact),
    relation: "content",
  };
  if (artifact.content.type === "blob") {
    return {
      contents: [{
        uri,
        mimeType: artifact.mimeType,
        blob: artifact.content.blob,
        _meta: meta,
      }],
    };
  }
  return {
    contents: [{
      uri,
      mimeType: artifact.mimeType,
      text: artifact.content.type === "json"
        ? JSON.stringify(artifact.content.value, null, 2)
        : artifact.content.text,
      _meta: meta,
    }],
  };
}

function jsonContent(uri: string, value: unknown, meta: Record<string, unknown>): ToolResourceReadResult {
  return {
    contents: [{
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(value, null, 2),
      _meta: meta,
    }],
  };
}

function parseArtifactUri(uri: string): { readonly path: readonly string[] } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname !== "artifacts") {
    return undefined;
  }
  const path = parsed.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  return { path };
}

function validateNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw artifactError("Invalid artifact namespace", { namespace });
  }
}

function validateRetention(retention: ArtifactRetentionPolicy | undefined): void {
  if (!retention || retention.scope !== "session") {
    throw artifactError("Artifact retention policy is required", { retention });
  }
  if (retention.maxArtifacts !== undefined && (!Number.isFinite(retention.maxArtifacts) || retention.maxArtifacts <= 0)) {
    throw artifactError("Artifact retention maxArtifacts must be positive", { retention });
  }
}

function applyRetention(
  artifacts: readonly ArtifactResource[],
  retention: ArtifactRetentionPolicy,
  storeMaxArtifacts: number,
): readonly ArtifactResource[] {
  const maxArtifacts = Math.max(1, Math.min(
    storeMaxArtifacts,
    Math.trunc(retention.maxArtifacts ?? storeMaxArtifacts),
  ));
  return artifacts.slice(Math.max(0, artifacts.length - maxArtifacts));
}

function measureContentSize(content: ArtifactContent): number {
  if (content.type === "blob") {
    return Buffer.byteLength(content.blob, "base64");
  }
  if (content.type === "json") {
    return Buffer.byteLength(JSON.stringify(content.value), "utf8");
  }
  return Buffer.byteLength(content.text, "utf8");
}

function projectArtifactMetadata(artifact: ArtifactResource): ArtifactResourceMetadata {
  return {
    id: artifact.id,
    namespace: artifact.namespace,
    title: artifact.title,
    mimeType: artifact.mimeType,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    producer: artifact.producer,
    size: artifact.size,
    sequence: artifact.sequence,
    retention: artifact.retention,
  };
}

function artifactNotFound(uri: string): KilnError {
  return artifactError(`Artifact resource not found: ${uri}`, { uri });
}

function artifactError(message: string, context: Record<string, unknown>): KilnError {
  return new KilnError("INTERNAL_ERROR", message, {
    context,
    retryable: false,
  });
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

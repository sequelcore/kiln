import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KilnError } from "../../engine/errors.js";
import type {
  MultimodalArtifact,
  MultimodalArtifactSource,
  MultimodalChecksum,
  MultimodalDimensions,
  MultimodalTransportModality,
} from "../../engine/domain/multimodal-routing.js";
import {
  createBlobResourceReadResult,
  createTextResourceReadResult,
  rejectResourceReadCursor,
  type ToolResourceDescriptor,
  type ToolResourceProvider,
  type ToolResourceReadOptions,
  type ToolResourceReadResult,
  type ToolResourceReadSummary,
  type ToolResourceTemplateDescriptor,
} from "../domain/tool-resource-registry.js";
import type { ToolResourceChangeNotifier } from "../domain/tool-resource-notifications.js";

const JSON_MIME_TYPE = "application/json";
const DEFAULT_MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACTS_PER_NAMESPACE = 100;
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ArtifactRetentionPolicy {
  readonly scope: "session" | "verification";
  readonly maxArtifacts?: number;
}

export interface ArtifactProducer {
  readonly kind: string;
  readonly name: string;
}

export interface ArtifactResourceMultimodalMetadata {
  readonly modality: MultimodalTransportModality;
  readonly source: MultimodalArtifactSource;
  readonly dimensions?: MultimodalDimensions;
  readonly durationMs?: number;
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
  readonly checksum?: MultimodalChecksum;
  readonly multimodal?: ArtifactResourceMultimodalMetadata;
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
  readonly multimodal?: ArtifactResourceMultimodalMetadata;
}

export interface MemoryArtifactResourceStoreOptions {
  readonly now?: () => string;
  readonly maxContentBytes?: number;
  readonly maxArtifactsPerNamespace?: number;
  readonly resourceNotifications?: ToolResourceChangeNotifier;
}

export interface FileArtifactResourceStoreOptions extends MemoryArtifactResourceStoreOptions {
  readonly rootDir: string;
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

  constructor(
    options: MemoryArtifactResourceStoreOptions = {},
    restoredArtifacts: readonly ArtifactResource[] = [],
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxContentBytes = clampPositive(options.maxContentBytes, DEFAULT_MAX_CONTENT_BYTES);
    this.maxArtifactsPerNamespace = clampPositive(
      options.maxArtifactsPerNamespace,
      DEFAULT_MAX_ARTIFACTS_PER_NAMESPACE,
    );
    this.resourceNotifications = options.resourceNotifications;
    for (const artifact of [...restoredArtifacts].sort((left, right) => left.sequence - right.sequence)) {
      const existing = this.artifactsByNamespace.get(artifact.namespace) ?? [];
      this.artifactsByNamespace.set(artifact.namespace, [...existing, artifact]);
      this.sequence = Math.max(this.sequence, artifact.sequence);
    }
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

    const previousArtifacts = this.artifactsByNamespace.get(input.namespace) ?? [];
    const protectedCount = previousArtifacts.filter((artifact) => artifact.retention.scope === "verification").length;
    if (protectedCount >= this.maxArtifactsPerNamespace) {
      throw artifactError("Artifact namespace capacity is protected by verification evidence", {
        namespace: input.namespace,
        maxArtifacts: this.maxArtifactsPerNamespace,
      });
    }

    const timestamp = this.now();
    const sequence = this.sequence + 1;
    this.sequence = sequence;
    const checksum = input.multimodal ? checksumContent(input.content) : undefined;
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
      ...(checksum ? { checksum } : {}),
      ...(input.multimodal ? { multimodal: input.multimodal } : {}),
      content: input.content,
    };
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

export class FileArtifactResourceStore implements ArtifactResourceStore {
  private readonly rootDir: string;
  private readonly memory: MemoryArtifactResourceStore;

  constructor(options: FileArtifactResourceStoreOptions) {
    if (options.rootDir.trim().length === 0) {
      throw artifactError("Artifact root directory is required", { rootDir: options.rootDir });
    }
    this.rootDir = resolve(options.rootDir);
    mkdirSync(this.rootDir, { recursive: true });
    const maxContentBytes = clampPositive(options.maxContentBytes, DEFAULT_MAX_CONTENT_BYTES);
    const restoredArtifacts = loadPersistedArtifacts(this.rootDir, maxContentBytes);
    this.memory = new MemoryArtifactResourceStore(options, restoredArtifacts);
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.memory.setResourceChangeNotifier(notifier);
  }

  put(input: ArtifactResourcePutInput): ArtifactResourceMetadata {
    const previousIds = new Set(this.memory.list(input.namespace).map((artifact) => artifact.id));
    const metadata = this.memory.put(input);
    const artifact = this.memory.get(metadata.namespace, metadata.id)!;
    this.persistArtifact(artifact);
    const retainedIds = new Set(this.memory.list(input.namespace).map((entry) => entry.id));
    for (const previousId of previousIds) {
      if (!retainedIds.has(previousId)) {
        rmSync(this.artifactPath(input.namespace, previousId), { force: true });
      }
    }
    return metadata;
  }

  listNamespaces(): readonly ArtifactNamespaceSummary[] {
    return this.memory.listNamespaces();
  }

  list(namespace: string): readonly ArtifactResourceMetadata[] {
    return this.memory.list(namespace);
  }

  get(namespace: string, id: string): ArtifactResource | undefined {
    return this.memory.get(namespace, id);
  }

  private persistArtifact(artifact: ArtifactResource): void {
    const namespaceDir = join(this.rootDir, artifact.namespace);
    mkdirSync(namespaceDir, { recursive: true });
    const target = this.artifactPath(artifact.namespace, artifact.id);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, JSON.stringify(artifact, null, 2), "utf8");
    renameSync(temporary, target);
  }

  private artifactPath(namespace: string, id: string): string {
    return join(this.rootDir, namespace, `${id}.json`);
  }

}

function loadPersistedArtifacts(rootDir: string, maxContentBytes: number): readonly ArtifactResource[] {
  const restored: ArtifactResource[] = [];
  for (const namespace of readdirSync(rootDir, { withFileTypes: true })) {
    if (!namespace.isDirectory() || !NAMESPACE_PATTERN.test(namespace.name)) continue;
    const namespaceDir = join(rootDir, namespace.name);
    const artifacts = readdirSync(namespaceDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^artifact_\d+\.json$/u.test(entry.name))
      .map((entry) => parsePersistedArtifact(readFileSync(join(namespaceDir, entry.name), "utf8"), namespace.name));
    const oversized = artifacts.find((artifact) => artifact.size > maxContentBytes);
    if (oversized) {
      throw artifactError("Persisted artifact content exceeds configured limit", {
        namespace: namespace.name,
        id: oversized.id,
        size: oversized.size,
        maxContentBytes,
      });
    }
    restored.push(...artifacts);
  }
  return restored;
}

export function projectMultimodalArtifactResource(artifact: ArtifactResource): MultimodalArtifact | undefined {
  if (!artifact.multimodal || !artifact.checksum) {
    return undefined;
  }
  const uri = `kiln://artifacts/${artifact.namespace}/${artifact.id}/content`;
  return {
    uri,
    modality: artifact.multimodal.modality,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.size,
    checksum: artifact.checksum,
    source: artifact.multimodal.source,
    retention: artifact.retention,
    replay: { uri },
    ...(artifact.multimodal.dimensions ? { dimensions: artifact.multimodal.dimensions } : {}),
    ...(artifact.multimodal.durationMs !== undefined ? { durationMs: artifact.multimodal.durationMs } : {}),
  };
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

  async read(uri: string, options: ToolResourceReadOptions = {}): Promise<ToolResourceReadResult | undefined> {
    const parsed = parseArtifactUri(uri);
    if (!parsed) {
      return undefined;
    }
    if (parsed.path.length === 1) {
      rejectResourceReadCursor(uri, options);
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
      }, summarizeArtifactNamespace(namespace, artifacts, this.store));
    }
    if (parsed.path.length === 2) {
      rejectResourceReadCursor(uri, options);
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
      return contentResource(uri, artifact, options);
    }
    return undefined;
  }
}

function contentResource(
  uri: string,
  artifact: ArtifactResource,
  options: ToolResourceReadOptions,
): ToolResourceReadResult {
  const meta = {
    ...projectArtifactMetadata(artifact),
    relation: "content",
  };
  if (artifact.content.type === "blob") {
    return createBlobResourceReadResult(uri, artifact.content.blob, artifact.mimeType, options, meta);
  }
  const text = artifact.content.type === "json"
    ? JSON.stringify(artifact.content.value, null, 2)
    : artifact.content.text;
  return createTextResourceReadResult(uri, text, artifact.mimeType, options, meta);
}

function jsonContent(
  uri: string,
  value: unknown,
  meta: Record<string, unknown>,
  summary?: ToolResourceReadSummary,
): ToolResourceReadResult {
  return {
    ...(summary ? { summary } : {}),
    contents: [{
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(value, null, 2),
      _meta: meta,
    }],
  };
}

function summarizeArtifactNamespace(
  namespace: string,
  artifacts: readonly ArtifactResourceMetadata[],
  store: ArtifactResourceStore,
): ToolResourceReadSummary {
  const contentTypes = artifacts.map((artifact) => store.get(namespace, artifact.id)?.content.type);
  const modalities = artifacts.flatMap((artifact) => artifact.multimodal ? [artifact.multimodal.modality] : []);
  return {
    kind: "artifacts",
    totalCount: artifacts.length,
    counts: {
      artifact: artifacts.length,
      json: contentTypes.filter((type) => type === "json").length,
      text: contentTypes.filter((type) => type === "text").length,
      blob: contentTypes.filter((type) => type === "blob").length,
    },
    facets: {
      namespaces: [namespace],
      producerKinds: uniqueSorted(artifacts.map((artifact) => artifact.producer.kind)),
      modalities: uniqueSorted(modalities),
    },
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
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
  if (!retention || (retention.scope !== "session" && retention.scope !== "verification")) {
    throw artifactError("Artifact retention policy is required", { retention });
  }
  if (retention.scope === "verification" && retention.maxArtifacts !== undefined) {
    throw artifactError("Verification evidence retention cannot declare maxArtifacts", { retention });
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
  const protectedArtifacts = artifacts.filter((artifact) => artifact.retention.scope === "verification");
  const requestedSessionArtifacts = retention.scope === "session"
    ? Math.max(1, Math.min(storeMaxArtifacts, Math.trunc(retention.maxArtifacts ?? storeMaxArtifacts)))
    : storeMaxArtifacts;
  const sessionCapacity = Math.min(
    requestedSessionArtifacts,
    Math.max(0, storeMaxArtifacts - protectedArtifacts.length),
  );
  const sessionArtifacts = sessionCapacity === 0
    ? []
    : artifacts
      .filter((artifact) => artifact.retention.scope === "session")
      .slice(-sessionCapacity);
  const retainedIds = new Set([...protectedArtifacts, ...sessionArtifacts].map((artifact) => artifact.id));
  return artifacts.filter((artifact) => retainedIds.has(artifact.id));
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

function checksumContent(content: ArtifactContent): MultimodalChecksum {
  const hash = createHash("sha256");
  if (content.type === "blob") {
    hash.update(Buffer.from(content.blob, "base64"));
  } else if (content.type === "json") {
    hash.update(JSON.stringify(content.value), "utf8");
  } else {
    hash.update(content.text, "utf8");
  }
  return {
    algorithm: "sha256",
    value: hash.digest("hex"),
  };
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
    ...(artifact.checksum ? { checksum: artifact.checksum } : {}),
    ...(artifact.multimodal ? { multimodal: artifact.multimodal } : {}),
  };
}

function parsePersistedArtifact(serialized: string, namespace: string): ArtifactResource {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw artifactError("Persisted artifact is not valid JSON", { namespace });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw artifactError("Persisted artifact must be an object", { namespace });
  }
  const artifact = value as Partial<ArtifactResource>;
  if (
    artifact.namespace !== namespace
    || typeof artifact.id !== "string"
    || !/^artifact_\d+$/u.test(artifact.id)
    || typeof artifact.sequence !== "number"
    || !Number.isSafeInteger(artifact.sequence)
    || artifact.sequence <= 0
    || typeof artifact.title !== "string"
    || typeof artifact.mimeType !== "string"
    || typeof artifact.createdAt !== "string"
    || typeof artifact.updatedAt !== "string"
    || typeof artifact.size !== "number"
    || !isArtifactContent(artifact.content)
    || !artifact.producer
    || typeof artifact.producer.kind !== "string"
    || typeof artifact.producer.name !== "string"
    || !artifact.retention
  ) {
    throw artifactError("Persisted artifact has an invalid contract", { namespace, id: artifact.id });
  }
  validateRetention(artifact.retention);
  const measuredSize = measureContentSize(artifact.content);
  if (measuredSize !== artifact.size) {
    throw artifactError("Persisted artifact size does not match content", {
      namespace,
      id: artifact.id,
      size: artifact.size,
      measuredSize,
    });
  }
  return artifact as ArtifactResource;
}

function isArtifactContent(value: unknown): value is ArtifactContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const content = value as Partial<ArtifactContent>;
  if (content.type === "json") return "value" in content;
  if (content.type === "text") return typeof content.text === "string";
  if (content.type === "blob") return typeof content.blob === "string";
  return false;
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

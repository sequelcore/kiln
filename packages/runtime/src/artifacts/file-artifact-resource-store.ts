import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KilnError } from "@kilnai/core/engine";
import {
  type ArtifactNamespaceSummary,
  type ArtifactResource,
  type ArtifactResourceMetadata,
  type ArtifactResourcePutInput,
  type ArtifactResourceStore,
  isArtifactResourceNamespace,
  MemoryArtifactResourceStore,
  type MemoryArtifactResourceStoreOptions,
  restoreArtifactResource,
  type ToolResourceChangeNotifier,
} from "@kilnai/core/tools";

export interface FileArtifactResourceStoreOptions extends MemoryArtifactResourceStoreOptions {
  readonly rootDir: string;
}

class FileArtifactResourceStore implements ArtifactResourceStore {
  private readonly rootDir: string;
  private readonly memory: MemoryArtifactResourceStore;

  constructor(options: FileArtifactResourceStoreOptions) {
    if (options.rootDir.trim().length === 0) {
      throw fileArtifactError("Artifact root directory is required", { rootDir: options.rootDir });
    }
    this.rootDir = resolve(options.rootDir);
    mkdirSync(this.rootDir, { recursive: true });
    this.memory = new MemoryArtifactResourceStore(
      options,
      loadPersistedArtifacts(this.rootDir, options.maxContentBytes),
    );
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.memory.setResourceChangeNotifier(notifier);
  }

  put(input: ArtifactResourcePutInput): ArtifactResourceMetadata {
    const previousIds = new Set(this.memory.list(input.namespace).map((artifact) => artifact.id));
    const metadata = this.memory.put(input);
    const artifact = this.memory.get(metadata.namespace, metadata.id);
    if (!artifact) throw new Error("New artifact is missing from the in-memory owner.");
    this.persistArtifact(artifact);
    const retainedIds = new Set(this.memory.list(input.namespace).map((entry) => entry.id));
    for (const previousId of previousIds) {
      if (!retainedIds.has(previousId)) rmSync(this.artifactPath(input.namespace, previousId), { force: true });
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
    const namespaceDirectory = join(this.rootDir, artifact.namespace);
    mkdirSync(namespaceDirectory, { recursive: true });
    const target = this.artifactPath(artifact.namespace, artifact.id);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, JSON.stringify(artifact, null, 2), "utf8");
    renameSync(temporary, target);
  }

  private artifactPath(namespace: string, id: string): string {
    return join(this.rootDir, namespace, `${id}.json`);
  }
}

export function createFileArtifactResourceStore(options: FileArtifactResourceStoreOptions): ArtifactResourceStore {
  return new FileArtifactResourceStore(options);
}

function loadPersistedArtifacts(rootDirectory: string, maxContentBytes?: number): readonly ArtifactResource[] {
  const restored: ArtifactResource[] = [];
  for (const namespace of readdirSync(rootDirectory, { withFileTypes: true })) {
    if (!namespace.isDirectory() || !isArtifactResourceNamespace(namespace.name)) continue;
    const namespaceDirectory = join(rootDirectory, namespace.name);
    restored.push(
      ...readdirSync(namespaceDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^artifact_\d+\.json$/u.test(entry.name))
        .map((entry) =>
          restoreArtifactResource(
            readFileSync(join(namespaceDirectory, entry.name), "utf8"),
            namespace.name,
            maxContentBytes,
          ),
        ),
    );
  }
  return restored;
}

function fileArtifactError(message: string, context: Record<string, unknown>): KilnError {
  return new KilnError("INTERNAL_ERROR", message, { context, retryable: false });
}

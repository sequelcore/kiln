import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContextArtifact, ContextArtifactCache } from "@kilnai/core";

interface SerializedContextArtifact {
  readonly key: string;
  readonly kind: string;
  readonly content: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly ttlMs?: number;
  readonly tags?: readonly string[];
}

function serializeArtifact(artifact: ContextArtifact): SerializedContextArtifact {
  return {
    key: artifact.key,
    kind: artifact.kind,
    content: artifact.content,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
    ttlMs: artifact.ttlMs,
    tags: artifact.tags,
  };
}

function deserializeArtifact(input: SerializedContextArtifact): ContextArtifact | undefined {
  const createdAt = new Date(input.createdAt);
  const updatedAt = new Date(input.updatedAt);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) {
    return undefined;
  }
  return {
    key: input.key,
    kind: input.kind,
    content: input.content,
    createdAt,
    updatedAt,
    ttlMs: input.ttlMs,
    tags: input.tags,
  };
}

export class ProjectContextArtifactCache implements ContextArtifactCache {
  private readonly filePath: string;
  private readonly artifacts = new Map<string, ContextArtifact>();
  private persistChain: Promise<void> = Promise.resolve();

  constructor(projectPath: string) {
    this.filePath = join(projectPath, ".kiln", "context-artifacts.json");
  }

  async hydrate(): Promise<void> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content) as { artifacts?: SerializedContextArtifact[] };
      this.artifacts.clear();
      for (const artifact of parsed.artifacts ?? []) {
        const current = deserializeArtifact(artifact);
        if (current && !this.isExpired(current)) {
          this.artifacts.set(current.key, current);
        }
      }
    } catch {
      // fail-open
    }
  }

  get(key: string): ContextArtifact | undefined {
    const artifact = this.artifacts.get(key);
    if (!artifact) return undefined;
    if (this.isExpired(artifact)) {
      this.artifacts.delete(key);
      this.schedulePersist();
      return undefined;
    }
    return artifact;
  }

  set(artifact: ContextArtifact): void {
    this.artifacts.set(artifact.key, artifact);
    this.schedulePersist();
  }

  delete(key: string): boolean {
    const deleted = this.artifacts.delete(key);
    if (deleted) {
      this.schedulePersist();
    }
    return deleted;
  }

  listByKind(kind: string): readonly ContextArtifact[] {
    const results: ContextArtifact[] = [];
    for (const artifact of this.artifacts.values()) {
      if (artifact.kind !== kind) continue;
      const current = this.get(artifact.key);
      if (current) results.push(current);
    }
    return results;
  }

  private isExpired(artifact: ContextArtifact): boolean {
    return artifact.ttlMs !== undefined
      && Date.now() > artifact.updatedAt.getTime() + artifact.ttlMs;
  }

  private schedulePersist(): void {
    this.persistChain = this.persistChain
      .then(() => this.persist())
      .catch(() => {
        // fail-open
      });
  }

  private async persist(): Promise<void> {
    try {
      const dir = join(this.filePath, "..");
      await mkdir(dir, { recursive: true });
      const artifacts = [...this.artifacts.values()]
        .filter((artifact) => !this.isExpired(artifact))
        .map(serializeArtifact);
      await writeFile(this.filePath, JSON.stringify({ artifacts }, null, 2), "utf-8");
    } catch {
      // fail-open
    }
  }
}

const projectCaches = new Map<string, ProjectContextArtifactCache>();

export async function getProjectContextArtifactCache(projectPath: string): Promise<ProjectContextArtifactCache> {
  const existing = projectCaches.get(projectPath);
  if (existing) {
    return existing;
  }

  const cache = new ProjectContextArtifactCache(projectPath);
  await cache.hydrate();
  projectCaches.set(projectPath, cache);
  return cache;
}

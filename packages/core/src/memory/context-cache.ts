export interface ContextArtifact {
  readonly key: string;
  readonly kind: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly ttlMs?: number;
  readonly tags?: readonly string[];
}

export interface ContextArtifactCache {
  get(key: string): ContextArtifact | undefined;
  set(artifact: ContextArtifact): void;
  delete(key: string): boolean;
  listByKind(kind: string): readonly ContextArtifact[];
}

export class InMemoryContextArtifactCache implements ContextArtifactCache {
  private readonly artifacts = new Map<string, ContextArtifact>();

  get(key: string): ContextArtifact | undefined {
    const artifact = this.artifacts.get(key);
    if (!artifact) return undefined;
    if (artifact.ttlMs !== undefined) {
      const expiresAt = artifact.updatedAt.getTime() + artifact.ttlMs;
      if (Date.now() > expiresAt) {
        this.artifacts.delete(key);
        return undefined;
      }
    }
    return artifact;
  }

  set(artifact: ContextArtifact): void {
    this.artifacts.set(artifact.key, artifact);
  }

  delete(key: string): boolean {
    return this.artifacts.delete(key);
  }

  listByKind(kind: string): readonly ContextArtifact[] {
    const results: ContextArtifact[] = [];
    for (const artifact of this.artifacts.values()) {
      if (artifact.kind === kind) {
        const current = this.get(artifact.key);
        if (current) results.push(current);
      }
    }
    return results;
  }
}

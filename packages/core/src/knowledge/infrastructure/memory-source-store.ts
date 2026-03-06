// InMemorySourceStore -- Map-based SourceStore for dev/test

import type { KnowledgeSource, SourceStore } from "../../engine/domain/knowledge-source.js";

export class InMemorySourceStore implements SourceStore {
  private readonly sources = new Map<string, KnowledgeSource>();

  private key(appName: string, sourceId: string): string {
    return `${appName}:${sourceId}`;
  }

  get(appName: string, sourceId: string): KnowledgeSource | undefined {
    return this.sources.get(this.key(appName, sourceId));
  }

  list(appName: string): readonly KnowledgeSource[] {
    const result: KnowledgeSource[] = [];
    for (const source of this.sources.values()) {
      if (source.appName === appName) {
        result.push(source);
      }
    }
    return result;
  }

  save(source: KnowledgeSource): void {
    this.sources.set(this.key(source.appName, source.sourceId), source);
  }

  remove(appName: string, sourceId: string): boolean {
    return this.sources.delete(this.key(appName, sourceId));
  }
}

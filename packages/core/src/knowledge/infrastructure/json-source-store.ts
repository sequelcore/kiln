// JsonSourceStore -- JSON file persistence for SourceStore (follows TenantRegistry pattern)

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeSource, SourceStore } from "../../engine/domain/knowledge-source.js";

export class JsonSourceStore implements SourceStore {
  private readonly storageDir: string;
  private readonly sources = new Map<string, KnowledgeSource>();

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    this.load();
  }

  private key(appName: string, sourceId: string): string {
    return `${appName}:${sourceId}`;
  }

  private load(): void {
    if (!existsSync(this.storageDir)) return;
    const files = readdirSync(this.storageDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const content = readFileSync(join(this.storageDir, file), "utf-8");
      const source = JSON.parse(content) as KnowledgeSource;
      this.sources.set(this.key(source.appName, source.sourceId), source);
    }
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
    this.persist(source);
  }

  remove(appName: string, sourceId: string): boolean {
    const key = this.key(appName, sourceId);
    if (!this.sources.has(key)) return false;
    this.sources.delete(key);
    const filePath = join(this.storageDir, `${sourceId}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
    return true;
  }

  private persist(source: KnowledgeSource): void {
    mkdirSync(this.storageDir, { recursive: true });
    const filePath = join(this.storageDir, `${source.sourceId}.json`);
    writeFileSync(filePath, JSON.stringify(source, null, 2), "utf-8");
  }
}

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ChunkImporter, type ImportResult } from "./chunk-importer.js";
import {
  getDeveloperIdentity,
  generateDeveloperId,
} from "./developer-identity.js";
import type { ProjectMemoryStore } from "./project-store.js";
import type { EventBus } from "../events/event-bus.js";
import type { MemorySyncEvent } from "../events/index.js";

interface ManifestChunk {
  readonly hash: string;
  readonly entries: number;
  readonly createdAt: string;
  readonly developer?: string;
}

interface Manifest {
  version: 1;
  chunks: ManifestChunk[];
  deleted: string[];
}

export interface SyncStatus {
  readonly chunks: number;
  readonly entries: number;
  readonly developers: readonly DeveloperInfo[];
  readonly lastSyncAt: Date | null;
}

export interface DeveloperInfo {
  readonly developerId: string;
  readonly chunks: number;
  readonly entries: number;
}

export class GitSyncManager {
  private readonly projectPath: string;
  private readonly eventBus: EventBus | undefined;
  private lastSyncAt: Date | null = null;

  constructor(opts: { projectPath: string; eventBus?: EventBus }) {
    this.projectPath = opts.projectPath;
    this.eventBus = opts.eventBus;
    if (!existsSync(this.projectPath)) {
      mkdirSync(this.projectPath, { recursive: true });
    }
  }

  autoImport(): ImportResult {
    const importer = new ChunkImporter({ projectPath: this.projectPath });
    const newChunks = importer.discoverNewChunks();
    const result = importer.importChunks(newChunks);

    this.lastSyncAt = new Date();

    if (this.eventBus && result.imported > 0) {
      const devSet = new Set<string>();
      const manifest = this.readManifest();
      for (const chunk of manifest.chunks) {
        devSet.add(chunk.developer ?? "unknown");
      }

      const event: MemorySyncEvent = {
        type: "memory_sync",
        timestamp: new Date(),
        sessionId: "",
        imported: result.imported,
        entries: result.entries,
        developers: devSet.size,
      };
      this.eventBus.emit(event);
    }

    return result;
  }

  async flush(store: ProjectMemoryStore): Promise<void> {
    const identity = getDeveloperIdentity();
    const devId = generateDeveloperId(identity);
    await store.flush(devId);
  }

  syncStatus(): SyncStatus {
    const manifest = this.readManifest();
    const devMap = new Map<string, { chunks: number; entries: number }>();

    for (const chunk of manifest.chunks) {
      const devId = chunk.developer ?? "unknown";
      const existing = devMap.get(devId);
      if (existing) {
        existing.chunks++;
        existing.entries += chunk.entries;
      } else {
        devMap.set(devId, { chunks: 1, entries: chunk.entries });
      }
    }

    const developers: DeveloperInfo[] = [];
    for (const [developerId, info] of devMap) {
      developers.push({ developerId, chunks: info.chunks, entries: info.entries });
    }

    return {
      chunks: manifest.chunks.length,
      entries: manifest.chunks.reduce((sum, c) => sum + c.entries, 0),
      developers,
      lastSyncAt: this.lastSyncAt,
    };
  }

  developers(): DeveloperInfo[] {
    const manifest = this.readManifest();
    const devMap = new Map<string, { chunks: number; entries: number }>();

    for (const chunk of manifest.chunks) {
      const devId = chunk.developer ?? "unknown";
      const existing = devMap.get(devId);
      if (existing) {
        existing.chunks++;
        existing.entries += chunk.entries;
      } else {
        devMap.set(devId, { chunks: 1, entries: chunk.entries });
      }
    }

    const result: DeveloperInfo[] = [];
    for (const [developerId, info] of devMap) {
      result.push({ developerId, chunks: info.chunks, entries: info.entries });
    }
    return result;
  }

  private readManifest(): Manifest {
    const path = join(this.projectPath, "manifest.json");
    if (!existsSync(path)) {
      return { version: 1, chunks: [], deleted: [] };
    }
    return JSON.parse(readFileSync(path, "utf-8")) as Manifest;
  }
}

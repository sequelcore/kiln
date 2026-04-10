import { GitSyncManager } from "../memory/git-sync-manager.js";
import type { SyncStatus } from "../memory/git-sync-manager.js";
import type { ProjectMemoryStore } from "../memory/project-store.js";
import type { EventBus } from "../events/event-bus.js";

interface MemorySyncSupportDeps {
  readonly eventBus: EventBus;
}

export class OrchestratorMemorySyncSupport {
  private gitSync: GitSyncManager | null = null;

  constructor(private readonly deps: MemorySyncSupportDeps) {}

  initMemorySync(projectPath: string): void {
    this.gitSync = new GitSyncManager({
      projectPath,
      eventBus: this.deps.eventBus,
    });
    this.gitSync.autoImport();
  }

  memorySyncStatus(): SyncStatus | null {
    return this.gitSync?.syncStatus() ?? null;
  }

  async flushMemory(store: ProjectMemoryStore): Promise<void> {
    if (!this.gitSync) {
      throw new Error("Memory sync not initialized. Call initMemorySync() first.");
    }
    await this.gitSync.flush(store);
  }
}

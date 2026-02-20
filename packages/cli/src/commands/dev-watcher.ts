import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";

export interface WatcherOptions {
  readonly paths: readonly string[];
  readonly debounceMs?: number;
  readonly onReload: (path: string) => void;
  readonly onError?: (error: Error) => void;
}

export class YamlWatcher {
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly paths: readonly string[];
  private readonly onReload: (path: string) => void;
  private readonly onError?: (error: Error) => void;

  constructor(options: WatcherOptions) {
    this.paths = options.paths;
    this.debounceMs = options.debounceMs ?? 300;
    this.onReload = options.onReload;
    this.onError = options.onError;
  }

  /** Start watching configured paths */
  start(): void {
    for (const path of this.paths) {
      try {
        const watcher = watch(path, (eventType) => {
          if (eventType === "change") {
            this.scheduleReload(path);
          }
        });
        this.watchers.push(watcher);
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /** Stop watching all paths */
  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private scheduleReload(path: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.onReload(path);
      this.debounceTimer = null;
    }, this.debounceMs);
  }
}

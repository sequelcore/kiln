/**
 * Mock for bun:sqlite used by vitest (Node.js environment).
 * SqliteMemoryStore requires bun:sqlite at import time; this stub
 * prevents "Cannot find package" errors when the barrel re-exports it.
 * Tests that exercise SqliteMemoryStore directly should run under bun.
 */
export class Database {
  constructor(_path: string) {
    throw new Error("bun:sqlite is not available in vitest -- use bun to run SQLite tests");
  }
  exec(_sql: string): void {}
  prepare(_sql: string) { return { run: () => {}, all: () => [], get: () => null }; }
  close(): void {}
}

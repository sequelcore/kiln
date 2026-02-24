/**
 * Functional mock for bun:sqlite in Vitest Node.js environment.
 * Delegates to better-sqlite3 with ref-counted shared instances for file paths.
 * File-path databases share a single in-memory better-sqlite3 instance keyed by
 * path, avoiding OS file locks that cause EBUSY on Windows during test cleanup.
 */
import BetterSqlite3 from "better-sqlite3";

const shared = new Map<string, { db: BetterSqlite3.Database; refs: number }>();

export class Database {
  private db: BetterSqlite3.Database;
  private readonly key: string;
  private closed = false;

  constructor(path: string) {
    this.key = path;
    if (path === ":memory:") {
      this.db = new BetterSqlite3(":memory:");
      return;
    }
    const entry = shared.get(path);
    if (entry) {
      entry.refs++;
      this.db = entry.db;
    } else {
      const db = new BetterSqlite3(":memory:");
      shared.set(path, { db, refs: 1 });
      this.db = db;
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): { run: (...params: unknown[]) => void; all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown } {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => { stmt.run(...params); },
      all: (...params: unknown[]) => stmt.all(...params),
      get: (...params: unknown[]) => stmt.get(...params) ?? null,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.key === ":memory:") {
      this.db.close();
      return;
    }
    const entry = shared.get(this.key);
    if (entry) {
      entry.refs--;
      if (entry.refs <= 0) {
        entry.db.close();
        shared.delete(this.key);
      }
    }
  }
}

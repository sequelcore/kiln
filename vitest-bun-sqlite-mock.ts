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
    // For non-":memory:" paths, use shared instances with ref-counting
    // to avoid EBUSY on Windows during test cleanup.
    // ":memory:" always gets a fresh instance since there's no
    // persistent identity to preserve across tests.
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

  prepare(sql: string): { run: (...params: unknown[]) => BetterSqlite3.RunResult; all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown } {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => stmt.run(...params),
      all: (...params: unknown[]) => stmt.all(...params),
      get: (...params: unknown[]) => stmt.get(...params) ?? null,
    };
  }

  query(sql: string): ReturnType<Database["prepare"]> {
    return this.prepare(sql);
  }

  transaction<T>(operation: () => T): { immediate: () => T } {
    const transaction = this.db.transaction(operation);
    return { immediate: () => transaction.immediate() };
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
      // Keep file-keyed in-memory databases alive for the Vitest process so
      // close/reopen exercises durable SQLite semantics without Windows file
      // handles preventing temporary-directory cleanup.
    }
  }
}

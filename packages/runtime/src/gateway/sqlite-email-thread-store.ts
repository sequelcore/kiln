import { Database } from "bun:sqlite";
import type { EmailThread, EmailThreadStore } from "./email-thread-store.js";

interface RawRow {
  thread_id: string;
  tenant_id: string;
  sender_email: string;
  subject: string;
  message_ids: string;
  created_at: string;
  last_activity_at: string;
}

export class SqliteEmailThreadStore implements EmailThreadStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_threads (
        thread_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        message_ids TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_email_threads_tenant_sender
      ON email_threads(tenant_id, sender_email);
    `);
  }

  getByMessageId(messageId: string): EmailThread | undefined {
    const row = this.db
      .prepare(`SELECT * FROM email_threads WHERE message_ids LIKE ?`)
      .get(`%"${messageId}"%`) as RawRow | null;
    return row ? this.mapRow(row) : undefined;
  }

  getByReference(references: string[]): EmailThread | undefined {
    for (const ref of references) {
      const thread = this.getByMessageId(ref);
      if (thread) return thread;
    }
    return undefined;
  }

  save(thread: EmailThread): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO email_threads
         (thread_id, tenant_id, sender_email, subject, message_ids, created_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        thread.threadId,
        thread.tenantId,
        thread.senderEmail,
        thread.subject,
        JSON.stringify(thread.messageIds),
        thread.createdAt.toISOString(),
        thread.lastActivityAt.toISOString(),
      );
  }

  delete(threadId: string): void {
    this.db.prepare(`DELETE FROM email_threads WHERE thread_id = ?`).run(threadId);
  }

  close(): void {
    this.db.close();
  }

  private mapRow(row: RawRow): EmailThread {
    return {
      threadId: row.thread_id,
      tenantId: row.tenant_id,
      senderEmail: row.sender_email,
      subject: row.subject,
      messageIds: JSON.parse(row.message_ids) as string[],
      createdAt: new Date(row.created_at),
      lastActivityAt: new Date(row.last_activity_at),
    };
  }
}

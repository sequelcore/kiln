// Email thread tracking via Message-ID chain
// Maps Message-ID headers to thread state for conversational continuity

export interface EmailThread {
  readonly threadId: string;
  readonly tenantId: string;
  readonly senderEmail: string;
  readonly subject: string;
  readonly messageIds: string[];
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
}

export interface EmailThreadStore {
  getByMessageId(messageId: string): EmailThread | undefined;
  getByReference(references: string[]): EmailThread | undefined;
  save(thread: EmailThread): void;
  delete(threadId: string): void;
}

export class InMemoryEmailThreadStore implements EmailThreadStore {
  private readonly messageIdIndex = new Map<string, string>();
  private readonly threads = new Map<string, EmailThread>();

  getByMessageId(messageId: string): EmailThread | undefined {
    const threadId = this.messageIdIndex.get(messageId);
    return threadId ? this.threads.get(threadId) : undefined;
  }

  getByReference(references: string[]): EmailThread | undefined {
    for (const ref of references) {
      const threadId = this.messageIdIndex.get(ref);
      if (threadId) return this.threads.get(threadId);
    }
    return undefined;
  }

  save(thread: EmailThread): void {
    this.threads.set(thread.threadId, thread);
    for (const mid of thread.messageIds) {
      this.messageIdIndex.set(mid, thread.threadId);
    }
  }

  delete(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    for (const mid of thread.messageIds) {
      this.messageIdIndex.delete(mid);
    }
    this.threads.delete(threadId);
  }
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteEmailThreadStore } from "../../src/gateway/sqlite-email-thread-store.js";
import type { EmailThread } from "../../src/gateway/email-thread-store.js";

function makeThread(overrides?: Partial<EmailThread>): EmailThread {
  return {
    threadId: "thread-1",
    tenantId: "tenant-1",
    senderEmail: "user@example.com",
    subject: "Test Subject",
    messageIds: ["<msg-1@example.com>"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastActivityAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("SqliteEmailThreadStore", () => {
  let store: SqliteEmailThreadStore;

  beforeEach(() => {
    store = new SqliteEmailThreadStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("saves and retrieves by message ID", () => {
    const thread = makeThread();
    store.save(thread);

    const found = store.getByMessageId("<msg-1@example.com>");
    expect(found).toBeDefined();
    expect(found!.threadId).toBe("thread-1");
    expect(found!.senderEmail).toBe("user@example.com");
    expect(found!.messageIds).toEqual(["<msg-1@example.com>"]);
  });

  it("returns undefined for unknown message ID", () => {
    expect(store.getByMessageId("<unknown@example.com>")).toBeUndefined();
  });

  it("retrieves by reference (checks all references in order)", () => {
    const thread = makeThread({ messageIds: ["<msg-1@example.com>", "<msg-2@example.com>"] });
    store.save(thread);

    const found = store.getByReference(["<unknown@example.com>", "<msg-2@example.com>"]);
    expect(found).toBeDefined();
    expect(found!.threadId).toBe("thread-1");
  });

  it("getByReference returns undefined when no references match", () => {
    store.save(makeThread());
    expect(store.getByReference(["<no-match@example.com>"])).toBeUndefined();
  });

  it("deletes a thread", () => {
    store.save(makeThread());
    store.delete("thread-1");
    expect(store.getByMessageId("<msg-1@example.com>")).toBeUndefined();
  });

  it("upserts on save (updates existing thread)", () => {
    store.save(makeThread({ subject: "Original" }));
    store.save(makeThread({ subject: "Updated", messageIds: ["<msg-1@example.com>", "<msg-3@example.com>"] }));

    const found = store.getByMessageId("<msg-1@example.com>");
    expect(found!.subject).toBe("Updated");
    expect(found!.messageIds).toEqual(["<msg-1@example.com>", "<msg-3@example.com>"]);
  });

  it("handles multiple threads independently", () => {
    store.save(makeThread({ threadId: "thread-1", messageIds: ["<a@example.com>"] }));
    store.save(makeThread({ threadId: "thread-2", senderEmail: "other@example.com", messageIds: ["<b@example.com>"] }));

    expect(store.getByMessageId("<a@example.com>")!.threadId).toBe("thread-1");
    expect(store.getByMessageId("<b@example.com>")!.threadId).toBe("thread-2");
  });

  it("preserves date roundtrip", () => {
    const created = new Date("2026-03-07T12:30:00Z");
    const lastActivity = new Date("2026-03-07T14:00:00Z");
    store.save(makeThread({ createdAt: created, lastActivityAt: lastActivity }));

    const found = store.getByMessageId("<msg-1@example.com>");
    expect(found!.createdAt.toISOString()).toBe(created.toISOString());
    expect(found!.lastActivityAt.toISOString()).toBe(lastActivity.toISOString());
  });

  it("close does not throw", () => {
    expect(() => store.close()).not.toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { InMemoryEmailThreadStore } from "../../src/gateway/email-thread-store.js";
import type { EmailThread } from "../../src/gateway/email-thread-store.js";

function makeThread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    threadId: "thread-1",
    tenantId: "tenant-1",
    senderEmail: "user@example.com",
    subject: "Test subject",
    messageIds: ["<msg-1@example.com>"],
    createdAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

describe("InMemoryEmailThreadStore", () => {
  it("getByMessageId returns stored thread", () => {
    const store = new InMemoryEmailThreadStore();
    const thread = makeThread();
    store.save(thread);

    const found = store.getByMessageId("<msg-1@example.com>");
    expect(found).toBeDefined();
    expect(found!.threadId).toBe("thread-1");
  });

  it("getByMessageId returns undefined for unknown id", () => {
    const store = new InMemoryEmailThreadStore();
    expect(store.getByMessageId("<unknown@example.com>")).toBeUndefined();
  });

  it("getByReference finds thread by any reference in the chain", () => {
    const store = new InMemoryEmailThreadStore();
    const thread = makeThread({
      messageIds: ["<msg-1@example.com>", "<msg-2@example.com>", "<msg-3@example.com>"],
    });
    store.save(thread);

    const found = store.getByReference(["<unknown@example.com>", "<msg-2@example.com>"]);
    expect(found).toBeDefined();
    expect(found!.threadId).toBe("thread-1");
  });

  it("getByReference returns undefined when no references match", () => {
    const store = new InMemoryEmailThreadStore();
    store.save(makeThread());

    const found = store.getByReference(["<unknown-1@example.com>", "<unknown-2@example.com>"]);
    expect(found).toBeUndefined();
  });

  it("save indexes all messageIds", () => {
    const store = new InMemoryEmailThreadStore();
    const thread = makeThread({
      messageIds: ["<a@example.com>", "<b@example.com>"],
    });
    store.save(thread);

    expect(store.getByMessageId("<a@example.com>")).toBeDefined();
    expect(store.getByMessageId("<b@example.com>")).toBeDefined();
  });

  it("delete removes thread and all index entries", () => {
    const store = new InMemoryEmailThreadStore();
    const thread = makeThread({
      messageIds: ["<a@example.com>", "<b@example.com>"],
    });
    store.save(thread);

    store.delete("thread-1");

    expect(store.getByMessageId("<a@example.com>")).toBeUndefined();
    expect(store.getByMessageId("<b@example.com>")).toBeUndefined();
  });

  it("delete is a no-op for unknown threadId", () => {
    const store = new InMemoryEmailThreadStore();
    // Should not throw
    store.delete("nonexistent");
  });

  it("save updates existing thread data", () => {
    const store = new InMemoryEmailThreadStore();
    const thread = makeThread();
    store.save(thread);

    const updated: EmailThread = {
      ...thread,
      messageIds: ["<msg-1@example.com>", "<msg-2@example.com>"],
      lastActivityAt: new Date(),
    };
    store.save(updated);

    const found = store.getByMessageId("<msg-2@example.com>");
    expect(found).toBeDefined();
    expect(found!.messageIds).toHaveLength(2);
  });
});

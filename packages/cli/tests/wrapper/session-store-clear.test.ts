import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore } from "../../src/wrapper/session-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionRecord } from "../../src/wrapper/session-store.js";

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "sess-1",
    provider: "claude",
    task: "interactive",
    completedAt: new Date().toISOString(),
    cost: 0,
    projectPath: "/p",
    ...overrides,
  };
}

describe("SessionStore.clearLast()", () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kiln-store-clear-"));
    store = new SessionStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes the last record for the given provider", async () => {
    await store.append(makeRecord({ sessionId: "a", provider: "claude" }));
    await store.append(makeRecord({ sessionId: "b", provider: "claude" }));

    await store.clearLast("claude");

    const last = await store.last("claude");
    expect(last?.sessionId).toBe("a");
  });

  it("removes the last record when no provider given", async () => {
    await store.append(makeRecord({ sessionId: "x", provider: "codex" }));
    await store.append(makeRecord({ sessionId: "y", provider: "opencode" }));

    await store.clearLast();

    const last = await store.last();
    expect(last?.sessionId).toBe("x");
  });

  it("does not remove records for other providers", async () => {
    await store.append(makeRecord({ sessionId: "c1", provider: "claude" }));
    await store.append(makeRecord({ sessionId: "cx1", provider: "codex" }));

    await store.clearLast("claude");

    const codexLast = await store.last("codex");
    expect(codexLast?.sessionId).toBe("cx1");
  });

  it("is a no-op when store is empty", async () => {
    // Should not throw
    await expect(store.clearLast("claude")).resolves.toBeUndefined();
    const last = await store.last();
    expect(last).toBeNull();
  });

  it("removes the last of multiple records for same provider, keeps others", async () => {
    await store.append(makeRecord({ sessionId: "a1", provider: "claude" }));
    await store.append(makeRecord({ sessionId: "a2", provider: "claude" }));
    await store.append(makeRecord({ sessionId: "a3", provider: "claude" }));

    await store.clearLast("claude");

    const last = await store.last("claude");
    expect(last?.sessionId).toBe("a2");

    // Verify a1 is still present
    const found = await store.find("a1");
    expect(found?.sessionId).toBe("a1");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore, TranscriptStore } from "../../src/wrapper/session-store.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

  it("persists provider-native resume identity under providerThread only", async () => {
    await store.append(makeRecord({
      sessionId: "k-1",
      provider: "codex",
      providerThread: { provider: "codex", nativeSessionId: "thread-1" },
    }));

    const raw = await readFile(join(tmpDir, ".kiln", "sessions.jsonl"), "utf-8");
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;

    expect(parsed.providerThread).toEqual({
      provider: "codex",
      nativeSessionId: "thread-1",
    });
    expect(parsed).not.toHaveProperty("providerSessionId");
  });

  it("round-trips canonical metadata fields", async () => {
    await store.append(makeRecord({
      sessionId: "meta-1",
      canonicalTitle: "Plan session ledger metadata",
      summary: "Plan session ledger metadata with provider history.",
      tags: ["planning", "session-ledger"],
      providersUsed: ["claude", "codex-oauth"],
    }));

    const listed = await store.list();
    expect(listed[0]).toMatchObject({
      sessionId: "meta-1",
      canonicalTitle: "Plan session ledger metadata",
      summary: "Plan session ledger metadata with provider history.",
      tags: ["planning", "session-ledger"],
      providersUsed: ["claude", "codex-oauth"],
    });
  });

  it("find returns the latest record for a repeated session id", async () => {
    await store.append(makeRecord({
      sessionId: "reused-1",
      canonicalTitle: "Initial title",
      providersUsed: ["claude"],
    }));
    await store.append(makeRecord({
      sessionId: "reused-1",
      provider: "codex-oauth",
      canonicalTitle: "Initial title",
      providersUsed: ["claude", "codex-oauth"],
    }));

    const found = await store.find("reused-1");
    expect(found).toMatchObject({
      provider: "codex-oauth",
      providersUsed: ["claude", "codex-oauth"],
    });
  });
});

describe("TranscriptStore", () => {
  let tmpDir: string;
  let store: TranscriptStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kiln-transcript-store-"));
    store = new TranscriptStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("persists canonical GUI session ids that contain Windows-invalid path characters", async () => {
    const sessionId = "kiln-gui:_gui:user-1:1776916220893";

    await store.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-04-23T03:50:00.000Z",
    });
    await store.append(sessionId, {
      eventId: "evt-1",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-04-23T03:50:01.000Z",
      kind: "user_message",
      source: { actor: "user", surface: "gui" },
      payload: { content: "hello" },
    });

    const transcriptPath = join(
      tmpDir,
      ".kiln",
      "sessions",
      encodeURIComponent(sessionId),
      "transcript.jsonl",
    );
    const persisted = JSON.parse((await readFile(transcriptPath, "utf-8")).trim()) as Record<string, unknown>;
    const listed = await store.listSessions();
    const meta = await store.readMeta(sessionId);
    const transcript = await store.readTranscript(sessionId);
    const dirs = await readdir(join(tmpDir, ".kiln", "sessions"));

    expect(persisted).toMatchObject({
      eventId: "evt-1",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-04-23T03:50:01.000Z",
      kind: "user_message",
      source: { actor: "user", surface: "gui" },
      payload: { content: "hello" },
    });
    expect(persisted).not.toHaveProperty("seq");
    expect(persisted).not.toHaveProperty("event");
    expect(listed).toEqual([sessionId]);
    expect(meta?.kilnSessionId).toBe(sessionId);
    expect(transcript[0]).toMatchObject({
      eventId: "evt-1",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-04-23T03:50:01.000Z",
      kind: "user_message",
      source: { actor: "user", surface: "gui" },
      payload: { content: "hello" },
    });
    expect(dirs[0]).toBe(encodeURIComponent(sessionId));
  });

  it("does not parse legacy wrapped transcript lines", async () => {
    const sessionId = "kiln-gui:_gui:user-1:1776916220893";

    await store.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-04-23T03:50:00.000Z",
    });

    const transcriptPath = join(
      tmpDir,
      ".kiln",
      "sessions",
      encodeURIComponent(sessionId),
      "transcript.jsonl",
    );
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        seq: 1,
        ts: "2026-04-23T03:50:01.000Z",
        event: { type: "user", content: "hello" },
      })}\n`,
      "utf-8",
    );

    const transcript = await store.readTranscript(sessionId);
    expect(transcript).toEqual([]);
  });
});

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

describe("SessionStore resume targets", () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kiln-store-clear-"));
    store = new SessionStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores resume targets separately from the canonical session index", async () => {
    await store.append(makeRecord({ sessionId: "a", provider: "claude" }));
    await store.append(makeRecord({ sessionId: "b", provider: "claude" }));

    expect((await store.getResumeTarget("claude"))?.sessionId).toBe("b");

    await store.clearResumeTarget("claude");

    expect(await store.getResumeTarget("claude")).toBeNull();
    expect((await store.last("claude"))?.sessionId).toBe("b");
    expect((await store.list()).map((record) => record.sessionId)).toEqual(["b", "a"]);
  });

  it("clears all resume targets without deleting session records", async () => {
    await store.append(makeRecord({ sessionId: "x", provider: "codex" }));
    await store.append(makeRecord({ sessionId: "y", provider: "opencode" }));

    expect((await store.getResumeTarget())?.sessionId).toBe("y");
    expect((await store.getResumeTarget("codex"))?.sessionId).toBe("x");

    await store.clearResumeTarget();

    expect(await store.getResumeTarget()).toBeNull();
    expect(await store.getResumeTarget("codex")).toBeNull();
    expect((await store.list()).map((record) => record.sessionId)).toEqual(["y", "x"]);
  });

  it("clears one provider resume target without deleting other provider targets", async () => {
    await store.append(makeRecord({ sessionId: "c1", provider: "claude" }));
    await store.append(makeRecord({ sessionId: "cx1", provider: "codex" }));

    await store.clearResumeTarget("claude");

    expect(await store.getResumeTarget("claude")).toBeNull();
    expect((await store.getResumeTarget("codex"))?.sessionId).toBe("cx1");
    expect((await store.last("claude"))?.sessionId).toBe("c1");
  });

  it("is a no-op when store is empty", async () => {
    await expect(store.clearResumeTarget("claude")).resolves.toBeUndefined();
    const last = await store.last();
    expect(last).toBeNull();
  });

  it("updates the resume target to the latest record for the same provider", async () => {
    await store.append(makeRecord({ sessionId: "a1", provider: "claude" }));
    await store.append(makeRecord({ sessionId: "a2", provider: "claude" }));
    await store.append(makeRecord({ sessionId: "a3", provider: "claude" }));

    const last = await store.last("claude");
    expect(last?.sessionId).toBe("a3");
    expect((await store.getResumeTarget("claude"))?.sessionId).toBe("a3");
    expect((await store.list()).filter((record) => record.provider === "claude")).toHaveLength(3);
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
    const listed = await store.list();
    expect(found).toMatchObject({
      provider: "codex-oauth",
      providersUsed: ["claude", "codex-oauth"],
    });
    expect(listed.filter((record) => record.sessionId === "reused-1")).toHaveLength(1);
  });

  it("does not double-count identical repeated session writes", async () => {
    const completedAt = "2026-05-08T00:00:00.000Z";
    const record = makeRecord({
      sessionId: "same-turn",
      provider: "codex-oauth",
      completedAt,
      cost: 0.25,
    });

    await store.append(record);
    await store.append(record);

    expect((await store.find("same-turn"))?.cost).toBe(0.25);
    expect(await store.list()).toHaveLength(1);
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

  it("accumulates provider token usage across transcript finalization calls", async () => {
    const sessionId = "kiln-gui:_gui:user-1:1776916220893";

    await store.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-04-23T03:50:00.000Z",
    });

    await store.finalize(sessionId, {
      providerTokenUsage: [
        { provider: "codex-oauth", model: "gpt-5.4", inputTokens: 10, outputTokens: 5 },
      ],
    });
    await store.finalize(sessionId, {
      providerTokenUsage: [
        { provider: "codex-oauth", model: "gpt-5.4", inputTokens: 7, cacheReadTokens: 3 },
        { provider: "openai", model: "gpt-5.4", inputTokens: 2, outputTokens: 1 },
      ],
    });

    const meta = await store.readMeta(sessionId);
    expect(meta?.providerTokenUsage).toEqual([
      {
        provider: "codex-oauth",
        model: "gpt-5.4",
        inputTokens: 17,
        outputTokens: 5,
        cacheReadTokens: 3,
        cacheWriteTokens: 0,
      },
      {
        provider: "openai",
        model: "gpt-5.4",
        inputTokens: 2,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
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

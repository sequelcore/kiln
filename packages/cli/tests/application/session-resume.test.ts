import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../../src/wrapper/session-store.js";
import { resolveResumeSessionId } from "../../src/application/session-resume.js";

describe("resolveResumeSessionId", () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kiln-session-resume-"));
    store = new SessionStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when resume flag is false", async () => {
    await store.append({
      sessionId: "k-1",
      provider: "claude",
      task: "task",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });

    const resolved = await resolveResumeSessionId(tmpDir, false, "claude");
    expect(resolved).toBeUndefined();
  });

  it("returns canonical last session when provider matches", async () => {
    await store.append({
      sessionId: "k-1",
      provider: "claude",
      task: "task-1",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });
    await store.append({
      sessionId: "k-2",
      provider: "claude",
      task: "task-2",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });

    const resolved = await resolveResumeSessionId(tmpDir, true, "claude");
    expect(resolved).toBe("k-2");
  });

  it("returns canonical last session even when it belongs to another provider", async () => {
    await store.append({
      sessionId: "claude-1",
      provider: "claude",
      task: "claude-task",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });
    await store.append({
      sessionId: "codex-1",
      provider: "codex",
      task: "codex-task",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });

    const resolved = await resolveResumeSessionId(tmpDir, true, "claude");
    expect(resolved).toBe("codex-1");
  });

  it("returns canonical last session when provider has no history", async () => {
    await store.append({
      sessionId: "codex-1",
      provider: "codex",
      task: "codex-task",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });

    const resolved = await resolveResumeSessionId(tmpDir, true, "claude");
    expect(resolved).toBe("codex-1");
  });
});

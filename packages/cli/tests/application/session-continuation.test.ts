import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore, TranscriptStore } from "../../src/wrapper/session-store.js";
import { resolveContinuationSessionId } from "../../src/application/session-continuation.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../../src/application/project-state-root.js";

describe("resolveContinuationSessionId", () => {
  let tmpDir: string;
  let state: ProjectStateBinding;
  let store: SessionStore;
  let transcriptStore: TranscriptStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kiln-session-continuation-"));
    state = resolveProjectStateBinding(tmpDir);
    store = new SessionStore(tmpDir);
    transcriptStore = new TranscriptStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when continuation flag is false", async () => {
    await store.append({
      sessionId: "k-1",
      provider: "claude",
      task: "task",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });

    const resolved = await resolveContinuationSessionId(tmpDir, {
      continuation: false,
    });
    expect(resolved).toBeUndefined();
  });

  it("returns canonical continuation target when provider matches", async () => {
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

    const resolved = await resolveContinuationSessionId(tmpDir, {
      continuation: true,
    });
    expect(resolved).toBe("k-2");
  });

  it("returns canonical continuation target even when it belongs to another provider", async () => {
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

    const resolved = await resolveContinuationSessionId(tmpDir, {
      continuation: true,
    });
    expect(resolved).toBe("codex-1");
  });

  it("returns canonical continuation target when provider has no history", async () => {
    await store.append({
      sessionId: "codex-1",
      provider: "codex",
      task: "codex-task",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });

    const resolved = await resolveContinuationSessionId(tmpDir, {
      continuation: true,
    });
    expect(resolved).toBe("codex-1");
  });

  it("returns explicit session id when it exists", async () => {
    await store.append({
      sessionId: "k-explicit",
      provider: "codex",
      task: "codex-task",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });
    await store.append({
      sessionId: "k-latest",
      provider: "claude",
      task: "claude-task",
      completedAt: new Date().toISOString(),
      cost: 0,
      projectPath: tmpDir,
    });

    const resolved = await resolveContinuationSessionId(tmpDir, {
      explicitSessionId: "k-explicit",
    });
    expect(resolved).toBe("k-explicit");
  });

  it("returns explicit session id when it only exists in transcript metadata", async () => {
    await transcriptStore.init("transcript-only", {
      kilnSessionId: "transcript-only",
      provider: "codex-oauth",
      task: "direct provider task",
      startedAt: new Date().toISOString(),
    });

    const resolved = await resolveContinuationSessionId(tmpDir, {
      explicitSessionId: "transcript-only",
    });
    expect(resolved).toBe("transcript-only");
  });

  it("returns canonical continuation target when it only exists in transcript metadata", async () => {
    await transcriptStore.init("target-transcript-only", {
      kilnSessionId: "target-transcript-only",
      provider: "codex-oauth",
      task: "gui task",
      startedAt: new Date().toISOString(),
    });
    await mkdir(state.sessionsPath, { recursive: true });
    await writeFile(
      join(state.sessionsPath, "continuation-targets.json"),
      JSON.stringify({ defaultSessionId: "target-transcript-only" }),
      "utf-8",
    );

    const resolved = await resolveContinuationSessionId(tmpDir, {
      continuation: true,
    });
    expect(resolved).toBe("target-transcript-only");
  });

  it("throws when explicit session id does not exist", async () => {
    await expect(resolveContinuationSessionId(tmpDir, {
      explicitSessionId: "missing-session",
    })).rejects.toThrow("Cannot continue unknown Kiln session 'missing-session'");
  });
});

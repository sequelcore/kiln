import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractText } from "@kilnai/core";
import { RuntimeSession } from "@kilnai/runtime";
import { createTranscriptRuntimeSessionHydrator } from "../../src/application/runtime-session-rehydration.js";
import { TranscriptStore } from "../../src/wrapper/session-store.js";

describe("createTranscriptRuntimeSessionHydrator", () => {
  let tmpDir: string;
  let transcriptStore: TranscriptStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kiln-runtime-rehydrate-"));
    transcriptStore = new TranscriptStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rehydrates bounded conversational history from canonical transcript events", async () => {
    const sessionId = "kiln-gui:_gui:user-1:1778246833142";
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-05-08T00:00:00.000Z",
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-1",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-05-08T00:00:01.000Z",
      kind: "user_message",
      source: { actor: "user", surface: "gui" },
      payload: { content: "hello" },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-2",
      kilnSessionId: sessionId,
      sequence: 2,
      timestamp: "2026-05-08T00:00:02.000Z",
      kind: "assistant_message",
      source: { actor: "assistant", surface: "gui" },
      payload: { messageId: "a1", content: "Hello Alex." },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-3",
      kilnSessionId: sessionId,
      sequence: 3,
      timestamp: "2026-05-08T00:00:03.000Z",
      kind: "tool_call_completed",
      source: { actor: "tool", surface: "gui" },
      payload: { toolName: "read", output: "ignored as instruction" },
    });

    const session = new RuntimeSession({
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "user-1",
      sessionId,
      systemPrompt: "test",
    });
    const hydrate = createTranscriptRuntimeSessionHydrator({ transcriptStore });
    const result = await hydrate({ sessionId, session });

    expect(result).toMatchObject({
      rehydrated: true,
      messageCount: 2,
      sourceSequence: 3,
    });
    expect(session.conversationHistory.map((message) => ({
      role: message.role,
      content: extractText(message.parts),
    }))).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hello Alex." },
    ]);
  });
});

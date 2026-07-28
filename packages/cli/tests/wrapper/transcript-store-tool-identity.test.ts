import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TranscriptStore,
  type PersistedTranscriptEventDraft,
} from "../../src/wrapper/session-store.js";

const temporaryDirectories: string[] = [];

async function createStore(): Promise<{ root: string; store: TranscriptStore }> {
  const root = await mkdtemp(join(tmpdir(), "kiln-transcript-identity-"));
  temporaryDirectories.push(root);
  return { root, store: new TranscriptStore(root) };
}

function toolEvent(
  eventId: string,
  kind: "tool_call_started" | "tool_call_completed",
  toolCallScopeId: string | undefined,
  toolCallId = "call-1",
): PersistedTranscriptEventDraft {
  return {
    eventId,
    kilnSessionId: "session-1",
    timestamp: "2026-07-28T00:00:00.000Z",
    kind,
    payload: {
      toolCallId,
      ...(toolCallScopeId === undefined ? {} : { toolCallScopeId }),
      toolName: "read",
      ...(kind === "tool_call_completed"
        ? { status: { state: "succeeded" }, durationMs: 1 }
        : {}),
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("TranscriptStore tool identity", () => {
  it("persists a matching scoped start and completion", async () => {
    const { store } = await createStore();

    await store.appendManyNext("session-1", [
      toolEvent("start-1", "tool_call_started", "turn-1:response:1"),
      toolEvent("result-1", "tool_call_completed", "turn-1:response:1"),
    ]);

    expect(await store.readTranscript("session-1")).toHaveLength(2);
  });

  it("rejects new tool records without a normalization scope", async () => {
    const { store } = await createStore();

    await expect(store.appendNext(
      "session-1",
      toolEvent("start-1", "tool_call_started", undefined),
    )).rejects.toThrow(/toolCallScopeId/);
  });

  it("rejects duplicate tool calls within one normalization scope", async () => {
    const { store } = await createStore();

    await expect(store.appendManyNext("session-1", [
      toolEvent("start-1", "tool_call_started", "turn-1:response:1"),
      toolEvent("start-2", "tool_call_started", "turn-1:response:1"),
    ])).rejects.toThrow(/duplicate tool call identity/);
  });

  it("allows a provider tool id to be reused in a different response scope", async () => {
    const { store } = await createStore();

    await store.appendManyNext("session-1", [
      toolEvent("start-1", "tool_call_started", "turn-1:response:1"),
      toolEvent("result-1", "tool_call_completed", "turn-1:response:1"),
      toolEvent("start-2", "tool_call_started", "turn-1:response:2"),
      toolEvent("result-2", "tool_call_completed", "turn-1:response:2"),
    ]);

    expect(await store.readTranscript("session-1")).toHaveLength(4);
  });

  it("rejects an existing unscoped tool transcript instead of skipping it", async () => {
    const { store } = await createStore();
    const directory = store.sessionDir("session-1");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "transcript.jsonl"),
      `${JSON.stringify({
        ...toolEvent("start-1", "tool_call_started", undefined),
        sequence: 1,
      })}\n`,
      "utf8",
    );

    await expect(store.readTranscript("session-1")).rejects.toThrow(/toolCallScopeId/);
  });
});

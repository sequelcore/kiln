import { describe, expect, it, vi } from "vitest";
import { CliSubscriptionExecutor } from "../../src/execution/cli-subscription-executor.js";

type SessionEvent =
  | { type: "text_delta"; content: string; isThinking?: boolean }
  | { type: "tool_use"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; output: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number }
  | { type: "cost_update"; usd: number; inputTokens?: number; outputTokens?: number }
  | { type: "completed"; totalUsd: number; durationMs: number; isError: boolean; isPreflightCrash: boolean }
  | { type: "error"; code: string; message: string; isRetryable: boolean };

function eventStream(events: readonly SessionEvent[]): AsyncIterable<SessionEvent> {
  return (async function* (): AsyncGenerator<SessionEvent> {
    for (const event of events) {
      yield event;
    }
  })();
}

describe("CliSubscriptionExecutor", () => {
  it("does not infer file_changed from tool_result strings", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn().mockReturnValue({
      run: () => eventStream([
        { type: "text_delta", content: "done" },
        { type: "tool_result", toolName: "Edit", output: "Updated src/app.ts" },
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
      dispose,
    });
    const onEvent = vi.fn();
    const executor = new CliSubscriptionExecutor(factory, "claude", onEvent);

    const result = await executor.createMessage({
      system: "sys",
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    });

    expect(result.stopReason).toBe("end_turn");
    expect(onEvent.mock.calls.some((call) => call[0]?.type === "file_changed")).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("forwards structured file_changed events emitted by the execution boundary", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn().mockReturnValue({
      run: () => eventStream([
        { type: "tool_result", toolName: "Edit", output: "Updated src/app.ts" },
        { type: "file_changed", path: "src/app.ts", changeType: "modified", linesAdded: 3, linesRemoved: 1 },
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
      dispose,
    });
    const onEvent = vi.fn();
    const executor = new CliSubscriptionExecutor(factory, "claude", onEvent);

    await executor.createMessage({
      system: "sys",
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    });

    const fileChangedEvents = onEvent.mock.calls
      .map((call) => call[0])
      .filter((event) => event?.type === "file_changed");
    expect(fileChangedEvents).toHaveLength(1);
    expect(fileChangedEvents[0]).toMatchObject({
      type: "file_changed",
      path: "src/app.ts",
      changeType: "modified",
      linesAdded: 3,
      linesRemoved: 1,
    });
  });
});

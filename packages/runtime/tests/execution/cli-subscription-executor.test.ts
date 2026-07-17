import { describe, expect, it, vi } from "vitest";
import { extractText, type ExecutionSessionEvent } from "@kilnai/core";
import { CliSubscriptionExecutor } from "../../src/execution/cli-subscription-executor.js";

function eventStream(events: readonly ExecutionSessionEvent[]): AsyncIterable<ExecutionSessionEvent> {
  return (async function* (): AsyncGenerator<ExecutionSessionEvent> {
    for (const event of events) {
      yield event;
    }
  })();
}

describe("CliSubscriptionExecutor", () => {
  it("builds an empty prompt for empty history", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const executor = new CliSubscriptionExecutor(factory, "claude");

    await executor.createMessage({
      system: "sys",
      messages: [],
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]?.prompt).toBe("");
  });

  it("passes the runtime session id through the factory and run options", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const executor = new CliSubscriptionExecutor(factory, "claude");

    await executor.createMessage({
      sessionId: "kiln-runtime-session",
      system: "sys",
      messages: [],
    });

    expect(factory.mock.calls[0]?.[2]).toEqual({ kilnSessionId: "kiln-runtime-session" });
    expect(run.mock.calls[0]?.[0]?.kilnSessionId).toBe("kiln-runtime-session");
  });

  it("passes the provider abort signal into the nested CLI session", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const executor = new CliSubscriptionExecutor(factory, "codex-oauth");
    const controller = new AbortController();

    await executor.createMessage({
      system: "sys",
      messages: [],
      signal: controller.signal,
    });

    expect(run.mock.calls[0]?.[0]?.abortSignal).toBe(controller.signal);
  });

  it("uses the admitted turn execution context for the nested subscription session", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const executor = new CliSubscriptionExecutor(factory, "codex-oauth");

    await executor.createMessage({
      sessionId: "kiln-runtime-session",
      system: "sys",
      messages: [],
      executionContext: {
        workingDirectory: "C:\\Proyectos\\Sequel\\kiln",
        requestedAuthority: "destructive",
      },
    });

    expect(factory).toHaveBeenCalledWith(
      "sys",
      "C:\\Proyectos\\Sequel\\kiln",
      {
        kilnSessionId: "kiln-runtime-session",
        requestedAuthority: "destructive",
      },
    );
    expect(run.mock.calls[0]?.[0]?.cwd).toBe("C:\\Proyectos\\Sequel\\kiln");
  });

  it("passes the active operator surface through the factory context", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const operatorSurface = {
      theme: {
        setTheme: vi.fn(),
      },
    };
    const executor = new CliSubscriptionExecutor(factory, "codex-oauth", undefined, () => operatorSurface);

    await executor.createMessage({
      sessionId: "kiln-runtime-session",
      system: "sys",
      messages: [],
    });

    expect(factory.mock.calls[0]?.[2]).toEqual({
      kilnSessionId: "kiln-runtime-session",
      operatorSurface,
    });
  });

  it("passes requested reasoning effort through to the subscription session", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const executor = new CliSubscriptionExecutor(factory, "codex");

    await executor.createMessage({
      system: "sys",
      messages: [],
      reasoningEffort: "high",
    });

    expect(run.mock.calls[0]?.[0]?.reasoningEffort).toBe("high");
  });

  it("builds a single-message prompt without labels", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const executor = new CliSubscriptionExecutor(factory, "claude");

    await executor.createMessage({
      system: "sys",
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]?.prompt).toBe("hello");
  });

  it("builds a multi-turn prompt with role labels and blank-line separators", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const executor = new CliSubscriptionExecutor(factory, "claude");

    await executor.createMessage({
      system: "sys",
      messages: [
        { role: "user", parts: [{ type: "text", text: "u1" }] },
        { role: "assistant", parts: [{ type: "text", text: "a1" }] },
        { role: "user", parts: [{ type: "text", text: "u2" }] },
      ],
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]?.prompt).toBe("User: u1\n\nAssistant: a1\n\nUser: u2");
  });

  it("forwards structured messages for transcript projection while keeping the provider prompt serialized", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(() =>
      eventStream([
        { type: "completed", totalUsd: 0, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
    );
    const factory = vi.fn().mockReturnValue({ run, dispose });
    const executor = new CliSubscriptionExecutor(factory, "codex-oauth");

    await executor.createMessage({
      system: "sys",
      messages: [
        { role: "user", parts: [{ type: "text", text: "first" }] },
        { role: "assistant", parts: [{ type: "text", text: "second" }] },
        { role: "user", parts: [{ type: "text", text: "third" }] },
      ],
    });

    expect(run.mock.calls[0]?.[0]).toMatchObject({
      prompt: "User: first\n\nAssistant: second\n\nUser: third",
      system: "sys",
      messages: [
        { role: "user", parts: [{ type: "text", text: "first" }] },
        { role: "assistant", parts: [{ type: "text", text: "second" }] },
        { role: "user", parts: [{ type: "text", text: "third" }] },
      ],
    });
  });

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

  it("accumulates non-thinking text deltas and tracks latest token counts", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn().mockReturnValue({
      run: () => eventStream([
        { type: "text_delta", content: "thinking...", isThinking: true },
        { type: "text_delta", content: "Hello " },
        { type: "cost_update", usd: 0.01, inputTokens: 10 },
        { type: "text_delta", content: "world" },
        { type: "cost_update", usd: 0.02, outputTokens: 7, cacheReadTokens: 3 },
        { type: "cost_update", usd: 0.03, inputTokens: 12, outputTokens: 9, cacheReadTokens: 4 },
        { type: "completed", totalUsd: 0.03, durationMs: 1, isError: false, isPreflightCrash: false },
      ]),
      dispose,
    });
    const executor = new CliSubscriptionExecutor(factory, "claude");

    const result = await executor.createMessage({
      system: "sys",
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    });

    expect(extractText(result.parts)).toBe("Hello world");
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(9);
    expect(result.cacheReadTokens).toBe(4);
    expect(result.toolCalls).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("maps completed isError=true to stopReason=error", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn().mockReturnValue({
      run: () => eventStream([
        { type: "text_delta", content: "partial" },
        { type: "completed", totalUsd: 0, durationMs: 1, isError: true, isPreflightCrash: false },
      ]),
      dispose,
    });
    const executor = new CliSubscriptionExecutor(factory, "claude");

    const result = await executor.createMessage({
      system: "sys",
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    });

    expect(extractText(result.parts)).toBe("partial");
    expect(result.stopReason).toBe("error");
  });

  it("throws on error events and still disposes in finally", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn().mockReturnValue({
      run: () => eventStream([
        { type: "error", code: "E_TEST", message: "boom", isRetryable: false },
      ]),
      dispose,
    });
    const executor = new CliSubscriptionExecutor(factory, "claude");

    await expect(executor.createMessage({
      system: "sys",
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    })).rejects.toThrow("[E_TEST] boom");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

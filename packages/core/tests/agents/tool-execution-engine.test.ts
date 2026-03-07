import { describe, it, expect, vi, afterEach } from "vitest";
import { executeWithRetry } from "../../src/agents/tool-execution-engine.js";
import type { ToolExecutor } from "../../src/agents/tool-execution-engine.js";
import { KilnError } from "../../src/engine/errors.js";

describe("executeWithRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds on first attempt without retry config", async () => {
    const executor: ToolExecutor = vi.fn().mockResolvedValue("success");

    const result = await executeWithRetry("test_tool", { a: 1 }, executor);

    expect(result.result).toBe("success");
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error with exponential strategy", async () => {
    const executor = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 503 Service Unavailable"))
      .mockResolvedValueOnce("recovered");

    const result = await executeWithRetry("test_tool", {}, executor, {
      onTransientError: "exponential",
      maxAttempts: 3,
    });

    expect(result.result).toBe("recovered");
    expect(result.attempts).toBe(2);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("throws TOOL_RETRY_EXHAUSTED after max attempts", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("HTTP 503 Service Unavailable"));

    try {
      await executeWithRetry("test_tool", {}, executor, {
        onTransientError: "exponential",
        maxAttempts: 2,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("TOOL_RETRY_EXHAUSTED");
    }
  });

  it("re-throws on mutate_params validation strategy", async () => {
    const validationError = new Error("Validation failed: missing field");
    const executor = vi.fn().mockRejectedValue(validationError);

    await expect(
      executeWithRetry("test_tool", {}, executor, {
        onValidationError: "mutate_params",
        maxAttempts: 3,
      }),
    ).rejects.toThrow("Validation failed: missing field");

    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("uses fallback on final failure", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("HTTP 503 Service Unavailable"));
    const fallback: ToolExecutor = vi.fn().mockResolvedValue("fallback result");

    const result = await executeWithRetry(
      "test_tool",
      {},
      executor,
      { onTransientError: "exponential", maxAttempts: 2, fallback: "backup_tool" },
      fallback,
    );

    expect(result.result).toBe("fallback result");
    expect(result.fallbackUsed).toBe(true);
    expect(fallback).toHaveBeenCalledWith("backup_tool", {});
  });

  it("times out long-running tool execution", async () => {
    const executor: ToolExecutor = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("late"), 60_000)),
    );

    try {
      await executeWithRetry("slow_tool", {}, executor, {
        timeout: 0.05, // 50ms
        maxAttempts: 1,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("TOOL_EXECUTION_TIMEOUT");
    }
  });

  it("fatal errors skip retry", async () => {
    const executor = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500 Internal Server Error"));

    try {
      await executeWithRetry("test_tool", {}, executor, {
        onTransientError: "exponential",
        maxAttempts: 3,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("TOOL_RETRY_EXHAUSTED");
    }
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("tracks duration across retries", async () => {
    const executor = vi.fn().mockResolvedValue("ok");

    const result = await executeWithRetry("test_tool", {}, executor);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(1000);
  });

  it("passes tool name and input to executor", async () => {
    const executor = vi.fn().mockResolvedValue("ok");

    await executeWithRetry("my_tool", { key: "value" }, executor);

    expect(executor).toHaveBeenCalledWith("my_tool", { key: "value" });
  });
});

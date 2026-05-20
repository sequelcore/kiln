import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../retry.js";

describe("withRetry", () => {
  it("aborts retry backoff when the caller signal is cancelled", async () => {
    const controller = new AbortController();
    const run = withRetry(
      vi.fn(async () => {
        throw new Error("transient");
      }),
      {
        maxRetries: 3,
        baseDelayMs: 1000,
        isRetryable: () => true,
      },
      controller.signal,
    );

    controller.abort();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});

/**
 * @fileoverview Tests for wait-for-gateway module.
 * @module @kilnai/gui
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForGateway, GatewayTimeoutError } from "../src/lib/wait-for-gateway";

describe("waitForGateway", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error - jsdom doesn't have fetch global
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("Resolves when health returns 200", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
    });

    await waitForGateway("http://localhost:3800", {
      intervalMs: 50,
      timeoutMs: 500,
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3800/health", {
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Throws GatewayTimeoutError after timeoutMs", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    });

    const waitPromise = waitForGateway("http://localhost:3800", {
      intervalMs: 50,
      timeoutMs: 150,
    });
    const rejection = expect(waitPromise).rejects.toThrow(GatewayTimeoutError);

    await vi.advanceTimersByTimeAsync(200);

    await rejection;
  });

  it("Respects intervalMs", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      ok: false,
    });

    const waitPromise = waitForGateway("http://localhost:3800", {
      intervalMs: 100,
      timeoutMs: 350,
    });
    const rejection = expect(waitPromise).rejects.toThrow(GatewayTimeoutError);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

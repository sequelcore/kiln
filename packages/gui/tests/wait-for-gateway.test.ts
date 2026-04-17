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
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    });

    await expect(
      waitForGateway("http://localhost:3800", {
        intervalMs: 50,
        timeoutMs: 150,
      })
    ).rejects.toThrow(GatewayTimeoutError);
  });

  it("Respects intervalMs", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
    });

    const start = Date.now();

    await expect(
      waitForGateway("http://localhost:3800", {
        intervalMs: 100,
        timeoutMs: 350,
      })
    ).rejects.toThrow(GatewayTimeoutError);

    const elapsed = Date.now() - start;

    // Should make 4 calls: 1 immediate + 3 retries
    // (350ms timeout / 100ms interval = ~3.5, so 4 calls fit)
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(elapsed).toBeGreaterThanOrEqual(280);
    expect(elapsed).toBeLessThan(450);
  });
});
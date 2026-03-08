import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";
import type { ConversationEvent, EventsConfig } from "@kilnai/core";

const originalFetch = globalThis.fetch;

function makeEvent(overrides: Partial<ConversationEvent> = {}): ConversationEvent {
  return {
    eventType: "MESSAGE_RECEIVED",
    tenantId: "tenant-1",
    channel: "api",
    externalUserId: "user-1",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<EventsConfig> = {}): EventsConfig {
  return {
    webhook: "https://example.com/events",
    ...overrides,
  };
}

describe("ConversationEventEmitter retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("does not retry on successful first attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    globalThis.fetch = fetchMock;

    const emitter = new ConversationEventEmitter(makeConfig());
    emitter.emit(makeEvent());

    // Let the first fetch resolve
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx responses up to maxAttempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, statusText: "Bad Gateway" });
    globalThis.fetch = fetchMock;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const emitter = new ConversationEventEmitter(makeConfig({ retryAttempts: 3, retryBackoffMs: 1000 }));
    emitter.emit(makeEvent());

    // Attempt 1
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Backoff 1s, attempt 2
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Backoff 2s, attempt 3
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // No more retries
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("POST failed after 3 attempts"));
    warnSpy.mockRestore();
  });

  it("does not retry on 4xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: "Bad Request" });
    globalThis.fetch = fetchMock;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const emitter = new ConversationEventEmitter(makeConfig());
    emitter.emit(makeEvent());

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Ensure no retries happen
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not retrying"));
    warnSpy.mockRestore();
  });

  it("retries on network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    globalThis.fetch = fetchMock;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const emitter = new ConversationEventEmitter(makeConfig({ retryAttempts: 3, retryBackoffMs: 1000 }));
    emitter.emit(makeEvent());

    // Attempt 1 (fails)
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Backoff 1s, attempt 2
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Backoff 2s, attempt 3
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Final error logged
    await vi.advanceTimersByTimeAsync(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("POST error after 3 attempts"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("uses exponential backoff (1s, 2s)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });
    globalThis.fetch = fetchMock;

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const emitter = new ConversationEventEmitter(makeConfig({ retryAttempts: 3, retryBackoffMs: 1000 }));
    emitter.emit(makeEvent());

    // Attempt 1
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // After 999ms -- not enough for first backoff
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // At 1000ms -- first retry fires
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // After 1999ms more -- not enough for second backoff (2000ms)
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // At 2000ms -- second retry fires
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.spyOn(console, "warn").mockRestore();
  });

  it("maxAttempts=1 means no retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });
    globalThis.fetch = fetchMock;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const emitter = new ConversationEventEmitter(makeConfig({ retryAttempts: 1, retryBackoffMs: 1000 }));
    emitter.emit(makeEvent());

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // No retries should happen
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("POST failed after 1 attempts"));
    warnSpy.mockRestore();
  });

  it("succeeds on retry after initial 5xx", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });
    globalThis.fetch = fetchMock;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const emitter = new ConversationEventEmitter(makeConfig({ retryAttempts: 3, retryBackoffMs: 1000 }));
    emitter.emit(makeEvent());

    // Attempt 1 (503)
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Backoff 1s, attempt 2 (200 OK)
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // No more retries
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // No final error logged (success on retry)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("POST failed after"));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("POST error after"));
    warnSpy.mockRestore();
  });

  it("defaults to 3 retryAttempts and 1000ms retryBackoffMs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "ISE" });
    globalThis.fetch = fetchMock;

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const emitter = new ConversationEventEmitter(makeConfig());
    emitter.emit(makeEvent());

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // No 4th attempt
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.spyOn(console, "warn").mockRestore();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { KilnProvider } from "../src/provider.js";
import { useApproval } from "../src/use-approval.js";

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <KilnProvider config={{ baseUrl: "http://localhost:4000" }}>{children}</KilnProvider>;
  };
}

function mockFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }),
  );
}

function mockFetchError(status: number, statusText: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
    }),
  );
}

describe("useApproval", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("approve() calls POST /dev/approve with empty body", async () => {
    mockFetchOk();
    const { result } = renderHook(() => useApproval(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.approve();
    });

    expect(fetch).toHaveBeenCalledWith("http://localhost:4000/dev/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  it("approve(sessionId) calls POST /dev/approve with { sessionId }", async () => {
    mockFetchOk();
    const { result } = renderHook(() => useApproval(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.approve("sess-123");
    });

    expect(fetch).toHaveBeenCalledWith("http://localhost:4000/dev/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "sess-123" }),
    });
  });

  it("reject(reason) calls POST /dev/reject with { reason }", async () => {
    mockFetchOk();
    const { result } = renderHook(() => useApproval(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.reject("not allowed");
    });

    expect(fetch).toHaveBeenCalledWith("http://localhost:4000/dev/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "not allowed" }),
    });
  });

  it("reject(reason, sessionId) calls POST /dev/reject with { reason, sessionId }", async () => {
    mockFetchOk();
    const { result } = renderHook(() => useApproval(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.reject("not allowed", "sess-456");
    });

    expect(fetch).toHaveBeenCalledWith("http://localhost:4000/dev/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "not allowed", sessionId: "sess-456" }),
    });
  });

  it("API error sets error state", async () => {
    mockFetchError(404, "Not Found");
    const { result } = renderHook(() => useApproval(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain("POST /dev/approve failed: 404 Not Found");
  });

  it("isLoading is true during call and false after", async () => {
    const loadingStates: boolean[] = [];
    let fetchResolve!: () => void;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<{ ok: boolean; json: () => Promise<{ ok: true }> }>((res) => {
          fetchResolve = () => res({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }),
      ),
    );

    const { result } = renderHook(
      () => {
        const hook = useApproval();
        loadingStates.push(hook.isLoading);
        return hook;
      },
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(false);

    let approvePromise!: Promise<void>;
    act(() => {
      approvePromise = result.current.approve();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      fetchResolve();
      await approvePromise;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("error clears on next call", async () => {
    mockFetchError(409, "Conflict");
    const { result } = renderHook(() => useApproval(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.error).not.toBeNull();

    mockFetchOk();

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.error).toBeNull();
  });
});

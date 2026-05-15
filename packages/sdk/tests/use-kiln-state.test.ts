import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { KilnProvider } from "../src/provider.js";
import { useKilnState } from "../src/use-kiln-state.js";
import type { KilnConfig } from "../src/types.js";

function createWrapper(config: KilnConfig) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(KilnProvider, { config }, children);
  };
}

describe("useKilnState", () => {
  const config: KilnConfig = {
    baseUrl: "http://localhost:4000",
    appName: "test-app",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with empty state, cost, apps, no error, not loading", () => {
    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    expect(result.current.state).toEqual({});
    expect(result.current.cost).toEqual({});
    expect(result.current.apps).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("refresh() fetches state, cost, and apps from /dev/* endpoints", async () => {
    const stateData = { sessions: 3, uptime: 120 };
    const costData = { totalTokens: 5000, totalCost: 0.05 };
    const appsData = { apps: ["app-1", "app-2"] };

    let callIndex = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/dev/state")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(stateData) });
        }
        if (url.endsWith("/dev/cost")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(costData) });
        }
        if (url.endsWith("/dev/apps")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(appsData) });
        }
        return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
      }),
    );

    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.state).toEqual(stateData);
    expect(result.current.cost).toEqual(costData);
    expect(result.current.apps).toEqual(appsData.apps);
  });

  it("refresh() calls correct URLs from baseUrl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );

    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.refresh();
    });

    const urls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(urls).toContain("http://localhost:4000/dev/state");
    expect(urls).toContain("http://localhost:4000/dev/cost");
    expect(urls).toContain("http://localhost:4000/dev/apps");
  });

  it("error is captured and exposed when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toContain("500");
  });

  it("error is captured when fetch rejects entirely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failure")),
    );

    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("network failure");
  });

  it("isLoading is true during fetch and false after", async () => {
    let resolveFetch!: (value: unknown) => void;
    const response = { ok: true, json: () => Promise.resolve({}) };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; })),
    );

    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveFetch(response);
      await refreshPromise!;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("isLoading resets to false on error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("down")),
    );

    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("refresh() clears previous error on new call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("first failure")),
    );

    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).not.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
  });

  it("wraps non-Error thrown values in an Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue("string error"),
    );

    const { result } = renderHook(() => useKilnState(), {
      wrapper: createWrapper(config),
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("string error");
  });
});

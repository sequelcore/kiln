import { describe, expect, it, vi } from "vitest";
import { createProviderDiscoveryCache } from "../../src/gateway/provider-discovery-cache.js";

describe("createProviderDiscoveryCache", () => {
  it("serves cached discovery within the ttl", async () => {
    vi.useFakeTimers();
    try {
      const resolveDiscovery = vi
        .fn<() => Promise<string[]>>()
        .mockResolvedValueOnce(["first"])
        .mockResolvedValueOnce(["second"]);
      const cache = createProviderDiscoveryCache(resolveDiscovery, 1_000);

      await expect(cache.get({ force: true })).resolves.toEqual(["first"]);
      await expect(cache.get()).resolves.toEqual(["first"]);

      expect(resolveDiscovery).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1_001);

      await expect(cache.get()).resolves.toEqual(["second"]);
      expect(resolveDiscovery).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates concurrent non-forced refreshes", async () => {
    let resolve!: (value: string[]) => void;
    const pending = new Promise<string[]>((next) => {
      resolve = next;
    });
    const resolveDiscovery = vi.fn<() => Promise<string[]>>().mockReturnValue(pending);
    const cache = createProviderDiscoveryCache(resolveDiscovery, 1_000);

    const first = cache.get();
    const second = cache.get();
    resolve(["models"]);

    await expect(first).resolves.toEqual(["models"]);
    await expect(second).resolves.toEqual(["models"]);
    expect(resolveDiscovery).toHaveBeenCalledTimes(1);
  });

  it("serializes a forced refresh behind discovery already in flight", async () => {
    let resolveOld!: (value: string[]) => void;
    let resolveFresh!: (value: string[]) => void;
    const oldDiscovery = new Promise<string[]>((next) => {
      resolveOld = next;
    });
    const freshDiscovery = new Promise<string[]>((next) => {
      resolveFresh = next;
    });
    const resolveDiscovery = vi
      .fn<() => Promise<string[]>>()
      .mockReturnValueOnce(oldDiscovery)
      .mockReturnValueOnce(freshDiscovery);
    const cache = createProviderDiscoveryCache(resolveDiscovery, 1_000);

    const old = cache.get();
    const fresh = cache.get({ force: true });
    expect(resolveDiscovery).toHaveBeenCalledTimes(1);

    resolveOld(["old"]);
    await expect(old).resolves.toEqual(["old"]);
    await vi.waitFor(() => {
      expect(resolveDiscovery).toHaveBeenCalledTimes(2);
    });

    resolveFresh(["fresh"]);
    await expect(fresh).resolves.toEqual(["fresh"]);
    expect(cache.peek()).toEqual(["fresh"]);
  });

  it("exposes seeded discovery to snapshots without serving it as fresh cache", async () => {
    const onResolved = vi.fn();
    const resolveDiscovery = vi.fn<() => Promise<string[]>>().mockResolvedValue(["fresh"]);
    const cache = createProviderDiscoveryCache(resolveDiscovery, {
      ttlMs: 1_000,
      initialValue: ["cached"],
      onResolved,
    });

    expect(cache.peek()).toEqual(["cached"]);
    await expect(cache.get()).resolves.toEqual(["fresh"]);
    expect(resolveDiscovery).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith(["fresh"]);
  });
});

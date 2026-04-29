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

  it("lets forced refresh replace older in-flight discovery", async () => {
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
    resolveFresh(["fresh"]);
    resolveOld(["old"]);

    await expect(fresh).resolves.toEqual(["fresh"]);
    await expect(old).resolves.toEqual(["old"]);
    expect(cache.peek()).toEqual(["fresh"]);
  });
});

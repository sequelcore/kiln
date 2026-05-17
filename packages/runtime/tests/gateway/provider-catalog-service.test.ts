import { describe, expect, it, vi } from "vitest";
import { createProviderCatalogService } from "../../src/gateway/provider-catalog-service.js";

describe("createProviderCatalogService", () => {
  it("exposes an immediate pending snapshot and refreshes in the background", async () => {
    let resolveDiscovery!: (value: string[]) => void;
    const pending = new Promise<string[]>((resolve) => {
      resolveDiscovery = resolve;
    });
    const service = createProviderCatalogService(() => pending, []);
    const listener = vi.fn();
    service.subscribe(listener);

    expect(service.snapshot()).toEqual({ status: "pending", discovery: [] });

    service.startBackgroundRefresh({ force: true });
    expect(service.snapshot()).toEqual({ status: "pending", discovery: [] });

    resolveDiscovery(["gpt-5.4"]);
    await expect(service.ensureReady()).resolves.toEqual({
      status: "ready",
      discovery: ["gpt-5.4"],
    });
    expect(listener).toHaveBeenCalledWith({ status: "ready", discovery: ["gpt-5.4"] });
  });

  it("keeps a ready snapshot usable while a forced refresh is in flight", async () => {
    let resolveSecond!: (value: string[]) => void;
    const resolveDiscovery = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["first"])
      .mockReturnValueOnce(new Promise<string[]>((resolve) => {
        resolveSecond = resolve;
      }));
    const service = createProviderCatalogService(resolveDiscovery, []);

    await expect(service.refresh({ force: true })).resolves.toEqual({
      status: "ready",
      discovery: ["first"],
    });

    const second = service.refresh({ force: true });
    expect(service.snapshot()).toEqual({ status: "refreshing", discovery: ["first"] });
    await expect(service.ensureReady()).resolves.toEqual({ status: "refreshing", discovery: ["first"] });

    resolveSecond(["second"]);
    await expect(second).resolves.toEqual({ status: "ready", discovery: ["second"] });
  });

  it("serves initial discovery immediately and publishes fresh discovery after refresh", async () => {
    const onDiscoveryResolved = vi.fn();
    const service = createProviderCatalogService(
      vi.fn<() => Promise<string[]>>().mockResolvedValue(["fresh"]),
      [],
      {
        initialDiscovery: ["cached"],
        onDiscoveryResolved,
      },
    );

    expect(service.snapshot()).toEqual({ status: "ready", discovery: ["cached"] });

    const refresh = service.refresh({ force: true });
    expect(service.snapshot()).toEqual({ status: "refreshing", discovery: ["cached"] });
    await expect(refresh).resolves.toEqual({ status: "ready", discovery: ["fresh"] });
    expect(onDiscoveryResolved).toHaveBeenCalledWith(["fresh"]);
  });
});

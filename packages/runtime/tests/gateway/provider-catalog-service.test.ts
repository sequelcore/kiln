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

    expect(service.snapshot()).toMatchObject({
      status: "pending",
      discovery: [],
      freshness: "unknown",
      classification: "unavailable",
      catalogEvidenceCurrent: false,
    });

    service.startBackgroundRefresh({ force: true });
    expect(service.snapshot()).toMatchObject({
      status: "pending",
      discovery: [],
      freshness: "unknown",
      classification: "unavailable",
      catalogEvidenceCurrent: false,
    });

    resolveDiscovery(["gpt-5.4"]);
    await expect(service.ensureReady()).resolves.toMatchObject({
      status: "ready",
      discovery: ["gpt-5.4"],
      freshness: "fresh",
      classification: "available",
      catalogEvidenceCurrent: true,
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: "ready", discovery: ["gpt-5.4"] }));
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

    await expect(service.refresh({ force: true })).resolves.toMatchObject({
      status: "ready",
      discovery: ["first"],
      freshness: "fresh",
      classification: "available",
      catalogEvidenceCurrent: true,
    });

    const second = service.refresh({ force: true });
    expect(service.snapshot()).toMatchObject({
      status: "refreshing",
      discovery: ["first"],
      freshness: "fresh",
      classification: "available",
      catalogEvidenceCurrent: true,
    });
    await expect(service.ensureReady()).resolves.toMatchObject({
      status: "refreshing",
      discovery: ["first"],
      catalogEvidenceCurrent: true,
    });

    resolveSecond(["second"]);
    await expect(second).resolves.toMatchObject({ status: "ready", discovery: ["second"] });
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

    expect(service.snapshot()).toMatchObject({
      status: "ready",
      discovery: ["cached"],
      freshness: "stale",
      classification: "stale",
      catalogEvidenceCurrent: false,
    });

    const refresh = service.refresh({ force: true });
    expect(service.snapshot()).toMatchObject({ status: "refreshing", discovery: ["cached"] });
    await expect(refresh).resolves.toMatchObject({ status: "ready", discovery: ["fresh"] });
    expect(onDiscoveryResolved).toHaveBeenCalledWith(["fresh"]);
  });

  it("classifies seeded discovery as stale diagnostic evidence until a refresh resolves", async () => {
    const service = createProviderCatalogService(
      vi.fn<() => Promise<string[]>>().mockResolvedValue(["fresh"]),
      [],
      {
        initialDiscovery: ["cached"],
        initialFreshness: "stale",
      },
    );

    expect(service.snapshot()).toMatchObject({
      status: "ready",
      discovery: ["cached"],
      freshness: "stale",
      classification: "stale",
      catalogEvidenceCurrent: false,
      evidence: [{
        classification: "stale",
        summary: "Seeded provider catalog requires refresh before admission.",
      }],
    });

    await expect(service.refresh({ force: true })).resolves.toMatchObject({
      status: "ready",
      discovery: ["fresh"],
      freshness: "fresh",
      classification: "available",
      catalogEvidenceCurrent: true,
    });
  });

  it("retains stale discovery as inspectable failed evidence when refresh fails", async () => {
    const service = createProviderCatalogService(
      vi.fn<() => Promise<string[]>>().mockRejectedValue(new Error("network unavailable")),
      [],
      {
        initialDiscovery: ["cached"],
        initialFreshness: "stale",
      },
    );

    await expect(service.refresh({ force: true })).rejects.toThrow("network unavailable");

    expect(service.snapshot()).toMatchObject({
      status: "error",
      discovery: ["cached"],
      freshness: "stale",
      classification: "failed",
      catalogEvidenceCurrent: false,
      error: "network unavailable",
      evidence: [{
        classification: "failed",
        summary: "Provider catalog refresh failed: network unavailable",
      }],
    });
  });
});

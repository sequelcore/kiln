import { describe, expect, it } from "vitest";
import { normalizeProviderCatalogObservation } from "../../src/gateway/provider-model-adapters/catalog-normalization.js";
import { normalizeRuntimeProviderDiscoveryCatalog } from "../../src/gateway/provider-model-adapters/runtime-discovery-catalogs.js";

const observedAt = "2026-07-01T10:00:00.000Z";

describe("normalizeProviderCatalogObservation", () => {
  it("preserves raw identifiers, aliases, duplicates, metadata, and route provenance", () => {
    const normalized = normalizeProviderCatalogObservation({
      providerId: "provider-a",
      source: { kind: "runtime-adapter", id: "provider-a-catalog", version: "1" },
      observedAt,
      freshness: "fresh",
      status: "available",
      entries: [
        {
          rawId: "family-x/latest",
          providerModelId: "family-x-route-a",
          scope: "interactive",
          normalizedFamily: "family-x",
          aliases: ["family-x", "family-x/latest"],
          metadata: { tier: "standard" },
        },
        {
          rawId: "family-x/latest",
          providerModelId: "family-x-route-b",
          scope: "managed-agent",
          normalizedFamily: "family-x",
          aliases: ["family-x-managed"],
          metadata: { tier: "agent" },
        },
        {
          rawId: "family-x-stable",
          providerModelId: "family-x-route-a",
          scope: "interactive",
          normalizedFamily: "family-x",
          aliases: ["family-x"],
          metadata: { aliasOf: "family-x/latest" },
        },
      ],
    });

    expect(normalized.rawEntries).toHaveLength(3);
    expect(normalized.rawEntries[0]).toMatchObject({
      rawId: "family-x/latest",
      metadata: { tier: "standard" },
    });
    expect(normalized.routes).toHaveLength(2);
    expect(normalized.routes.map((route) => route.identity.route)).toEqual([
      { providerId: "provider-a", providerModelId: "family-x-route-a", scope: "interactive" },
      { providerId: "provider-a", providerModelId: "family-x-route-b", scope: "managed-agent" },
    ]);
    expect(normalized.routes[0].identity.normalizedModel).toEqual({ family: "family-x" });
    expect(normalized.routes[0].aliases).toEqual([
      expect.objectContaining({ alias: "family-x", rawId: "family-x/latest", provenance: "provider-a-catalog" }),
      expect.objectContaining({ alias: "family-x/latest", rawId: "family-x/latest", provenance: "provider-a-catalog" }),
      expect.objectContaining({ alias: "family-x", rawId: "family-x-stable", provenance: "provider-a-catalog" }),
    ]);
    expect(normalized.routes[0].states).toMatchObject({
      discovered: "confirmed",
      configured: "unknown",
      authenticated: "unknown",
      entitled: "unknown",
      selectable: "unknown",
    });
  });

  it("keeps large OpenCode catalogs inspectable without making entries eligible", () => {
    const normalized = normalizeProviderCatalogObservation({
      providerId: "opencode",
      harness: {
        harnessId: "opencode-cli",
        reportedProviderId: "opencode",
      },
      source: { kind: "runtime-adapter", id: "opencode-cli-models", version: "1" },
      observedAt,
      freshness: "fresh",
      status: "available",
      entries: Array.from({ length: 397 }, (_, index) => ({
        rawId: `provider-${index}/model-${index}`,
        providerModelId: `provider-${index}/model-${index}`,
        scope: "cli",
        normalizedFamily: `model-${index}`,
        aliases: [`model-${index}`],
        metadata: { index },
      })),
    });

    expect(normalized.rawEntries).toHaveLength(397);
    expect(normalized.routes).toHaveLength(397);
    expect(normalized.routes.every((route) => route.states.discovered === "confirmed")).toBe(true);
    expect(normalized.routes.every((route) => route.states.configured === "unknown")).toBe(true);
    expect(normalized.routes.every((route) => route.states.entitled === "unknown")).toBe(true);
    expect(normalized.routes.every((route) => route.states.selectable === "unknown")).toBe(true);
  });

  it("classifies partial, failed, stale, and unavailable catalogs without deleting raw evidence", () => {
    const partial = normalizeProviderCatalogObservation({
      providerId: "provider-a",
      source: { kind: "runtime-adapter", id: "provider-a-catalog" },
      observedAt,
      freshness: "fresh",
      status: "partial",
      entries: [{
        rawId: "model-a",
        providerModelId: "model-a",
        scope: "interactive",
        normalizedFamily: "model-a",
        aliases: [],
        metadata: {},
      }],
      failures: [{ classification: "endpoint_timeout", summary: "One page timed out.", retryable: true }],
    });
    const failed = normalizeProviderCatalogObservation({
      providerId: "provider-a",
      source: { kind: "runtime-adapter", id: "provider-a-catalog" },
      observedAt,
      freshness: "fresh",
      status: "failed",
      entries: [],
      failures: [{ classification: "endpoint_error", summary: "Catalog endpoint failed.", retryable: true }],
    });
    const stale = normalizeProviderCatalogObservation({
      providerId: "provider-a",
      source: { kind: "runtime-adapter", id: "provider-a-catalog" },
      observedAt,
      freshness: "stale",
      status: "available",
      entries: [{
        rawId: "model-a",
        providerModelId: "model-a",
        scope: "interactive",
        normalizedFamily: "model-a",
        aliases: [],
        metadata: {},
      }],
    });

    expect(partial).toMatchObject({ classification: "partial", catalogEvidenceCurrent: false });
    expect(partial.rawEntries).toHaveLength(1);
    expect(partial.failures).toEqual([expect.objectContaining({ classification: "endpoint_timeout" })]);
    expect(failed).toMatchObject({ classification: "failed", catalogEvidenceCurrent: false, rawEntries: [] });
    expect(stale).toMatchObject({ classification: "stale", catalogEvidenceCurrent: false });
  });

  it("normalizes runtime adapter families without treating generic authentication as entitlement", () => {
    const normalized = normalizeRuntimeProviderDiscoveryCatalog({
      providerId: "openrouter",
      family: "openrouter",
      observedAt,
      freshness: "fresh",
      discovery: {
        models: ["anthropic/claude-sonnet-4"],
        status: "available",
        reason: "OpenRouter models discovered.",
        authState: "authenticated",
      },
    });

    expect(normalized).toMatchObject({
      providerId: "openrouter",
      classification: "available",
      catalogEvidenceCurrent: true,
    });
    expect(normalized.rawEntries).toEqual([
      expect.objectContaining({
        rawId: "anthropic/claude-sonnet-4",
        providerModelId: "anthropic/claude-sonnet-4",
        normalizedFamily: "claude-sonnet-4",
        metadata: {
          adapterFamily: "openrouter",
          discoveryStatus: "available",
        },
      }),
    ]);
    expect(normalized.routes[0].states).toMatchObject({
      discovered: "confirmed",
      authenticated: "confirmed",
      entitled: "unknown",
      policyAdmitted: "confirmed",
      routeHealthy: "confirmed",
      selectable: "unknown",
    });
  });

  it("treats fresh authenticated account-scoped service catalogs as selectable entitlement evidence", () => {
    const normalized = normalizeRuntimeProviderDiscoveryCatalog({
      providerId: "opencode-go",
      family: "opencode-service",
      observedAt,
      freshness: "fresh",
      discovery: {
        models: ["deepseek-v4-flash"],
        status: "available",
        reason: "OpenCode Go models discovered.",
        authState: "authenticated",
      },
    });

    expect(normalized.routes[0].states).toMatchObject({
      discovered: "confirmed",
      authenticated: "confirmed",
      entitled: "confirmed",
      policyAdmitted: "confirmed",
      routeHealthy: "confirmed",
      selectable: "confirmed",
    });
    expect(normalized.routes[0].observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "entitled", authority: "provider-authoritative" }),
      expect.objectContaining({ state: "policyAdmitted", authority: "runtime-observed" }),
      expect.objectContaining({ state: "routeHealthy", authority: "runtime-observed" }),
    ]));
  });

  it("keeps stale authenticated OpenCode service catalogs diagnostic and fail-closed", () => {
    const normalized = normalizeRuntimeProviderDiscoveryCatalog({
      providerId: "opencode-go",
      family: "opencode-service",
      harnessId: "opencode",
      reportedProviderId: "opencode-go",
      observedAt,
      freshness: "stale",
      discovery: {
        models: Array.from({ length: 397 }, (_, index) => `provider-${index}/model-${index}`),
        status: "available",
        reason: "OpenCode Go models discovered.",
        authState: "authenticated",
      },
    });

    expect(normalized).toMatchObject({
      classification: "stale",
      catalogEvidenceCurrent: false,
    });
    expect(normalized.rawEntries).toHaveLength(397);
    expect(normalized.routes[0].identity).toMatchObject({
      harness: {
        harnessId: "opencode",
        reportedProviderId: "opencode-go",
      },
      route: {
        providerId: "opencode-go",
        providerModelId: "provider-0/model-0",
        scope: "opencode-service",
      },
    });
    expect(normalized.routes.every((route) => route.states.authenticated === "confirmed")).toBe(true);
    expect(normalized.routes.every((route) => route.states.entitled === "confirmed")).toBe(true);
    expect(normalized.routes.every((route) => route.states.selectable === "confirmed")).toBe(true);
    expect(normalized.routes.every((route) =>
      route.observations.every((observation) => observation.freshness === "stale")
    )).toBe(true);
  });

  it("classifies runtime adapter failures as evidence without provider routes", () => {
    const normalized = normalizeRuntimeProviderDiscoveryCatalog({
      providerId: "ollama",
      family: "local-provider",
      observedAt,
      freshness: "fresh",
      discovery: {
        models: [],
        status: "daemon_unreachable",
        reason: "Ollama daemon is not reachable.",
        authState: "not_required",
      },
    });

    expect(normalized).toMatchObject({
      classification: "unavailable",
      catalogEvidenceCurrent: false,
      rawEntries: [],
      routes: [],
      failures: [{
        classification: "daemon_unreachable",
        summary: "Ollama daemon is not reachable.",
        retryable: true,
      }],
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  PROVIDER_MODEL_EVIDENCE_STATES,
  createProviderModelEvidence,
  type ProviderModelEvidenceInput,
} from "../../src/agents/provider-model-evidence.js";

const OBSERVED_AT = "2026-07-01T12:00:00.000Z";
const EXPIRES_AT = "2026-07-01T13:00:00.000Z";

function evidence(overrides: Partial<ProviderModelEvidenceInput> = {}): ProviderModelEvidenceInput {
  return {
    identity: {
      harness: {
        harnessId: "desktop-harness",
        reportedProviderId: "subscription-route",
        reportedModelId: "vendor/model-alias",
      },
      provider: { providerId: "subscription-route" },
      normalizedModel: { family: "model-family", version: "2026-06" },
      route: {
        providerId: "subscription-route",
        providerModelId: "vendor/model-native-id",
        scope: "account:primary",
      },
    },
    aliases: [
      {
        alias: "vendor/model-alias",
        rawId: "vendor/model-native-id",
        provenance: "harness-catalog",
        source: { kind: "harness", id: "desktop-harness", version: "1.2.3" },
      },
    ],
    states: {
      advertised: "confirmed",
      discovered: "confirmed",
      configured: "confirmed",
      authenticated: "confirmed",
      entitled: "unknown",
      capabilityCompatible: "unknown",
      policyAdmitted: "unknown",
      routeHealthy: "unknown",
      probeVerified: "not-required",
      selectable: "denied",
    },
    observations: [
      {
        state: "discovered",
        value: "confirmed",
        provenance: "harness-catalog",
        authority: "harness-reported",
        source: { kind: "harness", id: "desktop-harness", version: "1.2.3" },
        observedAt: OBSERVED_AT,
        expiresAt: EXPIRES_AT,
        freshness: "fresh",
      },
    ],
    failures: [],
    ...overrides,
  };
}

describe("provider-model evidence contract", () => {
  it("keeps harness, provider, normalized-model, and executable-route identities distinct", () => {
    const record = createProviderModelEvidence(evidence());

    expect(record.identity.harness).toEqual({
      harnessId: "desktop-harness",
      reportedProviderId: "subscription-route",
      reportedModelId: "vendor/model-alias",
    });
    expect(record.identity.provider).toEqual({ providerId: "subscription-route" });
    expect(record.identity.normalizedModel).toEqual({ family: "model-family", version: "2026-06" });
    expect(record.identity.route).toEqual({
      providerId: "subscription-route",
      providerModelId: "vendor/model-native-id",
      scope: "account:primary",
    });
    expect(record.identity.normalizedModel).not.toEqual(record.identity.route);
  });

  it("preserves raw identifiers and alias provenance without rewriting a route", () => {
    const record = createProviderModelEvidence(evidence());

    expect(record.aliases).toEqual([
      {
        alias: "vendor/model-alias",
        rawId: "vendor/model-native-id",
        provenance: "harness-catalog",
        source: { kind: "harness", id: "desktop-harness", version: "1.2.3" },
      },
    ]);
    expect(record.identity.route.providerModelId).toBe("vendor/model-native-id");
  });

  it("carries provenance, authority, source identity, observation time, and freshness", () => {
    const record = createProviderModelEvidence(evidence());

    expect(record.observations[0]).toEqual({
      state: "discovered",
      value: "confirmed",
      provenance: "harness-catalog",
      authority: "harness-reported",
      source: { kind: "harness", id: "desktop-harness", version: "1.2.3" },
      observedAt: OBSERVED_AT,
      expiresAt: EXPIRES_AT,
      freshness: "fresh",
    });
  });

  it("represents every admission state independently", () => {
    expect(PROVIDER_MODEL_EVIDENCE_STATES).toEqual([
      "advertised",
      "discovered",
      "configured",
      "authenticated",
      "entitled",
      "capabilityCompatible",
      "policyAdmitted",
      "routeHealthy",
      "probeVerified",
      "selectable",
    ]);

    const record = createProviderModelEvidence(evidence());
    expect(record.states.authenticated).toBe("confirmed");
    expect(record.states.entitled).toBe("unknown");
    expect(record.states.capabilityCompatible).toBe("unknown");
    expect(record.states.selectable).toBe("denied");
  });

  it("does not infer entitlement from authentication", () => {
    const record = createProviderModelEvidence(evidence());

    expect(record.states.authenticated).toBe("confirmed");
    expect(record.states.entitled).toBe("unknown");
    expect(record.states.selectable).toBe("denied");
  });

  it("does not infer availability or capability from discovery", () => {
    const record = createProviderModelEvidence(evidence({
      states: {
        ...evidence().states,
        discovered: "confirmed",
        routeHealthy: "unknown",
        capabilityCompatible: "unknown",
      },
    }));

    expect(record.states.discovered).toBe("confirmed");
    expect(record.states.routeHealthy).toBe("unknown");
    expect(record.states.capabilityCompatible).toBe("unknown");
  });

  it("retains stale observations and classified failures as diagnostic evidence", () => {
    const record = createProviderModelEvidence(evidence({
      observations: [{
        state: "discovered",
        value: "confirmed",
        provenance: "cached-catalog",
        authority: "harness-reported",
        source: { kind: "cache", id: "catalog-cache", version: "4" },
        observedAt: "2026-06-30T10:00:00.000Z",
        expiresAt: "2026-06-30T11:00:00.000Z",
        freshness: "stale",
      }],
      failures: [{
        classification: "catalog-unavailable",
        source: { kind: "adapter", id: "subscription-adapter", version: "2" },
        observedAt: OBSERVED_AT,
        retryable: true,
        summary: "Catalog transport was unavailable.",
      }],
    }));

    expect(record.observations[0]?.freshness).toBe("stale");
    expect(record.failures).toEqual([
      expect.objectContaining({ classification: "catalog-unavailable", retryable: true }),
    ]);
    expect(record.states.selectable).toBe("denied");
  });

  it("keeps the shared vocabulary provider-neutral", () => {
    const sharedVocabulary = JSON.stringify(PROVIDER_MODEL_EVIDENCE_STATES);

    expect(sharedVocabulary).not.toMatch(/opencode|codex|openrouter|anthropic|openai/i);
  });

  it("permits direct-provider evidence without fabricating a harness identity", () => {
    const input = evidence({
      identity: {
        provider: { providerId: "direct-provider" },
        normalizedModel: { family: "model-family", version: "2026-06" },
        route: {
          providerId: "direct-provider",
          providerModelId: "model-native-id",
          scope: "account:primary",
        },
      } as ProviderModelEvidenceInput["identity"],
    });

    const record = createProviderModelEvidence(input);

    expect(record.identity.harness).toBeUndefined();
    expect(record.identity.provider.providerId).toBe("direct-provider");
  });

  it("rejects evidence whose provider and execution-route provider identities disagree", () => {
    const input = evidence({
      identity: {
        ...evidence().identity,
        provider: { providerId: "provider-a" },
        route: { ...evidence().identity.route, providerId: "provider-b" },
      },
    });

    expect(() => createProviderModelEvidence(input)).toThrow(
      "identity.provider.providerId must match identity.route.providerId",
    );
  });

  it.each([
    ["empty harness identity", () => evidence({ identity: { ...evidence().identity, harness: { ...evidence().identity.harness, harnessId: " " } } })],
    ["empty normalized family", () => evidence({ identity: { ...evidence().identity, normalizedModel: { family: "" } } })],
    ["empty route scope", () => evidence({ identity: { ...evidence().identity, route: { ...evidence().identity.route, scope: "" } } })],
    ["empty alias provenance", () => evidence({ aliases: [{ ...evidence().aliases[0]!, provenance: "" }] })],
    ["empty source version", () => evidence({ aliases: [{ ...evidence().aliases[0]!, source: { kind: "harness", id: "desktop-harness", version: "" } }] })],
  ] as const)("rejects %s at the evidence boundary", (_label, invalidInput) => {
    expect(() => createProviderModelEvidence(invalidInput())).toThrow(TypeError);
  });

  it("rejects missing or unsupported state values instead of silently defaulting them", () => {
    const missing = { ...evidence().states } as Record<string, string>;
    delete missing.entitled;
    const unsupported = { ...evidence().states, entitled: "assumed" };

    expect(() => createProviderModelEvidence(evidence({
      states: missing as ProviderModelEvidenceInput["states"],
    }))).toThrow("states.entitled is required");
    expect(() => createProviderModelEvidence(evidence({
      states: unsupported as unknown as ProviderModelEvidenceInput["states"],
    }))).toThrow("states.entitled has an unsupported value");
  });

  it("rejects malformed observation and failure timestamps", () => {
    expect(() => createProviderModelEvidence(evidence({
      observations: [{ ...evidence().observations[0]!, observedAt: "not-a-timestamp" }],
    }))).toThrow("observations[0].observedAt must be an ISO-compatible timestamp");
    expect(() => createProviderModelEvidence(evidence({
      failures: [{
        classification: "catalog-unavailable",
        source: { kind: "adapter", id: "fixture" },
        observedAt: "invalid",
        retryable: true,
        summary: "Unavailable.",
      }],
    }))).toThrow("failures[0].observedAt must be an ISO-compatible timestamp");
  });

  it("rejects evidence whose expiry precedes its observation", () => {
    expect(() => createProviderModelEvidence(evidence({
      observations: [{
        ...evidence().observations[0]!,
        observedAt: "2026-07-01T12:00:00.000Z",
        expiresAt: "2026-07-01T11:59:59.000Z",
      }],
    }))).toThrow("observations[0].expiresAt must not precede observedAt");
  });
});

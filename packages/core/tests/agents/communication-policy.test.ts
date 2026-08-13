import { describe, expect, it } from "vitest";
import {
  resolveCommunicationIntent,
  resolveCommunicationProfile,
  knownModelCommunicationCapabilities,
  renderCommunicationPromptProjection,
  validateResolvedCommunicationIntent,
  type CommunicationIntentCandidate,
  type ModelCommunicationCapabilities,
} from "../../src/index.js";

const CAPABILITIES: ModelCommunicationCapabilities = {
  provider: "test-provider",
  model: "test-model",
  responseDetail: {
    mechanism: "native",
    supported: ["concise", "standard", "detailed"],
    nativeValues: {
      concise: "low",
      standard: "medium",
      detailed: "high",
    },
  },
  interactionProfiles: [{
    profileId: "reviewer",
    profileRevision: "v2",
    supportedBehaviors: ["findings-first", "state-visible"],
    mechanism: "native",
    nativeValue: "pragmatic",
    fidelity: "translated",
    semanticLoss: ["Native profile does not guarantee findings-first ordering."],
  }],
  evidence: {
    sourceIdentity: "test-catalog",
    sourceRevision: "revision-9",
    observedAt: "2026-08-13T00:00:00.000Z",
  },
};

describe("knownModelCommunicationCapabilities", () => {
  it("exposes maintained native detail evidence only for admitted known routes", () => {
    expect(knownModelCommunicationCapabilities("codex-oauth", "gpt-5.6-sol")).toMatchObject({
      responseDetail: { nativeValues: { concise: "low", standard: "medium", detailed: "high" } },
      evidence: { sourceRevision: "2026-08-13" },
    });
    expect(knownModelCommunicationCapabilities("anthropic", "claude-opus-4-1")).toBeUndefined();
  });
});

describe("resolveCommunicationIntent", () => {
  it("verifies a transported resolution without changing authority or identity", () => {
    const resolved = resolveCommunicationIntent([{
      source: "agent-profile",
      intent: { responseDetail: "detailed", requiredContent: ["finding"] },
    }]);
    expect(validateResolvedCommunicationIntent(JSON.parse(JSON.stringify(resolved)))).toEqual(resolved);
    expect(() => validateResolvedCommunicationIntent({ ...resolved, identity: `sha256:${"0".repeat(64)}` }))
      .toThrow("identity");
  });
  it("rejects malformed boundary values instead of silently defaulting", () => {
    expect(() => resolveCommunicationIntent([{
      source: "user",
      intent: { responseDetail: "tiny" } as never,
    }])).toThrow("response detail");
    expect(() => resolveCommunicationIntent([{
      source: "project",
      intent: { unknown: true } as never,
    }])).toThrow("Unknown communication intent field");
    expect(() => resolveCommunicationIntent([{
      source: "project",
      intent: {
        interactionProfile: {
          id: "review",
          revision: "v1",
          behaviors: ["inject arbitrary prompt text"],
        },
      } as never,
    }])).toThrow("interaction profile behavior is invalid");
    expect(() => resolveCommunicationIntent([{
      source: "project",
      intent: {
        artifactContract: { id: "report", revision: "v1", rawPrompt: "private" },
      } as never,
    }])).toThrow("Unknown communication artifact contract field");
  });
  it("resolves each preference by canonical precedence and preserves all obligations", () => {
    const candidates: readonly CommunicationIntentCandidate[] = [
      {
        source: "global",
        intent: {
          responseDetail: "concise",
          locale: "en-US",
          requiredContent: ["next-action"],
        },
      },
      {
        source: "artifact-contract",
        intent: {
          responseDetail: "detailed",
          requiredContent: ["verification", "residual-risk"],
          artifactContract: { id: "pull-request", revision: "v1" },
        },
      },
      {
        source: "user",
        intent: {
          locale: "es-MX",
          requiredContent: ["decision"],
        },
      },
      {
        source: "safety-authority",
        intent: { requiredContent: ["warning", "approval-requirement"] },
      },
    ];

    const resolved = resolveCommunicationIntent(candidates);

    expect(resolved.intent.responseDetail).toBe("detailed");
    expect(resolved.intent.locale).toBe("es-MX");
    expect(resolved.intent.artifactContract).toEqual({ id: "pull-request", revision: "v1" });
    expect(resolved.intent.requiredContent).toEqual([
      "approval-requirement",
      "decision",
      "next-action",
      "residual-risk",
      "verification",
      "warning",
    ]);
    expect(resolved.authority.responseDetail).toBe("artifact-contract");
    expect(resolved.authority.locale).toBe("user");
    expect(resolved.identity).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(resolveCommunicationIntent([...candidates].reverse())).toEqual(resolved);
  });

  it("does not let a lower-precedence preference suppress required evidence", () => {
    const resolved = resolveCommunicationIntent([
      { source: "user", intent: { responseDetail: "concise" } },
      {
        source: "safety-authority",
        intent: { requiredContent: ["failure", "citation", "residual-risk"] },
      },
    ]);

    expect(resolved.intent.responseDetail).toBe("concise");
    expect(resolved.intent.requiredContent).toEqual(["citation", "failure", "residual-risk"]);
  });
});

describe("resolveCommunicationProfile", () => {
  it("renders only explicit prompt-owned obligations and preserves required content under concise detail", () => {
    const resolution = resolveCommunicationProfile({
      intent: resolveCommunicationIntent([{
        source: "user",
        intent: {
          responseDetail: "concise",
          locale: "es-MX",
          requiredContent: ["failure", "warning"],
        },
      }]),
      execution: { provider: "test-provider", model: "test-model", surface: "runtime" },
      capabilities: CAPABILITIES,
    });

    const projection = renderCommunicationPromptProjection(resolution);
    expect(projection).toContain("locale 'es-MX'");
    expect(projection).toContain("failure, warning");
    expect(projection).not.toContain("concise response detail");
  });

  it("uses a revisioned native detail control and reports translated profile loss", () => {
    const result = resolveCommunicationProfile({
      intent: resolveCommunicationIntent([{
        source: "user",
        intent: {
          responseDetail: "detailed",
          interactionProfile: {
            id: "reviewer",
            revision: "v2",
            behaviors: ["findings-first", "state-visible"],
          },
        },
      }]),
      execution: {
        routeId: "route-1",
        provider: "test-provider",
        model: "test-model",
        surface: "cli",
        harness: "codex",
      },
      capabilities: CAPABILITIES,
    });

    expect(result.responseDetail).toMatchObject({
      status: "exact",
      mechanism: "native",
      effective: "detailed",
      nativeValue: "high",
    });
    expect(result.interactionProfile).toMatchObject({
      status: "translated",
      mechanism: "native",
      effectiveProfileId: "reviewer",
      nativeValue: "pragmatic",
    });
    expect(result.semanticLoss).toEqual([
      "Native profile does not guarantee findings-first ordering.",
    ]);
    expect(result.locale).toEqual({ status: "not-requested", mechanism: "none" });
    expect(result.requiredContent).toEqual({ status: "not-requested", mechanism: "none" });
    expect(result.capabilityEvidence).toEqual(CAPABILITIES.evidence);
  });

  it("reports unsupported controls without silently approximating them", () => {
    const result = resolveCommunicationProfile({
      intent: resolveCommunicationIntent([{
        source: "agent-profile",
        intent: {
          responseDetail: "concise",
          interactionProfile: {
            id: "coach",
            revision: "v1",
            behaviors: ["next-action-explicit"],
          },
        },
      }]),
      execution: {
        provider: "unknown-provider",
        model: "unknown-model",
        surface: "managed-child",
      },
    });

    expect(result.responseDetail).toMatchObject({
      status: "unsupported",
      mechanism: "none",
      reason: "capability-unknown",
    });
    expect(result.interactionProfile).toMatchObject({
      status: "unsupported",
      mechanism: "none",
      reason: "capability-unknown",
    });
  });

  it("rejects mismatched or stale-shaped capability evidence", () => {
    const intent = resolveCommunicationIntent([{
      source: "user",
      intent: { responseDetail: "standard" },
    }]);

    expect(() => resolveCommunicationProfile({
      intent,
      execution: {
        provider: "different-provider",
        model: "test-model",
        surface: "runtime",
      },
      capabilities: CAPABILITIES,
    })).toThrow("must match");

    expect(() => resolveCommunicationProfile({
      intent,
      execution: {
        provider: "test-provider",
        model: "test-model",
        surface: "runtime",
      },
      capabilities: {
        ...CAPABILITIES,
        evidence: { ...CAPABILITIES.evidence, sourceRevision: "" },
      },
    })).toThrow("capability evidence");
  });

  it("rejects incomplete native mappings instead of silently omitting transport", () => {
    const intent = resolveCommunicationIntent([{
      source: "user",
      intent: { responseDetail: "detailed" },
    }]);
    const execution = { provider: "test-provider", model: "test-model", surface: "runtime" as const };

    expect(() => resolveCommunicationProfile({
      intent,
      execution,
      capabilities: {
        ...CAPABILITIES,
        responseDetail: {
          mechanism: "native",
          supported: ["detailed"],
          nativeValues: {},
        },
      },
    })).toThrow("requires a native value");

    expect(() => resolveCommunicationProfile({
      intent: resolveCommunicationIntent([{
        source: "user",
        intent: {
          interactionProfile: {
            id: "reviewer",
            revision: "v1",
            behaviors: ["findings-first"],
          },
        },
      }]),
      execution,
      capabilities: {
        ...CAPABILITIES,
        interactionProfiles: [{
          profileId: "reviewer",
          profileRevision: "v1",
          supportedBehaviors: ["findings-first"],
          mechanism: "native",
          fidelity: "exact",
          semanticLoss: [],
        }],
      },
    })).toThrow("requires a native value");
  });

  it("does not admit a native personality when revision or behaviors differ", () => {
    const execution = { provider: "test-provider", model: "test-model", surface: "runtime" as const };
    for (const interactionProfile of [
      { id: "reviewer", revision: "made-up", behaviors: ["findings-first"] as const },
      { id: "reviewer", revision: "v2", behaviors: ["plain-language"] as const },
    ]) {
      const result = resolveCommunicationProfile({
        intent: resolveCommunicationIntent([{ source: "user", intent: { interactionProfile } }]),
        execution,
        capabilities: CAPABILITIES,
      });
      expect(result.interactionProfile.status).toBe("unsupported");
    }
  });
});

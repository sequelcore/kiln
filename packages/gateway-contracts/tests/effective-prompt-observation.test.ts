import { describe, expect, it } from "vitest";
import type { EffectivePromptObservation } from "../src/index.js";
import {
  EffectivePromptObservationSchema,
  formatEffectivePromptObservation,
  presentOperatorEventPayload,
} from "../src/index.js";

const observation: EffectivePromptObservation = {
  version: "v1",
  requestIndex: 1,
  providerId: "codex-oauth",
  modelId: "gpt-5.6-sol",
  estimatedTokens: 120,
  componentCount: 2,
  componentScopeCounts: { static: 1, dynamic: 1, deferred: 0 },
  evidenceIdentity: `sha256:${"2".repeat(64)}`,
};

const communicationResolution = {
  version: "v1",
  requested: {
    version: "v1",
    intent: {
      responseDetail: "concise",
      interactionProfile: { id: "reviewer", revision: "v1", behaviors: ["findings-first"] },
      requiredContent: ["finding"],
      responseSkills: [],
      onUnsupported: "deny",
    },
    authority: {
      responseDetail: "user",
      interactionProfile: "user",
      responseSkills: [],
      onUnsupported: "provider-default",
      requiredContent: { finding: ["user"] },
    },
    identity: `sha256:${"3".repeat(64)}`,
  },
  execution: { provider: "codex", model: "gpt-5.6-sol", surface: "standalone-harness", harness: "codex" },
  responseDetail: { requested: "concise", effective: "concise", status: "exact", mechanism: "native", nativeValue: "low" },
  interactionProfile: { requestedProfileId: "reviewer", effectiveProfileId: "pragmatic", status: "translated", mechanism: "native", nativeValue: "pragmatic" },
  locale: { status: "not-requested", mechanism: "none" },
  requiredContent: { requested: ["finding"], effective: ["finding"], status: "exact", mechanism: "prompt" },
  artifactContract: { status: "not-requested", mechanism: "none" },
  responseSkills: { status: "not-requested", mechanism: "none" },
  capabilityEvidence: {
    sourceIdentity: "codex-agent-config",
    sourceRevision: "revision-1",
    observedAt: "2026-08-13T00:00:00.000Z",
  },
  semanticLoss: ["Ordering is not guaranteed."],
  identity: `sha256:${"4".repeat(64)}`,
} as const;

describe("EffectivePromptObservationSchema", () => {
  it("validates content-free final-request evidence", () => {
    expect(EffectivePromptObservationSchema.parse(observation)).toEqual(observation);
    expect(formatEffectivePromptObservation(observation)).toBe(
      "Effective prompt: 120 tokens, 2 components · codex-oauth/gpt-5.6-sol · request 2",
    );
  });

  it("presents requested/effective communication evidence on shared operator surfaces", () => {
    const presentation = presentOperatorEventPayload("effective_prompt_observed", {
      effectivePrompt: {
        ...observation,
        communicationResolution,
      },
    });
    expect(presentation).toMatchObject({ title: "Effective prompt observed", tone: "warning" });
    expect(presentation.details).toEqual(expect.arrayContaining([
      { label: "Detail requested", value: "concise" },
      { label: "Detail effective", value: "concise" },
      { label: "Semantic loss", value: "Ordering is not guaranteed." },
    ]));
  });

  it("rejects raw prompt text and inconsistent scope counts", () => {
    expect(EffectivePromptObservationSchema.safeParse({
      ...observation,
      rawPrompt: "secret",
    }).success).toBe(false);
    expect(EffectivePromptObservationSchema.safeParse({
      ...observation,
      componentScopeCounts: { static: 0, dynamic: 0, deferred: 0 },
    }).success).toBe(false);
    expect(EffectivePromptObservationSchema.safeParse({
      ...observation,
      communicationResolution: { ...communicationResolution, rawPrompt: "secret" },
    }).success).toBe(false);
  });
});

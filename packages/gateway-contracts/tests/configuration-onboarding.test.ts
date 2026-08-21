import { describe, expect, it } from "vitest";
import {
  KilnConfigurationOnboardingResultSchema,
  KilnConfigurationOnboardingApplyRequestSchema,
  KilnConfigurationOnboardingSnapshotSchema,
} from "../src/configuration-onboarding.js";

const target = {
  id: "codex-default",
  label: "Codex default",
  providerId: "codex-oauth",
  providerModelId: "gpt-5.6-terra",
  selected: true,
} as const;

describe("configuration onboarding contracts", () => {
  it("accepts a secret-free ready read model and rejects unknown fields", () => {
    const readiness = {
      schemaVersion: 1,
      status: "ready",
      scope: "project",
      posture: "read-only",
      targets: [target],
      defaultTargetId: target.id,
      blockers: [],
      nextAction: "Apply onboarding to this project.",
    } as const;

    expect(KilnConfigurationOnboardingSnapshotSchema.parse(readiness)).toEqual(readiness);
    expect(() => KilnConfigurationOnboardingSnapshotSchema.parse({ ...readiness, secret: "must-not-cross-boundary" })).toThrow();
    expect(JSON.stringify(readiness)).not.toMatch(/secret|token|api.?key|[A-Za-z]:\\/iu);
  });

  it("accepts blocked readiness and a deterministic apply outcome", () => {
    const blocked = {
      schemaVersion: 1,
      status: "blocked",
      scope: "project",
      posture: "read-only",
      targets: [],
      defaultTargetId: null,
      blockers: [{ code: "target-unavailable", message: "Connect and admit a direct target first." }],
      nextAction: "Run target setup before onboarding this project.",
    } as const;
    const request = {
      schemaVersion: 1,
      scope: "project",
      posture: "read-only",
      targetId: null,
    } as const;
    const outcome = {
      schemaVersion: 1,
      status: "committed",
      projectAdoption: {
        outcome: "committed",
        replayed: false,
        diagnostics: [],
      },
      targetSelection: null,
      blockers: [],
      nextAction: "Start the first turn.",
    } as const;

    expect(KilnConfigurationOnboardingSnapshotSchema.parse(blocked)).toEqual(blocked);
    expect(KilnConfigurationOnboardingApplyRequestSchema.parse(request)).toEqual(request);
    expect(KilnConfigurationOnboardingResultSchema.parse(outcome)).toEqual(outcome);
  });

  it("rejects a target carrying credentials or a machine path", () => {
    expect(() => KilnConfigurationOnboardingSnapshotSchema.parse({
      schemaVersion: 1,
      status: "ready",
      scope: "project",
      posture: "read-only",
      targets: [{ ...target, credentialId: "credential" }],
      defaultTargetId: target.id,
      blockers: [],
      nextAction: null,
    })).toThrow();
  });
});

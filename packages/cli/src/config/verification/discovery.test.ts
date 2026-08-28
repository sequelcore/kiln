import { discoverVerificationCapabilities } from "@kilnai/core/capabilities";
import {
  STATIC_ANALYSIS_PROFILE,
  STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST,
} from "@kilnai/core/verification";
import { describe, expect, it } from "vitest";
import { projectVerificationDiscoveryInput } from "./discovery.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;

describe("verification discovery projection", () => {
  it("projects all resolved producers without exposing executable locations", () => {
    const rawPath = "C:/Users/operator/private/tools/verifier.exe";
    const projected = projectVerificationDiscoveryInput({
      observedAt: "2026-08-28T12:00:00.000Z",
      validUntil: "2026-08-28T12:05:00.000Z",
      formal: {
        options: { executable: rawPath, verifierVersion: "4.11.0" },
        identity: { version: "4.11.0", installationDigest: DIGEST_A },
      },
      staticAnalysis: {
        options: { executable: rawPath, analyzerVersion: "1.80.0" },
        identity: {
          version: "1.80.0",
          executableDigest: DIGEST_B,
          sourceArchiveDigest: DIGEST_A,
          profileConfigDigest: STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST,
        },
      },
      quality: {
        options: {
          analyzerVersion: "3.0.0-beta.1",
          profiles: ["type-integrity", "complexity", "test-integrity"],
        },
      },
      inferential: {
        options: {
          executable: rawPath,
          expectedVersion: "2.5.0-rc.1",
          expectedExecutableDigest: DIGEST_B,
          repositoryRoot: "C:/Users/operator/private/repository",
        },
      },
    });

    expect(projected.producers.static_analyze?.profile).toBe(STATIC_ANALYSIS_PROFILE);
    expect(JSON.stringify(projected)).not.toContain("C:/Users/operator");
    const catalog = discoverVerificationCapabilities(projected).catalog;
    expect(catalog.descriptors).toHaveLength(4);
    expect(catalog.decisions.every((decision) => decision.status === "eligible")).toBe(true);
  });

  it("keeps unavailable and invalid providers visible with safe diagnostics", () => {
    const projected = projectVerificationDiscoveryInput({
      observedAt: "2026-08-28T12:00:00.000Z",
      validUntil: "2026-08-28T12:05:00.000Z",
      formal: {
        diagnostic: {
          code: "digest_mismatch",
          message: "raw operator path and digest details",
          expectedVersion: "4.11.0",
        },
      },
      staticAnalysis: {
        diagnostic: {
          code: "managed_artifact_unavailable",
          message: "private package resolver details",
        },
      },
      quality: {
        diagnostic: { code: "not_configured", message: "not configured" },
      },
      inferential: {
        diagnostic: { code: "version_mismatch", message: "private executable", },
      },
    });

    expect(projected.producers).toMatchObject({
      formal_verify: { status: "validation_failed", diagnostic: { code: "digest_mismatch" } },
      static_analyze: { status: "configured_unavailable", diagnostic: { code: "managed_artifact_unavailable" } },
      quality_analyze: { status: "unavailable", diagnostic: { code: "not_configured" } },
      gentle_review: { status: "validation_failed", diagnostic: { code: "version_mismatch" } },
    });
    expect(JSON.stringify(projected)).not.toContain("private");
  });
});

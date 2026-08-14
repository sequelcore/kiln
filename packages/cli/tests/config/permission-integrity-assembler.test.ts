import { describe, expect, it } from "vitest";
import { assembleRuntimePermissionIntegrity } from "../../src/config/permission-integrity-assembler.js";
import { createPermissionProjectionIntegrity } from "../../src/config/translators/permission-projection.js";
import { OPENCODE_NO_FILESYSTEM_SANDBOX } from "@kilnai/core";

const now = new Date("2026-08-13T18:00:00.000Z");

function projected(profile: "restricted" | "workspace-write" | "trusted-full-access") {
  const policy = profile === "trusted-full-access"
    ? { approval: "never" as const, sandbox: "danger-full-access" as const }
    : profile === "workspace-write"
      ? { approval: "on-request" as const, sandbox: "workspace-write" as const }
      : { approval: "on-request" as const, sandbox: "read-only" as const };
  return createPermissionProjectionIntegrity({
    harness: "codex",
    policy,
    translated: { backend: "codex", config: {}, nativeRules: {}, representableRules: [], unsupportedRules: [], constraintInstructions: [], warnings: [] },
    enforcement: { approvalControl: "enforced", filesystemSandbox: "enforced", networkBoundary: "enforced", strength: "strong" },
    now,
  });
}

const targetId = "codex-config";
const projectionDigest = "a".repeat(64);
function evidence(profile: "restricted" | "workspace-write" | "trusted-full-access", observedAt = now.toISOString(), proof: "proven" | "inferred" = "proven") {
  const binding = { harness: "codex" as const, sessionDigest: "b".repeat(64), targetId, projectionDigest, effectivePolicyDigest: "c".repeat(64), profile };
  return {
    requested: { schema: "kiln.runtime-permission-evidence" as const, version: 2 as const, kind: "requested" as const, ...binding, source: "runtime-request" as const, proof: "inferred" as const, requestedAt: observedAt },
    observed: { schema: "kiln.runtime-permission-evidence" as const, version: 2 as const, kind: "observed" as const, ...binding, requestDigest: "d".repeat(64), source: "runtime-observation" as const, proof, requestedAt: observedAt, observedAt, verifiedAt: observedAt },
  };
}
const assemble = (input: Parameters<typeof assembleRuntimePermissionIntegrity>[0]) => assembleRuntimePermissionIntegrity(input);

describe("permission integrity runtime assembler", () => {
  it("classifies exact current evidence as current-verified", () => {
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("restricted"), targetId, projectionDigest, now }).classification).toBe("current-verified");
  });

  it("classifies mismatch, missing, and stale evidence fail closed", () => {
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("workspace-write"), targetId, projectionDigest, now }).classification).toBe("runtime-policy-mismatch");
    expect(assemble({ integrity: projected("restricted"), targetId, projectionDigest, now }).classification).toBe("effective-policy-unproven");
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("restricted", "2026-08-13T17:00:00.000Z"), targetId, projectionDigest, now, ttlMs: 60_000 }).classification).toBe("stale-evidence");
  });

  it("requires stored authorization before full access can be current", () => {
    const integrity = projected("trusted-full-access");
    expect(assemble({ integrity, evidence: evidence("trusted-full-access"), targetId, projectionDigest, now }).classification).toBe("effective-policy-unproven");
  });

  it("accepts only non-future evidence through the exact TTL boundary", () => {
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("restricted", now.toISOString()), targetId, projectionDigest, now, ttlMs: 1_000 }).classification).toBe("current-verified");
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("restricted", new Date(now.getTime() + 1).toISOString()), targetId, projectionDigest, now, ttlMs: 1_000 }).classification).toBe("stale-evidence");
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("restricted", new Date(now.getTime() - 1_000).toISOString()), targetId, projectionDigest, now, ttlMs: 1_000 }).classification).toBe("current-verified");
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("restricted", new Date(now.getTime() - 1_001).toISOString()), targetId, projectionDigest, now, ttlMs: 1_000 }).classification).toBe("stale-evidence");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects unsafe TTL %s", (ttlMs) => {
    expect(() => assemble({ integrity: projected("restricted"), targetId, projectionDigest, now, ttlMs })).toThrow("TTL");
  });

  it("never treats divergent timestamps as current", () => {
    expect(assemble({
      integrity: projected("restricted"),
      evidence: { ...evidence("restricted"), observed: { ...evidence("restricted").observed, verifiedAt: "2026-08-13T18:00:00.001Z" } },
      targetId, projectionDigest, now,
    }).classification).not.toBe("current-verified");
  });

  it("rejects another projection/session and inferred handoff evidence", () => {
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("restricted"), targetId, projectionDigest: "e".repeat(64), now }).classification).not.toBe("current-verified");
    const otherSession = evidence("restricted");
    expect(assemble({ integrity: projected("restricted"), evidence: { ...otherSession, observed: { ...otherSession.observed, sessionDigest: "f".repeat(64) } }, targetId, projectionDigest, now }).classification).not.toBe("current-verified");
    expect(assemble({ integrity: projected("restricted"), evidence: evidence("restricted", now.toISOString(), "inferred"), targetId, projectionDigest, now }).classification).toBe("effective-policy-unproven");
  });

  it("suppresses only recurring remediation for an exact current OpenCode limitation acceptance", () => {
    const integrity = createPermissionProjectionIntegrity({
      harness: "opencode",
      policy: { approval: "on-request", sandbox: "workspace-write" },
      translated: { backend: "opencode", config: {}, nativeRules: {}, representableRules: [], unsupportedRules: [], constraintInstructions: [], warnings: [] },
      enforcement: { approvalControl: "not-enforced", filesystemSandbox: "not-enforced", networkBoundary: "unknown", strength: "rules-only" },
      semanticLimitations: [OPENCODE_NO_FILESYSTEM_SANDBOX], now,
    });
    const accepted = { limitationId: OPENCODE_NO_FILESYSTEM_SANDBOX.id, harness: "opencode" as const, sourceUrl: OPENCODE_NO_FILESYSTEM_SANDBOX.sourceUrl, upstreamRevision: OPENCODE_NO_FILESYSTEM_SANDBOX.upstreamRevision, sourceDigest: OPENCODE_NO_FILESYSTEM_SANDBOX.sourceDigest, acceptedBy: "operator", acceptedAt: "2026-08-13T00:00:00.000Z", reviewAfter: OPENCODE_NO_FILESYSTEM_SANDBOX.reviewAfter, revocable: true as const };
    const result = assemble({ integrity, targetId: "opencode-config", projectionDigest, projectPath: "C:/portable/project", now, limitationAcceptanceReader: () => accepted });
    expect(result).toMatchObject({ classification: "unsupported-semantic-translation", remediationRequiresApproval: false, enforcement: { strength: "rules-only", filesystemSandbox: "not-enforced" } });
    expect(assemble({ integrity, targetId: "opencode-config", projectionDigest, projectPath: "C:/portable/project", now, limitationAcceptanceReader: () => undefined }).remediationRequiresApproval).toBe(true);
  });
});

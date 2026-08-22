import { describe, expect, it } from "vitest";
import {
  KILN_SETTINGS_SECTION_IDS,
  KilnSettingsApplyRequestSchema,
  KilnSettingsMutationResultSchema,
  KilnSettingsProposalRequestSchema,
  KilnSettingsSnapshotSchema,
  projectKilnSettingsMutationResult,
  projectKilnSettingsProposal,
} from "../src/configuration-settings.js";

describe("configuration settings contracts", () => {
  it("defines the one cross-surface section vocabulary", () => {
    expect(KILN_SETTINGS_SECTION_IDS).toEqual([
      "general",
      "providers",
      "models",
      "permissions",
      "tools",
      "usage-and-limits",
      "agents",
      "health",
      "advanced",
    ]);
  });

  it("validates a secret-free settings snapshot", () => {
    const snapshot = KilnSettingsSnapshotSchema.parse({
      schemaRevision: 1,
      generatedAt: "2026-08-21T00:00:00.000Z",
      health: "current",
      sections: KILN_SETTINGS_SECTION_IDS.map((id) => ({ id, label: id, description: id, entryKeys: [] })),
      entries: [{
        key: "domain",
        identity: "/domain",
        section: "general",
        label: "Domain",
        description: "Project domain.",
        searchTerms: ["domain", "project"],
        control: { kind: "text" },
        supportedScopes: ["project"],
        effective: { value: "backend" },
        source: "project",
        override: "overridden",
        inherited: false,
        modified: true,
        writeTargets: [{
          scope: "project", document: "project-config", override: "overridden", modified: true, current: { value: "backend" },
          owners: ["project-configuration"], authorityImpact: "none", approvalRequired: false, activation: "next-session",
        }],
        owners: ["project-configuration"],
        authorityImpact: "none",
        approvalRequired: false,
        activation: "next-session",
        health: "current",
        capabilities: { read: true, set: true, reset: true },
        revisions: { project: `sha256:${"a".repeat(64)}` },
      }],
      revisions: { project: `sha256:${"a".repeat(64)}` },
      modifiedCount: 1,
    });

    expect(snapshot.entries[0]?.effective.value).toBe("backend");
  });

  it("rejects secret/path leakage and unbounded fields", () => {
    expect(() => KilnSettingsSnapshotSchema.parse({
      schemaRevision: 1,
      generatedAt: "2026-08-21T00:00:00.000Z",
      health: "current",
      sections: [],
      entries: [{
        key: "domain",
        identity: "/domain",
        section: "general",
        label: "Domain",
        description: "Project domain.",
        searchTerms: [],
        control: { kind: "text" },
        supportedScopes: ["project"],
        effective: { value: "backend", secret: "TOKEN=do-not-leak" },
        source: "project",
        override: "overridden",
        inherited: false,
        modified: true,
        writeTargets: [{ scope: "project", document: "C:\\Users\\operator\\.kiln\\kiln.yaml", override: "overridden", modified: true }],
        owners: ["project-configuration"],
        authorityImpact: "none",
        approvalRequired: false,
        activation: "next-session",
        health: "current",
        capabilities: { read: true, set: true, reset: true },
        revisions: { project: "sha256:abc" },
      }],
      revisions: { project: "sha256:abc" },
      modifiedCount: 1,
    })).toThrow();
  });

  it("requires a key for both setting operations and never accepts a whole-scope reset", () => {
    expect(KilnSettingsProposalRequestSchema.parse({
      operation: "setting.set", scope: "project", key: "domain", expectedRevision: `sha256:${"a".repeat(64)}`, value: "backend",
    })).toMatchObject({ operation: "setting.set", key: "domain" });
    expect(KilnSettingsProposalRequestSchema.parse({
      operation: "setting.reset", scope: "project", key: "domain", expectedRevision: `sha256:${"a".repeat(64)}`,
    })).toMatchObject({ operation: "setting.reset", key: "domain" });
    expect(() => KilnSettingsProposalRequestSchema.parse({
      operation: "setting.reset", scope: "project",
    })).toThrow();
  });

  it("projects proposals and results without paths, payloads, or raw diffs", () => {
    const proposal = projectKilnSettingsProposal({
      proposalId: "cfg_123",
      createdAt: "2026-08-21T00:00:00.000Z",
      scope: "project",
      operation: "setting.reset",
      status: "valid",
      baseRevision: `sha256:${"a".repeat(64)}`,
      normalizedPayload: { scope: "project", key: "domain" },
      affectedOwners: ["project-configuration"],
      affectedCanonicalPaths: ["C:\\Users\\operator\\.kiln\\kiln.yaml"],
      reconciliationTargets: [],
      authorityImpact: "none",
      approvalRequired: false,
      activation: "next-session",
      diagnostics: [],
      previewDiff: "--- secret diff",
      rollback: { restorable: true, summary: "Rollback C:\\Users\\Jane Doe\\Kiln Project\\.kiln\\kiln.yaml" },
    });
    expect(proposal).toMatchObject({ proposalId: "cfg_123", key: "domain", operation: "setting.reset" });
    expect(JSON.stringify(proposal)).not.toContain("Users");
    expect(JSON.stringify(proposal)).not.toContain("normalizedPayload");
    expect(JSON.stringify(proposal)).not.toContain("previewDiff");

    const result = projectKilnSettingsMutationResult({
      settlement: {
        proposalId: "cfg_123", approvalId: null, scope: "project", operation: "setting.reset",
        settledAt: "2026-08-21T00:00:00.000Z", outcome: "rejected", baseRevision: `sha256:${"a".repeat(64)}`,
        committedRevision: null, appliedWrites: [], reconciliationEffects: [],
        diagnostics: [
          { severity: "error", field: "configuration", message: "C:\\Users\\Jane Doe\\Kiln Project\\token=secret" },
          { severity: "warning", field: "reconcile", message: "Failed at /Users/Jane Doe/Kiln Project/.kiln/kiln.yaml" },
        ],
        rollbackToken: null, activation: "next-session",
      },
      replayed: false,
      readBackSchemaRevision: null,
      readBackVerified: false,
    });
    expect(result.rejectionCode).toBeDefined();
    expect(JSON.stringify(result)).not.toContain("Users");
    expect(JSON.stringify(result)).not.toContain("Jane Doe");
    expect(JSON.stringify(result)).not.toContain("Kiln Project");
    expect(KilnSettingsMutationResultSchema.parse(result)).toEqual(result);
  });

  it("validates an apply request as a proposal reference", () => {
    expect(KilnSettingsApplyRequestSchema.parse({ proposalId: "cfg_123" })).toEqual({ proposalId: "cfg_123" });
    expect(() => KilnSettingsApplyRequestSchema.parse({ proposalId: "" })).toThrow();
  });
});

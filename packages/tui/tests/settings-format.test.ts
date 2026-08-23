import { describe, expect, it } from "vitest";
import type { KilnSettingsSnapshot } from "@kilnai/gateway-contracts";
import { formatSettingsSnapshot } from "../src/settings-format.js";

const revision = `sha256:${"a".repeat(64)}`;

function snapshot(): KilnSettingsSnapshot {
  return {
    schemaRevision: 2,
    generatedAt: "2026-08-21T00:00:00.000Z",
    health: "current",
    activationStatus: {
      desiredRevisionSetId: revision,
      state: "scheduled",
      boundary: "next-turn",
      activeRevision: null,
      entries: [{
        proposalId: "cfg_settings",
        scope: "project",
        path: ".kiln/kiln.yaml",
        committedRevision: revision,
        boundary: "next-turn",
        state: "scheduled",
        activeRevision: null,
        evidence: "scheduled",
        reconciliationGenerations: [],
        summary: "The committed revision remains scheduled until a matching turn admission is persisted.",
      }],
      summary: "The committed revision remains scheduled until a matching turn admission is persisted.",
    },
    sections: [
      { id: "general", label: "General", description: "General preferences.", entryKeys: ["domain"] },
      { id: "providers", label: "Providers", description: "Provider state.", entryKeys: [] },
      { id: "models", label: "Models", description: "Model state.", entryKeys: [] },
      { id: "permissions", label: "Permissions", description: "Permission policy.", entryKeys: ["permissions.allowShell"] },
      { id: "tools", label: "Tools", description: "Tool controls.", entryKeys: [] },
      { id: "usage-and-limits", label: "Usage and Limits", description: "Limits.", entryKeys: [] },
      { id: "agents", label: "Agents", description: "Agent state.", entryKeys: [] },
      { id: "health", label: "Health", description: "Configuration health.", entryKeys: [] },
      { id: "advanced", label: "Advanced", description: "Advanced configuration.", entryKeys: [] },
    ],
    entries: [
      {
        key: "domain",
        identity: "/domain",
        section: "general",
        label: "Domain",
        description: "Project domain.",
        searchTerms: ["project"],
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
        revisions: { project: revision },
      },
      {
        key: "permissions.allowShell",
        identity: "/permissions/allowShell",
        section: "permissions",
        label: "Allow shell",
        description: "Permit shell tools.",
        searchTerms: ["authority", "terminal"],
        control: { kind: "toggle" },
        supportedScopes: ["project", "global"],
        effective: { value: false },
        source: "global",
        override: "inherited",
        inherited: true,
        modified: true,
        writeTargets: [
          {
            scope: "project", document: "project-config", override: "inherited", modified: false,
            owners: ["permission-policy"], authorityImpact: "expands-write", approvalRequired: true, activation: "next-turn",
          },
          {
            scope: "global", document: "global-config", override: "overridden", modified: true, current: { value: false },
            owners: ["permission-policy"], authorityImpact: "expands-write", approvalRequired: true, activation: "next-session",
          },
        ],
        owners: ["permission-policy"],
        authorityImpact: "expands-write",
        approvalRequired: true,
        activation: "next-turn",
        health: "current",
        capabilities: { read: true, set: true, reset: false },
        revisions: { project: revision, global: revision },
      },
    ],
    revisions: { project: revision, global: revision },
    modifiedCount: 2,
  };
}

describe("settings snapshot formatting", () => {
  it("uses the shared section vocabulary and provenance", () => {
    const output = formatSettingsSnapshot(snapshot());

    expect(output).toContain("activation: scheduled · next turn · The committed revision remains scheduled until a matching turn admission is persisted.");
    expect(output).toContain("General");
    expect(output).toContain("Domain: backend");
    expect(output).toContain("project: overridden · no authority impact · next session · project-configuration");
    expect(output).toContain("Permissions");
    expect(output).toContain("effective: global");
    expect(output).toContain("project: inherited · expands write · approval · next turn · permission-policy");
    expect(output).toContain("global: overridden · expands write · approval · next session · permission-policy");
  });

  it("filters by keys, labels, descriptions, and shared search terms", () => {
    const output = formatSettingsSnapshot(snapshot(), "terminal");

    expect(output).toContain("Allow shell");
    expect(output).not.toContain("Domain: backend");
    expect(formatSettingsSnapshot(snapshot(), "missing")).toContain("No settings match");
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { KilnSettingsMutationResult, KilnSettingsSnapshot } from "@kilnai/gateway-contracts";
import { SettingsPage } from "../src/components/settings-page.js";

const revision = `sha256:${"a".repeat(64)}`;

function snapshot(): KilnSettingsSnapshot {
  const sections: KilnSettingsSnapshot["sections"] = [
    { id: "general", label: "General", description: "General preferences.", entryKeys: ["domain"] },
    { id: "appearance", label: "Appearance", description: "Operator appearance.", entryKeys: [] },
    { id: "providers", label: "Providers", description: "Provider readiness.", entryKeys: [] },
    { id: "models", label: "Models", description: "Models.", entryKeys: [] },
    { id: "permissions", label: "Permissions", description: "Authority policy.", entryKeys: ["permissions.allowShell"] },
    { id: "tools", label: "Tools", description: "Tools.", entryKeys: [] },
    { id: "usage-and-limits", label: "Usage and Limits", description: "Limits.", entryKeys: [] },
    { id: "agents", label: "Agents", description: "Agents.", entryKeys: [] },
    { id: "health", label: "Health", description: "Health.", entryKeys: [] },
    { id: "advanced", label: "Advanced", description: "Advanced.", entryKeys: [] },
  ];
  return {
    schemaRevision: 3,
    generatedAt: "2026-08-21T00:00:00.000Z",
    health: "current",
    activationStatus: {
      desiredRevisionSetId: revision,
      state: "scheduled",
      boundary: "next-turn",
      activeRevision: null,
      entries: [{
        proposalId: "cfg_activation",
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
    sections,
    entries: [
      {
        key: "domain", identity: "/domain", section: "general", label: "Domain", description: "Project domain.",
        searchTerms: ["project"], control: { kind: "text" }, supportedScopes: ["project"], effective: { value: "backend" },
        source: "project", override: "overridden", inherited: false, modified: true,
        writeTargets: [{
          scope: "project", document: "project-config", override: "overridden", modified: true, current: { value: "backend" },
          owners: ["project-configuration"], authorityImpact: "none", approvalRequired: false, activation: "next-session",
        }], owners: ["project-configuration"],
        authorityImpact: "none", approvalRequired: false, activation: "next-session", health: "current",
        capabilities: { read: true, set: true, reset: true }, revisions: { project: revision },
      },
      {
        key: "permissions.allowShell", identity: "/permissions/allowShell", section: "permissions", label: "Allow shell",
        description: "Permit shell tools.", searchTerms: ["terminal"], control: { kind: "toggle" },
        supportedScopes: ["project"], effective: { value: false }, source: "global", override: "inherited", inherited: true,
        modified: false, writeTargets: [{
          scope: "project", document: "project-config", override: "inherited", modified: false,
          owners: ["permission-policy"], authorityImpact: "expands-write", approvalRequired: true, activation: "next-turn",
        }], owners: ["permission-policy"],
        authorityImpact: "expands-write", approvalRequired: true, activation: "next-turn", health: "current",
        capabilities: { read: true, set: true, reset: true }, revisions: { project: revision },
      },
    ],
    revisions: { project: revision },
    modifiedCount: 1,
  };
}

const committedResult: KilnSettingsMutationResult = {
  proposalId: "cfg_domain", scope: "project", operation: "setting.reset", outcome: "committed", rejectionCode: null,
  committedRevision: revision, activation: "next-session", reconciliation: [], diagnostics: [], replayed: false,
  activationObservation: {
    state: "scheduled", boundary: "next-session", committedRevision: revision, activeRevision: null,
    summary: "The committed revision activates at the next session boundary.",
  },
  readBack: { schemaRevision: 1, verified: true },
};

describe("SettingsPage", () => {
  it("renders the canonical aggregate activation state and boundary", () => {
    render(
      <SettingsPage
        section="general"
        snapshot={snapshot()}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onPropose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    const status = screen.getByRole("region", { name: "Configuration activation" });
    expect(status).toHaveTextContent("Scheduled");
    expect(status).toHaveTextContent("Next turn");
    expect(status).toHaveTextContent("matching turn admission");
  });

  it("keeps unavailable provider economics explicit in Usage and Limits", () => {
    render(
      <SettingsPage
        section="usage-and-limits"
        snapshot={snapshot()}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onPropose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Provider usage evidence" })).toBeInTheDocument();
    expect(screen.getByText(/absent evidence never means zero usage/i)).toBeInTheDocument();
  });

  it("renders effective provenance and proposes a typed per-key reset", async () => {
    const onPropose = vi.fn(async () => ({
      proposalId: "cfg_domain", createdAt: "2026-08-21T00:00:00.000Z", scope: "project" as const,
      operation: "setting.reset" as const, key: "domain", status: "valid" as const, baseRevision: revision,
      affectedOwners: ["project-configuration"], reconciliation: [], authorityImpact: "none" as const,
      approvalRequired: false, activation: "next-session" as const, diagnostics: [],
      rollback: { restorable: true, summary: "Restore the prior value." },
    }));
    const onApply = vi.fn(async () => committedResult);

    render(<SettingsPage section="general" snapshot={snapshot()} loading={false} error={null} onRefresh={vi.fn()} onPropose={onPropose} onApply={onApply} />);

    expect(screen.getByText("Project · Overridden in project · Next session")).toBeVisible();
    const reset = screen.getByRole("button", { name: "Reset Domain to inheritance" });
    fireEvent.click(reset);
    expect(reset).toBeDisabled();
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(onPropose).toHaveBeenCalledWith({ operation: "setting.reset", scope: "project", key: "domain", expectedRevision: revision });

    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ proposalId: "cfg_domain" }));
    expect(await screen.findByRole("status")).toHaveTextContent("next session boundary");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Value for Domain" })).toHaveFocus());
  });

  it("filters the advanced inventory by query and modified state", () => {
    render(<SettingsPage section="advanced" snapshot={snapshot()} loading={false} error={null} onRefresh={vi.fn()} onPropose={vi.fn()} onApply={vi.fn()} />);

    expect(screen.getByText("Domain")).toBeVisible();
    expect(screen.getByText("Allow shell")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Modified only" }));
    expect(screen.getByText("Domain")).toBeVisible();
    expect(screen.queryByText("Allow shell")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search all settings" }), { target: { value: "missing" } });
    expect(screen.getByText("No settings match this filter.")).toBeVisible();
  });

  it("proposes native toggle values with the loaded revision", async () => {
    const onPropose = vi.fn(async () => ({
      proposalId: "cfg_permission", createdAt: "2026-08-21T00:00:00.000Z", scope: "project" as const,
      operation: "setting.set" as const, key: "permissions.allowShell", status: "valid" as const, baseRevision: revision,
      affectedOwners: ["permission-policy"], reconciliation: [], authorityImpact: "expands-write" as const,
      approvalRequired: true, activation: "next-turn" as const, diagnostics: [],
      rollback: { restorable: true, summary: "Restore the prior value." },
    }));
    render(<SettingsPage section="permissions" snapshot={snapshot()} loading={false} error={null} onRefresh={vi.fn()} onPropose={onPropose} onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("switch", { name: "Value for Allow shell" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Allow shell" }));

    await waitFor(() => expect(onPropose).toHaveBeenCalledWith({
      operation: "setting.set",
      scope: "project",
      key: "permissions.allowShell",
      expectedRevision: revision,
      value: true,
    }));
  });

  it("disables every mutation control while one proposal is pending", async () => {
    let resolveProposal!: (value: Awaited<ReturnType<Parameters<typeof SettingsPage>[0]["onPropose"]>>) => void;
    const onPropose = vi.fn(() => new Promise<Awaited<ReturnType<Parameters<typeof SettingsPage>[0]["onPropose"]>>>((resolve) => {
      resolveProposal = resolve;
    }));

    render(<SettingsPage section="advanced" snapshot={snapshot()} loading={false} error={null} onRefresh={vi.fn()} onPropose={onPropose} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset Domain to inheritance" }));

    expect(screen.getByRole("button", { name: "Save Allow shell" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Value for Allow shell" })).toBeDisabled();

    resolveProposal({
      proposalId: "cfg_domain", createdAt: "2026-08-21T00:00:00.000Z", scope: "project",
      operation: "setting.reset", key: "domain", status: "valid", baseRevision: revision,
      affectedOwners: ["project-configuration"], reconciliation: [], authorityImpact: "none",
      approvalRequired: false, activation: "next-session", diagnostics: [],
      rollback: { restorable: true, summary: "Restore the prior value." },
    });
    await screen.findByRole("dialog");
  });

  it("loads the selected scope's own value and reset state", async () => {
    const base = snapshot();
    const profile: KilnSettingsSnapshot["entries"][number] = {
      key: "activeInstructionProfiles",
      identity: "/activeInstructionProfiles",
      section: "agents",
      label: "Active instruction profiles",
      description: "Profiles active in this scope.",
      searchTerms: ["instructions"],
      control: { kind: "list", itemKind: "text" },
      supportedScopes: ["project", "global"],
      effective: { value: ["project-profile"] },
      source: "composed",
      override: "overridden",
      inherited: false,
      modified: true,
      writeTargets: [
        {
          scope: "project", document: "project-config", override: "overridden", modified: true, current: { value: ["project-profile"] },
          owners: ["project-configuration"], authorityImpact: "none", approvalRequired: false, activation: "next-session",
        },
        {
          scope: "global", document: "global-config", override: "overridden", modified: true, current: { value: ["global-profile"] },
          owners: ["instruction-profiles"], authorityImpact: "none", approvalRequired: false, activation: "reconcile",
        },
      ],
      owners: ["instruction-profiles"],
      authorityImpact: "none",
      approvalRequired: false,
      activation: "reconcile",
      health: "current",
      capabilities: { read: true, set: true, reset: true },
      revisions: { project: revision, global: revision },
    };
    const scoped: KilnSettingsSnapshot = {
      ...base,
      sections: base.sections.map((section) => section.id === "agents"
        ? { ...section, entryKeys: ["activeInstructionProfiles"] }
        : section),
      entries: [...base.entries, profile],
      modifiedCount: 2,
    };
    const onPropose = vi.fn(async () => ({
      proposalId: "cfg_profiles", createdAt: "2026-08-21T00:00:00.000Z", scope: "global" as const,
      operation: "setting.reset" as const, key: "activeInstructionProfiles", status: "valid" as const, baseRevision: revision,
      affectedOwners: ["instruction-profiles"], reconciliation: [], authorityImpact: "none" as const,
      approvalRequired: false, activation: "reconcile" as const, diagnostics: [],
      rollback: { restorable: true, summary: "Restore the prior value." },
    }));

    render(<SettingsPage section="agents" snapshot={scoped} loading={false} error={null} onRefresh={vi.fn()} onPropose={onPropose} onApply={vi.fn()} />);
    const scope = screen.getByRole("combobox", { name: "Write scope for Active instruction profiles" });
    expect(screen.getByRole("textbox", { name: "Value for Active instruction profiles" })).toHaveValue("project-profile");
    fireEvent.change(scope, { target: { value: "global" } });
    expect(screen.getByRole("textbox", { name: "Value for Active instruction profiles" })).toHaveValue("global-profile");
    fireEvent.click(screen.getByRole("button", { name: "Reset Active instruction profiles to inheritance" }));
    await waitFor(() => expect(onPropose).toHaveBeenCalledWith({
      operation: "setting.reset",
      scope: "global",
      key: "activeInstructionProfiles",
      expectedRevision: revision,
    }));
  });

  it("restores focus to advanced search when reset removes the filtered row", async () => {
    const onPropose = vi.fn(async () => ({
      proposalId: "cfg_domain", createdAt: "2026-08-21T00:00:00.000Z", scope: "project" as const,
      operation: "setting.reset" as const, key: "domain", status: "valid" as const, baseRevision: revision,
      affectedOwners: ["project-configuration"], reconciliation: [], authorityImpact: "none" as const,
      approvalRequired: false, activation: "next-session" as const, diagnostics: [],
      rollback: { restorable: true, summary: "Restore the prior value." },
    }));

    function Harness() {
      const [current, setCurrent] = useState(snapshot);
      return (
        <SettingsPage
          section="advanced"
          snapshot={current}
          loading={false}
          error={null}
          onPropose={onPropose}
          onApply={async () => committedResult}
          onRefresh={() => {
            setCurrent((previous) => ({
              ...previous,
              generatedAt: "2026-08-21T00:00:01.000Z",
              entries: previous.entries.map((entry) => entry.key === "domain" ? {
                ...entry,
                effective: { value: "default" },
                source: "default",
                override: "inherited",
                inherited: true,
                modified: false,
                writeTargets: [{
                  scope: "project", document: "project-config", override: "inherited", modified: false,
                  owners: ["project-configuration"], authorityImpact: "none", approvalRequired: false, activation: "next-session",
                }],
              } : entry),
              modifiedCount: 0,
            }));
          }}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Modified only" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Domain to inheritance" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply change" }));

    await waitFor(() => expect(screen.queryByText("Domain")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Search all settings" })).toHaveFocus());
  });

  it.each([
    {
      outcome: "rejected" as const,
      rejectionCode: "revision-conflict" as const,
      message: "configuration changed",
    },
    {
      outcome: "committed-reconciliation-failed" as const,
      rejectionCode: null,
      message: "reconciliation failed",
    },
  ])("announces $outcome without presenting the draft as effective", async ({ outcome, rejectionCode, message }) => {
    const onPropose = vi.fn(async () => ({
      proposalId: "cfg_domain", createdAt: "2026-08-21T00:00:00.000Z", scope: "project" as const,
      operation: "setting.reset" as const, key: "domain", status: "valid" as const, baseRevision: revision,
      affectedOwners: ["project-configuration"], reconciliation: [], authorityImpact: "none" as const,
      approvalRequired: false, activation: "next-session" as const, diagnostics: [],
      rollback: { restorable: true, summary: "Restore the prior value." },
    }));
    const onApply = vi.fn(async (): Promise<KilnSettingsMutationResult> => ({
      ...committedResult,
      outcome,
      rejectionCode,
      committedRevision: outcome === "rejected" ? null : revision,
      readBack: { schemaRevision: outcome === "rejected" ? null : 1, verified: false },
    }));

    render(<SettingsPage section="general" snapshot={snapshot()} loading={false} error={null} onRefresh={vi.fn()} onPropose={onPropose} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset Domain to inheritance" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply change" }));

    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(screen.getByText("Project · Overridden in project · Next session")).toBeVisible();
  });
});

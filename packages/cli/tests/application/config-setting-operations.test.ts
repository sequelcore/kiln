import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  applyConfigMutation,
  approveConfigMutation,
  proposeConfigMutation,
} from "../../src/application/config-mutation-authority.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";
import { type ProjectStateBinding, resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import {
  configSettingDescriptor,
  configSettingDescriptors,
  configSettingGovernance,
  parseConfigSettingValue,
} from "../../src/application/config-setting-descriptors.js";
import { readConfigStatusSnapshot, readConfigStatusView } from "../../src/application/config-status.js";
import { defaultGlobalConfig } from "../../src/config/global-config.js";
import { GLOBAL_CONFIG_FIELD_DESCRIPTORS } from "../../src/config/global-config-schema.js";
import { admitSettingsProposalRecord } from "../../src/application/config-settings.js";

let tempDir: string;
let globalHome: string;
let projectStateBinding!: ProjectStateBinding;
let previousXdgConfigHome: string | undefined;

const reconcileOk = vi.fn(async () => []);

function globalConfigPath(): string {
  return join(globalHome, "kiln", "config.yaml");
}

function projectConfigPath(): string {
  return projectStateBinding.configPath;
}

function mutationStore(): ConfigMutationStore {
  return new ConfigMutationStore(tempDir, {
    root: projectStateBinding.mutationsPath,
    globalConfigPath: globalConfigPath(),
  });
}

function seedGlobalConfig(): void {
  mkdirSync(join(globalHome, "kiln"), { recursive: true });
  writeFileSync(globalConfigPath(), stringify(defaultGlobalConfig()), "utf-8");
}

function seedProjectConfig(extra = ""): void {
  mkdirSync(projectStateBinding.projectStateRoot, { recursive: true });
  writeFileSync(projectConfigPath(), [
    "# Project configuration authored by the operator",
    "version: '1'",
    "domain: default",
    extra,
    "",
  ].filter(Boolean).join("\n"), "utf-8");
}

function propose(payload: unknown, operation: "setting.set" | "setting.reset" = "setting.set") {
  const record = proposeConfigMutation({
    projectPath: tempDir,
    projectStateBinding,
    globalConfigPath: globalConfigPath(),
    operation,
    payload,
  });
  mutationStore().saveProposal(record);
  return record;
}

async function apply(proposalId: string, approvalId?: string) {
  return await applyConfigMutation({
    projectPath: tempDir,
    proposalId,
    requester: "operator",
    projectStateBinding,
    globalConfigPath: globalConfigPath(),
    ...(approvalId ? { approvalId } : {}),
    reconcile: reconcileOk,
    readEffectiveState: async () => undefined,
  });
}

describe("governed configuration settings", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-setting-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-setting-home-"));
    mkdirSync(join(tempDir, ".git"), { recursive: true });
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
    projectStateBinding = resolveProjectStateBinding(tempDir);
    reconcileOk.mockClear();
  });

  afterEach(() => {
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
  });

  it("commits a low-sensitivity project setting without approval, preserving comments", async () => {
    seedProjectConfig();
    const record = propose({ scope: "project", key: "domain", value: "backend" });

    expect(record.proposal.scope).toBe("project");
    expect(record.proposal.approvalRequired).toBe(false);
    expect(record.proposal.activation).toBe("next-session");

    const result = await apply(record.proposal.proposalId);

    expect(result.settlement.outcome).toBe("committed");
    const written = readFileSync(projectConfigPath(), "utf-8");
    expect(written).toContain("# Project configuration authored by the operator");
    expect(parse(written).domain).toBe("backend");
  });

  it("requires approval before changing permission material", async () => {
    seedProjectConfig("permissions:\n  sandbox: read-only");
    const record = propose({ scope: "project", key: "permissions.sandbox", value: "danger-full-access" });

    expect(record.proposal.authorityImpact).toBe("unknown");
    expect(record.proposal.approvalRequired).toBe(true);

    const refused = await apply(record.proposal.proposalId);
    expect(refused.settlement.outcome).toBe("rejected");
    expect(parse(readFileSync(projectConfigPath(), "utf-8")).permissions.sandbox).toBe("read-only");

    const approval = approveConfigMutation({
      projectPath: tempDir,
      projectStateBinding,
      proposalId: record.proposal.proposalId,
    });
    const committed = await apply(record.proposal.proposalId, approval.approvalId);

    expect(committed.settlement.outcome).toBe("committed");
    expect(parse(readFileSync(projectConfigPath(), "utf-8")).permissions.sandbox).toBe("danger-full-access");
  });

  it("refuses a key in a scope its descriptor does not admit", () => {
    seedGlobalConfig();
    const projectOnly = propose({ scope: "global", key: "permissions.sandbox", value: "read-only" });
    expect(projectOnly.proposal.status).toBe("invalid");
    expect(projectOnly.proposal.diagnostics.map((entry) => entry.message).join(" ")).toContain("cannot be set in the global scope");

    seedProjectConfig();
    const globalOnly = propose({ scope: "project", key: "identity.name", value: "Operator" });
    expect(globalOnly.proposal.status).toBe("invalid");
  });

  it("refuses an unknown key and an inadmissible value", () => {
    seedProjectConfig();
    expect(propose({ scope: "project", key: "not.a.key", value: "x" }).proposal.status).toBe("invalid");
    expect(propose({ scope: "project", key: "maxDepth", value: "not-a-number" }).proposal.status).toBe("invalid");
    expect(propose({ scope: "project", key: "permissions.approval", value: "whenever" }).proposal.status).toBe("invalid");
    expect(propose({ scope: "project", key: "permissions.sandbox", value: "unrestricted" }).proposal.status).toBe("invalid");
  });

  it("never creates configuration that has not been adopted", () => {
    const project = propose({ scope: "project", key: "domain", value: "backend" });
    expect(project.proposal.status).toBe("invalid");
    expect(existsSync(projectConfigPath())).toBe(false);

    const global = propose({ scope: "global", key: "identity.name", value: "Operator" });
    expect(global.proposal.status).toBe("invalid");
    expect(existsSync(globalConfigPath())).toBe(false);
  });

  it("resets one project key to inheritance while preserving unrelated YAML and comments", async () => {
    mkdirSync(projectStateBinding.projectStateRoot, { recursive: true });
    writeFileSync(projectConfigPath(), [
      "# Keep this operator comment",
      "version: '1'",
      "domain: backend",
      "channels:",
      "  - cli",
      "permissions:",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf-8");
    const record = propose({ scope: "project", key: "domain" }, "setting.reset");

    expect(record.proposal.status).toBe("valid");
    expect(record.proposal.approvalRequired).toBe(false);
    const committed = await apply(record.proposal.proposalId);
    expect(committed.settlement.outcome).toBe("committed");

    const written = readFileSync(projectConfigPath(), "utf-8");
    expect(written).toContain("# Keep this operator comment");
    expect(parse(written).domain).toBeUndefined();
    expect(parse(written).channels).toEqual(["cli"]);
    expect(parse(written).permissions.sandbox).toBe("read-only");
  });

  it("requires the keyed reset to use the descriptor governance and preserves nested parents", async () => {
    seedProjectConfig("permissions:\n  sandbox: danger-full-access\n  approval: on-request");
    const record = propose({ scope: "project", key: "permissions.sandbox" }, "setting.reset");

    expect(record.proposal.authorityImpact).toBe("unknown");
    expect(record.proposal.approvalRequired).toBe(true);

    const refused = await apply(record.proposal.proposalId);
    expect(refused.settlement.outcome).toBe("rejected");
    expect(parse(readFileSync(projectConfigPath(), "utf-8")).permissions.sandbox).toBe("danger-full-access");

    const approval = approveConfigMutation({
      projectPath: tempDir,
      projectStateBinding,
      proposalId: record.proposal.proposalId,
    });
    const committed = await apply(record.proposal.proposalId, approval.approvalId);
    expect(committed.settlement.outcome).toBe("committed");
    expect(parse(readFileSync(projectConfigPath(), "utf-8")).permissions.sandbox).toBeUndefined();
    expect(parse(readFileSync(projectConfigPath(), "utf-8")).permissions.approval).toBe("on-request");
  });

  it("rejects keyless reset and never restores a whole document", () => {
    seedProjectConfig("channels:\n  - cli");
    const record = propose({ scope: "project" }, "setting.reset");
    expect(record.proposal.status).toBe("invalid");
    expect(record.proposal.diagnostics.map((entry) => entry.message).join(" ")).toContain("Required non-empty string");
    expect(parse(readFileSync(projectConfigPath(), "utf-8")).channels).toEqual(["cli"]);
  });

  it("rejects reset for an already inherited nested key without rewriting YAML", () => {
    seedProjectConfig("channels:\n  - cli");
    const before = readFileSync(projectConfigPath(), "utf-8");

    const record = propose({ scope: "project", key: "skills.selection.mode" }, "setting.reset");

    expect(record.proposal.status).toBe("invalid");
    expect(record.proposal.diagnostics.map((entry) => entry.message).join(" ")).toContain("already inherited");
    expect(readFileSync(projectConfigPath(), "utf-8")).toBe(before);
  });

  it("rejects a settings proposal when its loaded snapshot revision is stale", async () => {
    seedProjectConfig();
    const status = await readConfigStatusSnapshot({
      projectPath: tempDir,
      projectStateBinding,
      view: "settings",
    });
    const settings = (await readConfigStatusView(status, "settings")).value as {
      readonly revisions: { readonly project?: string };
    };
    writeFileSync(projectConfigPath(), `${readFileSync(projectConfigPath(), "utf-8")}maxDepth: 2\n`, "utf-8");

    const record = propose({
      scope: "project",
      key: "domain",
      value: "backend",
      expectedRevision: settings.revisions.project,
    });

    expect(record.proposal.status).toBe("invalid");
    expect(record.proposal.diagnostics.map((entry) => entry.field)).toContain("expectedRevision");
  });

  it("publishes modified then inherited state across set and keyed reset", async () => {
    seedGlobalConfig();
    seedProjectConfig();

    const set = propose({ scope: "project", key: "domain", value: "backend" });
    expect((await apply(set.proposal.proposalId)).settlement.outcome).toBe("committed");
    const modifiedSnapshot = await readConfigStatusSnapshot({
      projectPath: tempDir,
      projectStateBinding,
      view: "settings",
    });
    const modifiedView = await readConfigStatusView(modifiedSnapshot, "settings");
    expect((modifiedView.value as { entries: readonly { key: string; modified: boolean }[] }).entries.find((entry) => entry.key === "domain")).toMatchObject({ modified: true });

    const reset = propose({ scope: "project", key: "domain" }, "setting.reset");
    expect((await apply(reset.proposal.proposalId)).settlement.outcome).toBe("committed");
    const inheritedSnapshot = await readConfigStatusSnapshot({
      projectPath: tempDir,
      projectStateBinding,
      view: "settings",
    });
    const inheritedView = await readConfigStatusView(inheritedSnapshot, "settings");
    expect((inheritedView.value as { entries: readonly { key: string; modified: boolean; inherited: boolean }[] }).entries.find((entry) => entry.key === "domain")).toMatchObject({ modified: false, inherited: true });
  });

  it("derives project authority from the canonical schema rather than a second table", () => {
    // The project schema owns `x-kiln-authority-impact`; this table must not
    // restate it. Skills material is authority-bearing there, and plain work
    // limits are not.
    for (const key of [
      "permissions.sandbox",
      "workGovernance.defaultPosture",
      "skills.selection.mode",
      "skills.builtin",
    ]) {
      expect(configSettingGovernance(configSettingDescriptor(key)!, "project").authorityBearing).toBe(true);
    }
    for (const key of ["domain", "channels"]) {
      expect(configSettingGovernance(configSettingDescriptor(key)!, "project").authorityBearing).toBe(false);
    }
    for (const key of ["maxDepth", "parallelWorkers"]) {
      expect(configSettingGovernance(configSettingDescriptor(key)!, "project").authorityBearing).toBe(true);
    }
    for (const key of ["ui.appearance", "identity.name", "identity.timezone"]) {
      expect(configSettingGovernance(configSettingDescriptor(key)!, "global").authorityBearing).toBe(false);
    }
  });

  it("derives every global settings governance fact from the canonical global schema", () => {
    for (const descriptor of configSettingDescriptors().filter((entry) => entry.scopes.includes("global"))) {
      const field = [...descriptor.path.keys()]
        .map((index) => `/${descriptor.path.slice(0, descriptor.path.length - index).join("/")}`)
        .map((identity) => GLOBAL_CONFIG_FIELD_DESCRIPTORS.find((entry) => entry.identity === identity))
        .find((entry) => entry !== undefined);

      expect(field, descriptor.key).toBeDefined();
      expect(configSettingGovernance(descriptor, "global"), descriptor.key).toEqual({
        authorityBearing: field?.authorityImpact === "authority-bearing",
        activation: field?.activation,
        owners: [field?.semanticOwner],
      });
    }
  });

  it("refuses a scope that is not stated exactly", () => {
    seedProjectConfig();
    const typo = proposeConfigMutation({
      projectPath: tempDir,
      projectStateBinding,
      globalConfigPath: globalConfigPath(),
      operation: "setting.set",
      payload: { scope: "Project", key: "domain", value: "backend" },
    });
    expect(typo.proposal.status).toBe("invalid");
    expect(typo.proposal.diagnostics.map((entry) => entry.message).join(" ")).toContain("exactly");
  });

  it("rejects a result the project schema refuses, before writing anything", async () => {
    seedProjectConfig();
    const record = propose({ scope: "project", key: "skills.builtin", value: "null" });
    expect(record.proposal.status).toBe("invalid");
    expect(record.proposal.diagnostics.map((entry) => entry.message).join(" ")).toContain("schema");
    expect(readFileSync(projectConfigPath(), "utf-8")).not.toContain("builtin");
  });

  it("refuses to edit a key that resolves through a YAML alias", () => {
    mkdirSync(projectStateBinding.projectStateRoot, { recursive: true });
    writeFileSync(projectConfigPath(), [
      "version: '1'",
      "base: &base",
      "  selection:",
      "    mode: advisory",
      "skills: *base",
      "",
    ].join("\n"), "utf-8");

    const record = propose({ scope: "project", key: "skills.selection.mode", value: "auto" });
    expect(record.proposal.status).toBe("invalid");
    expect(record.proposal.diagnostics.map((entry) => entry.message).join(" ")).toContain("alias");
  });

  it("admits every documented value shape", () => {
    const cases: readonly (readonly [string, string, unknown])[] = [
      ["channels", "a, b ,c", ["a", "b", "c"]],
      ["maxDepth", "3", 3],
      ["permissions.sandbox", "read-only", "read-only"],
      ["skills.builtin", '{"enabled":false}', { enabled: false }],
      ["workGovernance.defaultPosture", "direct", "direct"],
    ];
    for (const [key, raw, expected] of cases) {
      const parsed = parseConfigSettingValue(configSettingDescriptor(key)!, raw);
      expect(parsed.ok).toBe(true);
      expect(parsed.ok && parsed.value).toEqual(expected);
    }
  });

  it("normalizes structured values from curated GUI controls through descriptor admission", () => {
    seedProjectConfig();

    expect(propose({ scope: "project", key: "skills.selection.mode", value: "auto" }).proposal.status).toBe("valid");
    expect(propose({ scope: "project", key: "maxDepth", value: 3 }).proposal.status).toBe("valid");
    const list = propose({ scope: "project", key: "channels", value: ["cli", "gui"] });
    expect(list.proposal.status).toBe("valid");
    expect(parse(list.writes[0]!.nextContent).channels).toEqual(["cli", "gui"]);
    expect(propose({
      scope: "project",
      key: "skills.builtin",
      value: { enabled: false, include: ["repo-review"] },
    }).proposal.normalizedPayload).toEqual({
      scope: "project",
      key: "skills.builtin",
      value: { enabled: false, include: ["repo-review"] },
    });
  });

  it("rejects non-settings proposals at the settings apply boundary", () => {
    seedProjectConfig();
    const settings = propose({ scope: "project", key: "domain", value: "backend" });
    const foreign = {
      ...settings,
      proposal: { ...settings.proposal, operation: "context_governance.adapt" as const },
    };

    expect(() => admitSettingsProposalRecord(foreign, foreign.proposal.proposalId))
      .toThrow("is not a settings mutation");
  });

  it("does not admit unsupported proposal record versions", async () => {
    seedProjectConfig("maxDepth: 2");
    const record = proposeConfigMutation({
      projectPath: tempDir,
      projectStateBinding,
      globalConfigPath: globalConfigPath(),
      operation: "setting.reset",
      payload: { scope: "project", key: "maxDepth" },
    });
    mutationStore().saveProposal({ ...record, recordVersion: 1 } as never);

    const result = await apply(record.proposal.proposalId);
    expect(result.settlement.outcome).toBe("rejected");
    expect(result.settlement.diagnostics[0]?.message).toContain("not found");
    expect(readFileSync(projectConfigPath(), "utf-8")).toContain("maxDepth: 2");
  });

  it("does not execute an unsupported unkeyed record even when its bytes already landed", async () => {
    seedProjectConfig("maxDepth: 2");
    const current = readFileSync(projectConfigPath(), "utf-8");
    const proposed = proposeConfigMutation({
      projectPath: tempDir,
      projectStateBinding,
      globalConfigPath: globalConfigPath(),
      operation: "setting.reset",
      payload: { scope: "project", key: "maxDepth" },
    });
    const landed = "version: '1'\ndomain: default\n";
    const unsupported = {
      ...proposed,
      recordVersion: undefined,
      proposal: {
        ...proposed.proposal,
        normalizedPayload: { scope: "project" },
      },
      writes: [{
        ...proposed.writes[0]!,
        previousContent: current,
        nextContent: landed,
        nextHash: createHash("sha256").update(landed).digest("hex"),
      }],
    };
    const store = mutationStore();
    store.saveProposal(unsupported as never);
    writeFileSync(projectConfigPath(), landed, "utf-8");
    store.writeProgressMarker({
      proposalId: proposed.proposal.proposalId,
      path: projectConfigPath(),
      intendedRevision: `sha256:${createHash("sha256").update(landed).digest("hex")}`,
      startedAt: "2026-08-21T00:00:00.000Z",
    });

    const result = await apply(proposed.proposal.proposalId);
    expect(result.settlement.outcome).toBe("rejected");
    expect(store.readProgressMarker(proposed.proposal.proposalId)).not.toBeNull();
    expect(readFileSync(projectConfigPath(), "utf-8")).toBe(landed);
  });

  it("sets a global key through the same operation as a project key", async () => {
    seedGlobalConfig();
    const record = propose({ scope: "global", key: "identity.name", value: "Operator" });

    expect(record.proposal.scope).toBe("global");
    expect(record.proposal.activation).toBe("hot");

    const result = await apply(record.proposal.proposalId);
    expect(result.settlement.outcome).toBe("committed");
    expect(parse(readFileSync(globalConfigPath(), "utf-8")).identity.name).toBe("Operator");
  });
});

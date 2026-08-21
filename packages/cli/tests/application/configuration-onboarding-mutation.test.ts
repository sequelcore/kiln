import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  applyConfigMutation,
  proposeConfigMutation,
} from "../../src/application/config-mutation-authority.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";

describe("project.adopt mutation", () => {
  let projectPath: string;
  let globalHome: string;
  let previousXdgConfigHome: string | undefined;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "kiln-project-adopt-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-project-adopt-global-"));
    mkdirSync(join(globalHome, "kiln"), { recursive: true });
    writeFileSync(join(globalHome, "kiln", "config.yaml"), "version: '4'\n", "utf8");
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
    mkdirSync(join(projectPath, ".kiln"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  });

  it("adopts the minimal read-only project document through the authority", async () => {
    const record = proposeConfigMutation({
      projectPath,
      operation: "project.adopt",
      payload: { scope: "project", posture: "read-only" },
    });
    expect(record.proposal.status).toBe("valid");
    expect(record.proposal.scope).toBe("project");
    expect(record.proposal.affectedCanonicalPaths).toEqual([join(projectPath, ".kiln", "kiln.yaml")]);
    expect(record.writes[0]?.nextContent).not.toMatch(/app\.yaml|gateway\.yaml|memory|provider|channels|teamMode/iu);
    new ConfigMutationStore(projectPath).saveProposal(record);

    const result = await applyConfigMutation({
      projectPath,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: async () => [],
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    expect(parse(readFileSync(join(projectPath, ".kiln", "kiln.yaml"), "utf8"))).toEqual({
      version: "1",
      permissions: { approval: "on-request", sandbox: "read-only" },
    });
  });

  it("fails closed for an unsupported posture and writes nothing", () => {
    const record = proposeConfigMutation({
      projectPath,
      operation: "project.adopt",
      payload: { scope: "project", posture: "danger-full-access" },
    });
    expect(record.proposal.status).toBe("invalid");
    expect(existsSync(join(projectPath, ".kiln", "kiln.yaml"))).toBe(false);
  });

  it("does not admit workspace-write through first-run adoption", () => {
    const record = proposeConfigMutation({
      projectPath,
      operation: "project.adopt",
      payload: { scope: "project", posture: "workspace-write" },
    });

    expect(record.proposal.status).toBe("invalid");
    expect(record.proposal.diagnostics.some((entry) => entry.field === "posture")).toBe(true);
  });

  it("preserves an untrusted global approval bound in the adopted project", async () => {
    writeFileSync(join(globalHome, "kiln", "config.yaml"), [
      "version: '4'",
      "permissions:",
      "  approval: untrusted",
      "  sandbox: read-only",
      "permissionCeiling:",
      "  approval: untrusted",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf8");
    const record = proposeConfigMutation({
      projectPath,
      operation: "project.adopt",
      payload: { scope: "project", posture: "read-only" },
    });
    expect(record.proposal.status).toBe("valid");
    new ConfigMutationStore(projectPath).saveProposal(record);
    const result = await applyConfigMutation({
      projectPath,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: async () => [],
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    expect(parse(readFileSync(join(projectPath, ".kiln", "kiln.yaml"), "utf8"))).toEqual({
      version: "1",
      permissions: { approval: "untrusted", sandbox: "read-only" },
    });
  });

  it("preserves an on-failure global approval bound in the adopted project", async () => {
    writeFileSync(join(globalHome, "kiln", "config.yaml"), [
      "version: '4'",
      "permissions:",
      "  approval: on-failure",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf8");
    const record = proposeConfigMutation({
      projectPath,
      operation: "project.adopt",
      payload: { scope: "project", posture: "read-only" },
    });
    expect(record.proposal.status).toBe("valid");
    new ConfigMutationStore(projectPath).saveProposal(record);
    const result = await applyConfigMutation({
      projectPath,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: async () => [],
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    expect(parse(readFileSync(join(projectPath, ".kiln", "kiln.yaml"), "utf8"))).toEqual({
      version: "1",
      permissions: { approval: "on-failure", sandbox: "read-only" },
    });
  });
});

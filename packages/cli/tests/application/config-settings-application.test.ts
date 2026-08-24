import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { defaultGlobalConfig } from "../../src/config/global-config.js";
import { createConfigSettingsApplication } from "../../src/application/config-settings-application.js";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../../src/application/project-state-root.js";

let projectPath: string;
let configHome: string;
let projectStateBinding: ProjectStateBinding;
let previousXdgConfigHome: string | undefined;

describe("configuration settings application port", () => {
  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "kiln-settings-app-"));
    configHome = mkdtempSync(join(tmpdir(), "kiln-settings-home-"));
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    projectStateBinding = resolveProjectStateBinding(projectPath);
    bootstrapProjectAdoption(projectStateBinding);
    writeFileSync(projectStateBinding.configPath, "version: '1'\ndomain: default\n", "utf8");
    mkdirSync(join(configHome, "kiln"), { recursive: true });
    writeFileSync(join(configHome, "kiln", "config.yaml"), stringify(defaultGlobalConfig()), "utf8");
  });

  afterEach(() => {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  });

  it("reads, proposes, and applies one typed setting without surface policy", async () => {
    const application = createConfigSettingsApplication({ projectPath, reconcile: async () => [] });
    const snapshot = await application.read();
    const proposal = application.propose({
      operation: "setting.set",
      scope: "project",
      key: "domain",
      expectedRevision: snapshot.revisions.project ?? "absent",
      value: "backend",
    });

    expect(proposal).toMatchObject({ status: "valid", authorityImpact: "none", approvalRequired: false });
    const result = await application.apply({ proposalId: proposal.proposalId }, "operator");

    expect(result).toMatchObject({ outcome: "committed", rejectionCode: null });
    expect(parse(readFileSync(projectStateBinding.configPath, "utf8")).domain).toBe("backend");
  });

  it("keeps authority approval explicit at the shared boundary", async () => {
    const application = createConfigSettingsApplication({ projectPath, reconcile: async () => [] });
    const snapshot = await application.read();
    const proposal = application.propose({
      operation: "setting.set",
      scope: "project",
      key: "permissions.sandbox",
      expectedRevision: snapshot.revisions.project ?? "absent",
      value: "workspace-write",
    });

    expect((await application.apply({ proposalId: proposal.proposalId }, "operator")).outcome).toBe("rejected");
    const approval = application.approve({
      proposalId: proposal.proposalId,
      approvedBy: "operator",
      surface: "tui",
    });
    expect(approval).toBeDefined();
    if (!approval) throw new Error("expected authority-bearing proposal approval");
    await expect(application.apply({ proposalId: proposal.proposalId, approvalId: approval.approvalId }, "operator"))
      .resolves.toMatchObject({ outcome: "committed" });
  });
});

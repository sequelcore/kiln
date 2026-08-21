import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import { deriveEffectiveKilnYaml } from "../../src/config/config-merger.js";
import { readGlobalExecutionTargetAuthority } from "../../src/config/global-config.js";
import { resolveExecutionRouteCandidates } from "../../src/config/execution-route-resolver.js";
import { writeExecutionTargetEvidenceSnapshot } from "../../src/config/execution-target-evidence-store.js";
import { readKilnYaml } from "../../src/kiln-yaml.js";
import { makeOperatorSurfaceGlobalConfig, makeOperatorSurfaceTargetEvidence } from "../commands/operator-surface-v4-fixture.js";
import {
  applyConfigurationOnboarding,
  readConfigurationOnboarding,
} from "../../src/application/configuration-onboarding.js";

const target = {
  id: "codex-default",
  kind: "direct" as const,
  label: "Codex default",
  providerId: "codex-oauth",
  providerModelId: "gpt-5.6-terra",
};

function globalConfig(defaultTargetId?: string): KilnGlobalConfig {
  return {
    version: "4",
    targetCatalog: {
      evidenceRevision: `sha256:${"a".repeat(64)}`,
      accounts: [],
      accountPolicies: [],
      targets: [target] as never,
    },
    ...(defaultTargetId === undefined ? {} : { targetRouting: { defaultTargetId } }),
  };
}

describe("configuration onboarding application", () => {
  let projectPath: string;
  let globalHome: string;
  let previousXdgConfigHome: string | undefined;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "kiln-onboarding-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-onboarding-global-"));
    mkdirSync(join(globalHome, "kiln"), { recursive: true });
    writeFileSync(join(globalHome, "kiln", "config.yaml"), "version: '4'\n", "utf8");
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  });

  it("reports ready only when a current admitted direct target is available", () => {
    const dependencies = {
      readGlobalConfig: () => globalConfig("codex-default"),
      readTargetAuthority: vi.fn(() => ({ current: true })),
    };

    expect(readConfigurationOnboarding({ projectPath, dependencies })).toEqual({
      schemaVersion: 1,
      status: "ready",
      scope: "project",
      posture: "read-only",
      targets: [{
        id: target.id,
        label: target.label,
        providerId: target.providerId,
        providerModelId: target.providerModelId,
        selected: true,
      }],
      defaultTargetId: target.id,
      blockers: [],
      nextAction: "Apply onboarding to this project.",
    });
  });

  it("blocks without a global admitted direct target", () => {
    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => ({ version: "4" }),
        readTargetAuthority: vi.fn(() => undefined),
      },
    });

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.blockers[0]?.code).toBe("target-unavailable");
    expect(snapshot.nextAction).toContain("target");
  });

  it("does not claim completion when project permissions are inherited from a broad global posture", () => {
    const kilnDir = join(projectPath, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeFileSync(join(kilnDir, "kiln.yaml"), "version: '1'\n", "utf8");
    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => ({ ...globalConfig("codex-default"), permissions: { approval: "never", sandbox: "danger-full-access" } }),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(snapshot.status).toBe("ready");
    expect(snapshot.nextAction).toContain("Apply");
  });

  it("accepts an explicit untrusted project approval when global policy requires it", () => {
    const kilnDir = join(projectPath, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeFileSync(join(kilnDir, "kiln.yaml"), [
      "version: '1'",
      "permissions:",
      "  approval: untrusted",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf8");
    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => ({ ...globalConfig("codex-default"), permissions: { approval: "untrusted", sandbox: "read-only" } }),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(snapshot.status).toBe("complete");
  });

  it("accepts an on-failure project approval as stricter than the safe baseline", () => {
    const kilnDir = join(projectPath, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeFileSync(join(kilnDir, "kiln.yaml"), [
      "version: '1'",
      "permissions:",
      "  approval: on-failure",
      "  sandbox: read-only",
      "",
    ].join("\n"), "utf8");
    const snapshot = readConfigurationOnboarding({
      projectPath,
      dependencies: {
        readGlobalConfig: () => globalConfig("codex-default"),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(snapshot.status).toBe("complete");
  });

  it("adopts once and makes a rerun a no-op", async () => {
    const dependencies = {
      readGlobalConfig: () => globalConfig("codex-default"),
      readTargetAuthority: vi.fn(() => ({ current: true })),
    };
    const request = {
      schemaVersion: 1 as const,
      scope: "project" as const,
      posture: "read-only" as const,
      targetId: target.id,
    };

    const first = await applyConfigurationOnboarding({ projectPath, request, dependencies });
    expect(first.status).toBe("committed");
    expect(first.projectAdoption?.outcome).toBe("committed");
    expect(parse(readFileSync(join(projectPath, ".kiln", "kiln.yaml"), "utf8"))).toEqual({
      version: "1",
      permissions: { approval: "on-request", sandbox: "read-only" },
    });

    const second = await applyConfigurationOnboarding({ projectPath, request, dependencies });
    expect(second.status).toBe("committed");
    expect(second.projectAdoption).toBeNull();
    expect(second.targetSelection).toBeNull();
  });

  it("composes a safe first turn onto the exact admitted provider/model route", async () => {
    const admittedGlobal = makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.6-terra", "codex-default");
    const globalPath = join(globalHome, "kiln", "config.yaml");
    writeFileSync(globalPath, stringify(admittedGlobal), "utf8");
    writeExecutionTargetEvidenceSnapshot({
      globalConfigPath: globalPath,
      snapshot: makeOperatorSurfaceTargetEvidence("codex-oauth", "gpt-5.6-terra", "codex-default"),
    });
    const result = await applyConfigurationOnboarding({
      projectPath,
      globalConfigPath: globalPath,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: "codex-default" },
      dependencies: { readGlobalConfig: () => admittedGlobal },
    });

    expect(result.status).toBe("committed");
    const project = readKilnYaml(join(projectPath, ".kiln"));
    const effective = deriveEffectiveKilnYaml(admittedGlobal, project);
    expect(effective?.permissions).toMatchObject({ approval: "on-request", sandbox: "read-only" });
    const authority = readGlobalExecutionTargetAuthority(admittedGlobal, { globalConfigPath: globalPath });
    const routes = resolveExecutionRouteCandidates({ globalConfig: admittedGlobal, executionCatalog: authority?.executionCatalog });
    expect(routes).toEqual([{ routeId: "codex-default", provider: "codex-oauth", model: "gpt-5.6-terra" }]);
  });

  it("rejects before writing when target selection needs approval", async () => {
    const dependencies = {
      readGlobalConfig: () => globalConfig(),
      readTargetAuthority: vi.fn(() => ({ current: true })),
    };

    const result = await applyConfigurationOnboarding({
      projectPath,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: target.id },
      dependencies,
    });

    expect(result.status).toBe("rejected");
    expect(result.projectAdoption).toBeNull();
    expect(result.targetSelection).toBeNull();
    expect(result.nextAction).toContain("approval");
    expect(existsSync(join(projectPath, ".kiln", "kiln.yaml"))).toBe(false);
  });

  it("reports an unexpected second-operation rejection as partial after project commit", async () => {
    const result = await applyConfigurationOnboarding({
      projectPath,
      approve: true,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: target.id },
      dependencies: {
        readGlobalConfig: () => globalConfig(),
        readTargetAuthority: () => ({ current: true }),
      },
    });

    expect(result.status).toBe("partial");
    expect(result.projectAdoption?.outcome).toBe("committed");
    expect(result.targetSelection?.outcome).toBe("rejected");
    expect(existsSync(join(projectPath, ".kiln", "kiln.yaml"))).toBe(true);
  });

  it("writes nothing when readiness is blocked", async () => {
    const result = await applyConfigurationOnboarding({
      projectPath,
      request: { schemaVersion: 1, scope: "project", posture: "read-only", targetId: null },
      dependencies: {
        readGlobalConfig: () => ({ version: "4" }),
        readTargetAuthority: () => undefined,
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.projectAdoption).toBeNull();
    expect(existsSync(join(projectPath, ".kiln", "kiln.yaml"))).toBe(false);
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import { digestSkillPackage } from "@kilnai/core/skill";
import {
  readExternalSkillApprovals,
  writeExternalSkillApproval,
} from "../../src/config/external-skill-approval-store.js";
import {
  syncCodexExternalSkillExposure,
  uninstallCodexExternalSkillExposure,
} from "../../src/config/codex-external-skill-exposure-projection.js";
import { readSkillCatalogStatus } from "../../src/config/skill-catalog-status.js";

describe("Codex external skill exposure projection", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("requires separately stored approval and never approves changed contents during sync", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-exposure-"));
    roots.push(root);
    const home = join(root, "home");
    const skill = join(home, ".agents", "skills", "one");
    mkdirSync(skill, { recursive: true });
    const content = Buffer.from("---\nname: one\ndescription: one\n---\n");
    writeFileSync(join(skill, "SKILL.md"), content);
    const sourceId = "shared-agents:user:one:one";
    const skillConfig = {
      externalCatalog: { version: 2 as const, harnesses: { codex: { keepImplicit: [{ sourceId }] } } },
    };
    const options = { userHome: home, skillConfig, pluginProvider: () => ({ roots: [], diagnostics: [] }) };
    expect((await syncCodexExternalSkillExposure(options)).errors[0]).toContain("Needs review");
    expect(readExternalSkillApprovals([sourceId], home)).toEqual([]);
    const approval = {
      version: 1 as const,
      harness: "codex" as const,
      sourceId,
      packageDigest: digestSkillPackage([{ path: "SKILL.md", content }]),
    };
    writeExternalSkillApproval(approval, home);
    expect((await syncCodexExternalSkillExposure(options)).errors).toEqual([]);
    mkdirSync(join(root, "project"));
    const status = () =>
      readSkillCatalogStatus({ ...options, projectPath: join(root, "project") }).inventory?.externalExposure?.find(
        (item) => item.harness === "codex",
      );
    expect(status()).toMatchObject({ status: "current", realizedImplicit: 1 });
    writeFileSync(join(skill, "SKILL.md"), `${content.toString()}Changed instructions\n`);
    expect((await syncCodexExternalSkillExposure(options)).errors[0]).toContain("Needs review");
    expect(status()).toMatchObject({ status: "blocked", reason: expect.stringContaining("Needs review") });
    expect(readExternalSkillApprovals([sourceId], home)).toEqual([approval]);
  });

  it("uses a global-only inventory budget and makes the owned deny the final effective rule", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-exposure-"));
    roots.push(root);
    const home = join(root, "home");
    const skill = join(home, ".agents", "skills", "one");
    const content = Buffer.from("---\nname: one\ndescription: one\n---\n", "utf8");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), content);
    const config = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const path = join(skill, "SKILL.md");
    writeFileSync(
      config,
      `[[skills.config]]\npath = "${path.replaceAll("\\", "\\\\")}"\nenabled = false\n[[skills.config]]\nname = "one"\nenabled = true\n`,
      "utf8",
    );
    const result = await syncCodexExternalSkillExposure({
      userHome: home,
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
      skillConfig: { externalCatalog: { version: 2, harnesses: { codex: { keepImplicit: [] } } } },
    });
    expect(result.errors).toEqual([]);
    const items = (parseToml(readFileSync(config, "utf8")) as Record<string, any>).skills.config as unknown[];
    expect(items).toEqual([
      { path, enabled: false },
      { name: "one", enabled: true },
      { path, enabled: false },
    ]);

    const before = readFileSync(config, "utf8");
    const converged = await syncCodexExternalSkillExposure({
      userHome: home,
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
      skillConfig: { externalCatalog: { version: 2, harnesses: { codex: { keepImplicit: [] } } } },
      dryRun: true,
    });
    expect(converged).toMatchObject({
      errors: [],
      outcomes: [{ status: "unchanged", reason: "reviewed Codex external exposure rules are current" }],
    });
    expect(readFileSync(config, "utf8")).toBe(before);

    writeFileSync(config, `${readFileSync(config, "utf8")}\n[[skills.config]]\nname = "one"\nenabled = true\n`, "utf8");
    mkdirSync(join(root, "project"), { recursive: true });
    const status = readSkillCatalogStatus({
      projectPath: join(root, "project"),
      userHome: home,
      skillConfig: { externalCatalog: { version: 2, harnesses: { codex: { keepImplicit: [] } } } },
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
    }).inventory?.externalExposure?.find((entry) => entry.harness === "codex");
    expect(status).toMatchObject({ status: "stale", freshness: "stale", suppressed: 0 });

    const repaired = await syncCodexExternalSkillExposure({
      userHome: home,
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
      skillConfig: { externalCatalog: { version: 2, harnesses: { codex: { keepImplicit: [] } } } },
    });
    expect(repaired).toMatchObject({ errors: [], outcomes: [{ status: "written" }] });
    const repairedItems = (parseToml(readFileSync(config, "utf8")) as Record<string, any>).skills.config as unknown[];
    expect(repairedItems.at(-1)).toEqual({ path, enabled: false });
    const stable = await syncCodexExternalSkillExposure({
      userHome: home,
      pluginProvider: () => ({ roots: [], diagnostics: [] }),
      skillConfig: { externalCatalog: { version: 2, harnesses: { codex: { keepImplicit: [] } } } },
      dryRun: true,
    });
    expect(stable).toMatchObject({ errors: [], outcomes: [{ status: "unchanged" }] });

    expect(uninstallCodexExternalSkillExposure({ userHome: home, force: true }).errors).toEqual([]);
    const rolledBack = (parseToml(readFileSync(config, "utf8")) as Record<string, any>).skills.config as unknown[];
    expect(rolledBack).toEqual([
      { path, enabled: false },
      { name: "one", enabled: true },
      { name: "one", enabled: true },
    ]);
  });
});

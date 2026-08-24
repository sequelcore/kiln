import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { defaultGlobalConfig } from "../../src/config/global-config.js";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../../src/application/project-state-root.js";
import {
  createCliOperatorThemeController,
  persistOperatorThemePreference,
  resolveGuiThemePreference,
} from "../../src/application/operator-theme-preferences.js";

let tempDir: string;
let globalHome: string;
let projectBinding: ProjectStateBinding;
let previousXdgConfigHome: string | undefined;
let previousCwd: string;

function globalConfigPath(): string {
  return join(globalHome, "kiln", "config.yaml");
}

function seedGlobalConfig(): void {
  mkdirSync(join(globalHome, "kiln"), { recursive: true });
  writeFileSync(globalConfigPath(), stringify(defaultGlobalConfig()), "utf-8");
}

describe("operator theme preferences", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-theme-preferences-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-theme-config-"));
    mkdirSync(join(tempDir, ".git"), { recursive: true });
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    previousCwd = process.cwd();
    process.env.XDG_CONFIG_HOME = globalHome;
    process.chdir(tempDir);
    seedGlobalConfig();
    projectBinding = resolveProjectStateBinding(tempDir);
    mkdirSync(projectBinding.projectStateRoot, { recursive: true });
    writeFileSync(projectBinding.configPath, 'version: "1"\n', "utf-8");
    bootstrapProjectAdoption(projectBinding);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
  });

  it("resolves GUI theme preference from request, then GUI config, then TUI config", () => {
    expect(resolveGuiThemePreference("vesper", { version: "4", ui: { theme: "automata" } })).toBe("vesper");
    expect(resolveGuiThemePreference(undefined, { version: "4", ui: { theme: "automata" } })).toBe("automata");
    expect(resolveGuiThemePreference(undefined, null)).toBe("phosphor");
  });

  it("persists operator theme defaults through the mutation authority", async () => {
    await persistOperatorThemePreference("vesper", { projectPath: tempDir });

    expect(parse(readFileSync(globalConfigPath(), "utf-8")).ui.theme).toBe("vesper");
  });

  it("lets CLI operator theme tool persist defaults but rejects live session changes", async () => {
    const controller = createCliOperatorThemeController();

    await expect(controller.setTheme({ theme: "vesper", scope: "session" })).resolves.toEqual({
      ok: false,
      error: "The CLI has no live visual theme surface. Use scope='persisted' to update GUI and TUI defaults.",
    });
    await expect(controller.setTheme({ theme: "vesper", scope: "persisted" })).resolves.toEqual({
      ok: true,
      appliedTheme: "vesper",
    });
    expect(parse(readFileSync(globalConfigPath(), "utf-8")).ui.theme).toBe("vesper");
  });
});

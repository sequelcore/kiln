import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("gui command helpers", () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let tmpConfigHome: string;

  beforeEach(() => {
    tmpConfigHome = mkdtempSync(join(tmpdir(), "kiln-gui-config-"));
    process.env.XDG_CONFIG_HOME = tmpConfigHome;
  });

  afterEach(() => {
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    rmSync(tmpConfigHome, { recursive: true, force: true });
  });

  it("resolves GUI theme from ui.theme, then default", async () => {
    const { resolveGuiThemePreference } = await import("../../src/commands/gui-options.js");
    const { defaultGlobalConfig } = await import("../../src/config/global-config.js");

    expect(resolveGuiThemePreference(undefined, {
      ...defaultGlobalConfig(),
      ui: { theme: "automata" },
    })).toBe("automata");

    expect(resolveGuiThemePreference(undefined, {
      ...defaultGlobalConfig(),
      ui: { theme: "system-follow" },
    })).toBe("system-follow");

    expect(resolveGuiThemePreference(undefined, null)).toBe("phosphor");
    expect(resolveGuiThemePreference("invalid-theme", null)).toBe("phosphor");
  });

  it("refuses to mint canonical global configuration from a preference change", async () => {
    const { persistGuiThemePreference } = await import("../../src/commands/gui-options.js");

    await expect(persistGuiThemePreference("automata")).rejects.toThrow(/has not been adopted/u);
    expect(existsSync(join(tmpConfigHome, "kiln", "config.yaml"))).toBe(false);
  });

  it("persists GUI theme into global config and builds launch URL with theme query", async () => {
    const { buildGuiAttachUrl, buildGuiUrl, persistGuiThemePreference } = await import("../../src/commands/gui-options.js");
    const { defaultGlobalConfig } = await import("../../src/config/global-config.js");
    const { stringify } = await import("yaml");

    mkdirSync(join(tmpConfigHome, "kiln"), { recursive: true });
    writeFileSync(join(tmpConfigHome, "kiln", "config.yaml"), stringify(defaultGlobalConfig()), "utf-8");

    await persistGuiThemePreference("automata");

    const written = readFileSync(
      join(tmpConfigHome, "kiln", "config.yaml"),
      "utf-8",
    );

    expect(written).toContain("version: \"4\"");
    expect(written).toContain("ui:");
    expect(written).toContain("theme: automata");
    expect(buildGuiUrl("http://localhost:5183/gui/", "automata")).toBe("http://localhost:5183/gui/?theme=automata");
    expect(buildGuiUrl("http://localhost:5183/gui/", "automata", "operator-secret")).toBe(
      "http://localhost:5183/gui/?theme=automata#operatorToken=operator-secret",
    );
    expect(buildGuiAttachUrl("http://localhost:3800", "automata")).toBe("http://localhost:3800/gui/?theme=automata");
    expect(buildGuiAttachUrl("https://gateway.example.com/apps", "automata")).toBe("https://gateway.example.com/gui/?theme=automata");
  });

  it("rejects non-http GUI attach URLs", async () => {
    const { buildGuiAttachUrl } = await import("../../src/commands/gui-options.js");

    expect(() => buildGuiAttachUrl("file:///tmp/gui", "phosphor")).toThrow("GUI attach URL must use http:// or https://");
  });
});

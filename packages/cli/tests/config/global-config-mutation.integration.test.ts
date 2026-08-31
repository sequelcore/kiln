import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GlobalConfigMutationError,
  readGlobalConfig,
  resolveGlobalConfigPath,
} from "../../src/config/global-config.js";
import { persistGlobalConfigFixture } from "./global-config-fixture.js";

describe.sequential("global config mutation integration", () => {
  let root: string;
  let previousXdgConfigHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kiln-global-config-mutation-"));
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
  });

  afterEach(() => {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    rmSync(root, { recursive: true, force: true });
  });

  it("creates and replaces the real canonical file without torn or residual lock state", () => {
    persistGlobalConfigFixture({
      version: "7",
      identity: { name: "operator" },
    });
    const first = readGlobalConfig();

    persistGlobalConfigFixture((current) => ({
      ...current!,
      ui: {
        appearance: { mode: "dark", themeByScheme: { light: "automata", dark: "vesper" } },
      },
    }));

    expect(first).toEqual({ version: "7", identity: { name: "operator" } });
    expect(readGlobalConfig()).toEqual({
      version: "7",
      identity: { name: "operator" },
      ui: {
        appearance: { mode: "dark", themeByScheme: { light: "automata", dark: "vesper" } },
      },
    });
    expect(readdirSync(join(root, "kiln"))).toEqual(["config.yaml"]);
  });

  it("fails closed on an unparseable lock instead of overwriting concurrent state", () => {
    persistGlobalConfigFixture({ version: "7" });
    const configPath = resolveGlobalConfigPath();
    const before = readFileSync(configPath, "utf8");
    writeFileSync(`${configPath}.lock`, "incomplete-owner", "utf8");

    expect(() => persistGlobalConfigFixture({ version: "7", identity: { name: "changed" } }))
      .toThrow(expect.objectContaining<Partial<GlobalConfigMutationError>>({
        code: "GLOBAL_CONFIG_LOCK_UNAVAILABLE",
      }));
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });
});

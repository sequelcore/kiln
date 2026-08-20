import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCommunicationIntent } from "@kilnai/core";
import {
  readGlobalCommunicationProjectionSnapshot,
  syncGlobalCommunicationProjection,
} from "../../src/config/global-communication-projection.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), "kiln-global-communication-"));
  roots.push(home);
  return home;
}

function conciseIntent() {
  return resolveCommunicationIntent([{
    source: "global",
    intent: { responseDetail: "concise", onUnsupported: "omit" },
  }]);
}

describe("global Claude communication projection", () => {
  it("projects global concise intent without replacing unrelated user settings", () => {
    const userHome = createHome();
    const claudeDir = join(userHome, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ theme: "dark" }, null, 2));

    const result = syncGlobalCommunicationProjection({
      intent: conciseIntent(),
      userHome,
    });

    expect(result.errors).toEqual([]);
    expect(result.outcome).toMatchObject({
      targetId: "claude-global-output-style",
      status: "written",
    });
    expect(JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"))).toEqual({
      theme: "dark",
      outputStyle: "Concise",
    });
    expect(existsSync(join(userHome, ".kiln", "runtime", "native-projections", "install-state.json"))).toBe(true);
  });

  it("reports managed drift and preserves the changed value", () => {
    const userHome = createHome();
    expect(syncGlobalCommunicationProjection({ intent: conciseIntent(), userHome }).errors).toEqual([]);
    const settingsPath = join(userHome, ".claude", "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ outputStyle: "Explanatory" }, null, 2));

    const result = syncGlobalCommunicationProjection({ intent: conciseIntent(), userHome });

    expect(result.outcome.status).toBe("blocked");
    expect(result.errors[0]).toContain("managed field drift");
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({ outputStyle: "Explanatory" });
  });

  it("classifies a projection as stale when canonical intent changes", () => {
    const userHome = createHome();
    expect(syncGlobalCommunicationProjection({ intent: conciseIntent(), userHome }).errors).toEqual([]);
    const providerDefault = resolveCommunicationIntent([{
      source: "global",
      intent: { responseDetail: "provider-default", onUnsupported: "omit" },
    }]);

    expect(readGlobalCommunicationProjectionSnapshot({ intent: providerDefault, userHome }))
      .toMatchObject({ targetId: "claude-global-output-style", status: "stale" });
  });
});

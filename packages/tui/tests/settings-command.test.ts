import { describe, expect, it } from "vitest";
import { buildSettingsProposalRequest, parseSettingsCommand } from "../src/settings-command.js";

describe("TUI settings commands", () => {
  it("keeps search, set, and reset as distinct local operations", () => {
    expect(parseSettingsCommand("permissions")).toEqual({ kind: "search", query: "permissions" });
    expect(parseSettingsCommand("set --global identity.name Ada Lovelace")).toEqual({
      kind: "set",
      scope: "global",
      approve: false,
      key: "identity.name",
      value: "Ada Lovelace",
    });
    expect(parseSettingsCommand("reset --approve permissions.sandbox")).toEqual({
      kind: "reset",
      scope: "project",
      approve: true,
      key: "permissions.sandbox",
    });
  });

  it("builds the same typed request and exact scope revision used by every surface", () => {
    expect(buildSettingsProposalRequest({
      kind: "set",
      scope: "project",
      approve: false,
      key: "domain",
      value: "backend",
    }, {
      global: `sha256:${"a".repeat(64)}`,
      project: `sha256:${"b".repeat(64)}`,
    })).toEqual({
      operation: "setting.set",
      scope: "project",
      key: "domain",
      expectedRevision: `sha256:${"b".repeat(64)}`,
      value: "backend",
    });
  });
});

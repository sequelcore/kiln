import { describe, expect, it } from "vitest";
import { CLI_COMMANDS, resolveCliCommand } from "../src/cli.js";

const EXPECTED_COMMAND_IDS = [
  "init", "run", "plan", "project", "status", "doctor", "memory", "config",
  "mcp-config", "native-harness", "operator-runtime", "domain", "gateway",
  "model-gateway", "dev", "gui", "goal", "managed-agent", "feedback",
  "benchmark", "external-engagement", "skill", "auth", "trust", "cron",
  "sync", "target", "import-native", "uninstall", "tools", "tui",
] as const;

describe("CLI command registry", () => {
  it("is the single ordered owner of command discovery and resolution", () => {
    const ids = CLI_COMMANDS.map((command) => command.id);

    expect(ids).toEqual(EXPECTED_COMMAND_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of CLI_COMMANDS) {
      expect(resolveCliCommand(command.id)).toBe(command);
      expect(command.owner).toBe("cli");
      expect(typeof command.handler).toBe("function");
    }
    expect(resolveCliCommand("unknown-command")).toBeUndefined();
  });

  it("admits filesystem registry composition only for its declared consumers", () => {
    expect(
      CLI_COMMANDS
        .filter((command) => command.composition === "filesystem-domain-registry")
        .map((command) => command.id),
    ).toEqual(["run", "plan", "gui", "benchmark", "tui"]);
  });
});

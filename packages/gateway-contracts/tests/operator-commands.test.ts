import { describe, expect, it } from "vitest";
import { findOperatorCommand, listOperatorCommands } from "../src/operator-commands.js";
import type { OperatorCommandSurfaceKind } from "../src/operator-commands.js";

describe("operator command contract", () => {
  it("shares governed goal commands across CLI, GUI, and TUI surfaces", () => {
    expect(findOperatorCommand("/goal", "cli")?.id).toBe("goal");
    expect(findOperatorCommand("goal", "gui")?.id).toBe("goal");
    expect(findOperatorCommand("/goal", "tui")?.id).toBe("goal");
  });

  it("publishes plan and execution mode commands for interactive surfaces", () => {
    expect(findOperatorCommand("/plan", "tui")?.id).toBe("plan");
    expect(findOperatorCommand("/exec", "tui")?.id).toBe("exec");
    expect(findOperatorCommand("plan", "gui")?.id).toBe("plan");
    expect(findOperatorCommand("exec", "gui")?.id).toBe("exec");
  });

  it("uses continue as the visible continuation command across interactive surfaces", () => {
    expect(findOperatorCommand("/continue", "tui")?.id).toBe("continue");
    expect(findOperatorCommand("continue", "gui")?.id).toBe("continue");
    expect(listOperatorCommands("tui").map((command) => command.trigger)).not.toContain("resume");
    expect(listOperatorCommands("gui").map((command) => command.trigger)).not.toContain("resume");
  });

  it("publishes execution-target controls without route or provider command aliases", () => {
    expect(findOperatorCommand("/target", "tui")?.id).toBe("target");
    expect(findOperatorCommand("target", "gui")?.id).toBe("target");
    expect(findOperatorCommand("/route", "tui")).toBeUndefined();
    expect(findOperatorCommand("route", "gui")).toBeUndefined();
    expect(findOperatorCommand("/provider", "tui")).toBeUndefined();
    expect(findOperatorCommand("provider", "gui")).toBeUndefined();
  });

  it("publishes the shared settings foundation across operator surfaces", () => {
    expect(findOperatorCommand("settings", "cli")?.id).toBe("settings");
    expect(findOperatorCommand("settings", "gui")?.id).toBe("settings");
    expect(findOperatorCommand("/settings", "tui")?.id).toBe("settings");
  });

  it.each(["cli", "gui", "tui"] as const)("does not duplicate triggers on %s", (surface: OperatorCommandSurfaceKind) => {
    const triggers = listOperatorCommands(surface).map((command) => command.trigger);

    expect(new Set(triggers).size).toBe(triggers.length);
  });
});

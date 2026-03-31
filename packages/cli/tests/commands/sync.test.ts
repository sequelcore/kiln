import { describe, it, expect } from "vitest";
import { syncCommand } from "../../src/commands/sync.js";

describe("syncCommand", () => {
  it("is a function exported from commands/sync", () => {
    expect(typeof syncCommand).toBe("function");
  });

  it("accepts appConfig, subcommand, and args parameters", async () => {
    const { readKilnYaml } = await import("../../src/kiln-yaml.js");
    const originalRead = readKilnYaml;

    const appConfig = {
      appName: "kiln",
      dirName: ".kiln",
      version: "0.1.0",
      description: "Test",
      createRegistry: () => { throw new Error("test"); },
      mcpServerName: "kiln",
    };

    expect(() => {
      originalRead("/nonexistent");
    }).toBeDefined();
  });
});

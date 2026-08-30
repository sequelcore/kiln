import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../../src/config.js";

const mockGuiCommand = vi.hoisted(() => vi.fn());

vi.mock("../../src/commands/gui.js", () => ({
  guiCommand: mockGuiCommand,
}));

import { createCli } from "../../src/cli.js";

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be used in gui CLI parse tests");
  },
};

describe("gui CLI command wiring", () => {
  const originalArgv = process.argv;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let tmpConfigHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = [...originalArgv.slice(0, 2)];
    tmpConfigHome = mkdtempSync(join(tmpdir(), "kiln-gui-config-"));
    process.env.XDG_CONFIG_HOME = tmpConfigHome;
  });

  afterEach(() => {
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    rmSync(tmpConfigHome, { recursive: true, force: true });
  });

  it("passes GUI startup flags through createCli", async () => {
    process.argv = [
      originalArgv[0] ?? "bun",
      originalArgv[1] ?? "index.ts",
      "gui",
      "--theme", "automata",
      "--plan",
      "--cwd", "C:/repo",
      "--connect", "http://localhost:3800",
      "--port", "4901",
      "--gui-port", "5199",
      "--no-open",
      "--dev",
    ];

    await createCli(APP_CONFIG);

    expect(mockGuiCommand).toHaveBeenCalledWith(APP_CONFIG, {
      port: 4901,
      guiPort: 5199,
      mode: "dev",
      cwd: "C:/repo",
      connect: "http://localhost:3800",
      open: false,
      theme: "automata",
      plan: true,
    });
  }, 10_000);
});

import { describe, expect, it } from "vitest";
import { resolveCliMemoryStorage } from "../../src/application/cli-memory-storage.js";

describe("cli memory storage", () => {
  it("stores mutable CLI memory under Windows user app state keyed by project root", () => {
    const resolution = resolveCliMemoryStorage("C:\\Projects\\Example App", {
      platform: "win32",
      env: {
        LOCALAPPDATA: "C:\\Users\\ExampleUser\\AppData\\Local",
        USERPROFILE: "C:\\Users\\ExampleUser",
      },
    });

    expect(resolution.memoryDbPath).toMatch(/^C:\\Users\\ExampleUser\\AppData\\Local\\Kiln\\memory\\projects\\Example-App-[a-f0-9]{16}\\memory\.db$/u);
    expect(JSON.stringify(resolution)).not.toContain(".kiln");
  });

  it("honors XDG_STATE_HOME on Linux-like platforms", () => {
    const resolution = resolveCliMemoryStorage("/workspace/project", {
      platform: "linux",
      env: {
        XDG_STATE_HOME: "/home/test/.local/state",
        HOME: "/home/test",
      },
    });

    expect(resolution.memoryDbPath.replace(/\\/gu, "/")).toMatch(
      /^\/home\/test\/\.local\/state\/kiln\/memory\/projects\/project-[a-f0-9]{16}\/memory\.db$/u,
    );
  });

  it("honors KILN_STATE_HOME for isolated app-state roots", () => {
    const resolution = resolveCliMemoryStorage("C:\\repo", {
      platform: "win32",
      env: {
        KILN_STATE_HOME: "C:\\tmp\\kiln-state",
      },
    });

    expect(resolution.memoryDbPath).toMatch(/^C:\\tmp\\kiln-state\\kiln\\memory\\projects\\repo-[a-f0-9]{16}\\memory\.db$/u);
  });
});

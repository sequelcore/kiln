import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearToolEnvironmentCache,
  detectToolEnvironment,
  type ToolEnvironmentCommandExecutor,
} from "../../../src/tools/domain/tool-environment.js";

const TEST_TOOL_NAMES = ["rg", "fd", "jq", "git", "bash"] as const;

describe("detectToolEnvironment", () => {
  beforeEach(() => {
    clearToolEnvironmentCache();
  });

  it("returns an object with optional binary info fields", async () => {
    const environment = await detectToolEnvironment();

    expect(environment).toBeDefined();
    expect(typeof environment).toBe("object");

    for (const key of ["rg", "fd", "jq", "git", "bash"] as const) {
      const info = environment[key];
      if (info !== undefined) {
        expect(info).toHaveProperty("path");
        expect(info).toHaveProperty("version");
        expect(typeof info.path).toBe("string");
        expect(typeof info.version).toBe("string");
      }
    }
  });

  it("caches detected environments by default", async () => {
    const commandExecutor = makeToolEnvironmentExecutor();
    const first = await detectToolEnvironment({ commandExecutor });
    const callCountAfterFirstDetection = commandExecutor.mock.calls.length;
    const second = await detectToolEnvironment({ commandExecutor });

    expect(first).toBe(second);
    expect(commandExecutor).toHaveBeenCalled();
    expect(commandExecutor).toHaveBeenCalledTimes(callCountAfterFirstDetection);
  });

  it("returns fresh result after clearing cache", async () => {
    const commandExecutor = makeToolEnvironmentExecutor();
    const first = await detectToolEnvironment({ commandExecutor });
    clearToolEnvironmentCache();
    const second = await detectToolEnvironment({ commandExecutor });

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("accepts searchPaths option", async () => {
    const environment = await detectToolEnvironment({
      searchPaths: ["/nonexistent/path"],
    });

    expect(environment).toBeDefined();
  });

  it("skips located binaries that cannot launch from their exact path", async () => {
    const calls: string[] = [];
    const environment = await detectToolEnvironment({
      commandExecutor: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "where" || command === "which") {
          const name = args[0];
          if (name === "fd") {
            return { stdout: "C:\\broken\\fd.exe\nC:\\tools\\fd.exe\n" };
          }
          throw new Error(`${name} not found`);
        }
        if (command === "C:\\broken\\fd.exe") {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        if (command === "C:\\tools\\fd.exe") {
          return { stdout: "fd 10.4.2\n" };
        }
        throw new Error(`unexpected command ${command}`);
      },
    });

    expect(environment.fd).toEqual({
      path: "C:\\tools\\fd.exe",
      version: "fd 10.4.2",
    });
    expect(calls).toContain("C:\\broken\\fd.exe --version");
    expect(calls).toContain("C:\\tools\\fd.exe --version");
  });

  it("detects bash through exact executable validation", async () => {
    const calls: string[] = [];
    const environment = await detectToolEnvironment({
      commandExecutor: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "where" || command === "which") {
          const name = args[0];
          if (name === "bash") {
            return { stdout: "C:\\broken\\bash.exe\nC:\\Program Files\\Git\\bin\\bash.exe\n" };
          }
          throw new Error(`${name} not found`);
        }
        if (command === "C:\\broken\\bash.exe") {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        if (command === "C:\\Program Files\\Git\\bin\\bash.exe") {
          return { stdout: "GNU bash, version 5.2.37(1)-release\n" };
        }
        throw new Error(`unexpected command ${command}`);
      },
    });

    expect(environment.bash).toEqual({
      path: "C:\\Program Files\\Git\\bin\\bash.exe",
      version: "GNU bash, version 5.2.37(1)-release",
    });
    expect(calls).toContain("C:\\broken\\bash.exe --version");
    expect(calls).toContain("C:\\Program Files\\Git\\bin\\bash.exe --version");
  });
});

function makeToolEnvironmentExecutor(): ReturnType<typeof vi.fn<ToolEnvironmentCommandExecutor>> {
  return vi.fn(async (command, args) => {
    if (command === "where" || command === "which") {
      const name = args[0];
      if (TEST_TOOL_NAMES.some((toolName) => toolName === name)) {
        return { stdout: `/tools/${name}\n` };
      }
      throw new Error(`${name} not found`);
    }

    const name = command.split(/[\\/]/u).at(-1);
    if (TEST_TOOL_NAMES.some((toolName) => toolName === name)) {
      return { stdout: `${name} 1.0.0\n` };
    }

    throw new Error(`unexpected command ${command}`);
  });
}

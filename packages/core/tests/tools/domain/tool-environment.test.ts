import { beforeEach, describe, expect, it } from "vitest";
import {
  clearToolEnvironmentCache,
  detectToolEnvironment,
  type ToolEnvironment,
} from "../../../src/tools/domain/tool-environment.js";

describe("detectToolEnvironment", () => {
  beforeEach(() => {
    clearToolEnvironmentCache();
  });

  it("returns an object with optional binary info fields", async () => {
    const environment = await detectToolEnvironment();

    expect(environment).toBeDefined();
    expect(typeof environment).toBe("object");

    for (const key of ["rg", "fd", "jq", "git"] as const) {
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
    const first = await detectToolEnvironment();
    const second = await detectToolEnvironment();

    expect(first).toBe(second);
  });

  it("returns fresh result after clearing cache", async () => {
    const first = await detectToolEnvironment();
    clearToolEnvironmentCache();
    const second = await detectToolEnvironment();

    expect(first).toEqual(second);
    // Same shape, but not same reference after cache clear
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
});

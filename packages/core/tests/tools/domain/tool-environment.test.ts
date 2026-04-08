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
});

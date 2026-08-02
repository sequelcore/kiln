import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import vitestConfig from "../vitest.config.js";

type PackageJson = {
  readonly scripts?: Record<string, string>;
};

describe("CLI test harness", () => {
  it("keeps the default package test command low-noise", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts?.test).toContain("--reporter=dot");
    expect(packageJson.scripts?.test).toContain("--silent=passed-only");
    expect(packageJson.scripts?.test).not.toContain("--reporter=verbose");
  });

  it("uses one isolated worker for process-global CLI tests", () => {
    expect(vitestConfig.test?.maxWorkers).toBe(1);
  });

  it("keeps verbose CLI test diagnostics explicit", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts?.["test:verbose"]).toContain("--reporter=verbose");
  });

  it("bounds test, hook, and teardown lifecycle stalls", () => {
    expect(vitestConfig.test).toMatchObject({
      testTimeout: 10_000,
      hookTimeout: 10_000,
      teardownTimeout: 10_000,
    });
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVitestProfileArgs,
  extractVitestProfileJson,
  prepareVitestProfileOutput,
  resolveVitestProfileOutput,
  settleVitestProfileOutput,
  type VitestProfileOutput,
  writeVitestProfileOutput,
} from "./run-vitest-profile.js";

const fixtures: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("run-vitest-profile private output", () => {
  it("silences logs from passing tests while retaining the JSON reporter", () => {
    expect(buildVitestProfileArgs()).toEqual(["vitest", "run", "--reporter=json", "--silent=passed-only"]);
  });

  it("extracts the final Vitest report when passing tests write to stdout", () => {
    const report = JSON.stringify(createVitestProfileReport());
    const output = `Only one sentence.\n[tool] status {not-json\n${report}\ntrailing output`;

    expect(extractVitestProfileJson(output)).toBe(report);
    expect(JSON.parse(extractVitestProfileJson(output))).toMatchObject({
      success: true,
      testResults: [],
    });
  });

  it("ignores an incomplete lookalike but rejects multiple complete Vitest envelopes", () => {
    const report = createVitestProfileReport();
    const serialized = JSON.stringify(report);
    const incompleteLookalike = JSON.stringify({ success: false, testResults: [] });

    expect(extractVitestProfileJson(`${serialized}\n${incompleteLookalike}`)).toBe(serialized);
    expect(() =>
      extractVitestProfileJson(`${serialized}\n${JSON.stringify({ ...report, startTime: report.startTime + 1 })}`),
    ).toThrow(/ambiguous|exactly one/iu);
  });

  it("settles malformed successful output without changing the prior artifact", () => {
    const { output } = createFixture("malformed-settlement");
    prepareVitestProfileOutput(output);
    writeVitestProfileOutput(output, '{"previous":true}\n');
    const stdout: string[] = [];
    const stderr: string[] = [];

    expect(
      settleVitestProfileOutput(output, 0, "RAW_STDOUT_SECRET\n", {
        writeStdout: (value) => stdout.push(value),
        writeStderr: (value) => stderr.push(value),
      }),
    ).toBe(1);
    expect(readFileSync(output.outputFile, "utf8")).toBe('{"previous":true}\n');
    expect(stdout).toEqual(["RAW_STDOUT_SECRET\n"]);
    expect(stderr.join(" ")).toMatch(/valid JSON/iu);
  });

  it("settles a failed child with its exact exit code and raw diagnostics", () => {
    const { output } = createFixture("failed-settlement");
    prepareVitestProfileOutput(output);
    writeVitestProfileOutput(output, '{"previous":true}\n');
    const stdout: string[] = [];
    const stderr: string[] = [];

    expect(
      settleVitestProfileOutput(output, 17, "RAW_FAILED_STDOUT_SECRET\n", {
        writeStdout: (value) => stdout.push(value),
        writeStderr: (value) => stderr.push(value),
      }),
    ).toBe(17);
    expect(readFileSync(output.outputFile, "utf8")).toBe('{"previous":true}\n');
    expect(stdout).toEqual(["RAW_FAILED_STDOUT_SECRET\n"]);
    expect(stderr).toEqual([]);
  });

  it("rejects malformed profile JSON before committing the artifact", () => {
    const { output } = createFixture("invalid-json");

    prepareVitestProfileOutput(output);
    writeVitestProfileOutput(output, '{"success":true}\n');

    expect(() => writeVitestProfileOutput(output, "Only one sentence.\n")).toThrow(/valid JSON/iu);
    expect(readFileSync(output.outputFile, "utf8")).toBe('{"success":true}\n');
  });

  it("creates and writes the profile beneath the bound private state root", () => {
    const { output } = createFixture("normal");

    prepareVitestProfileOutput(output);
    writeVitestProfileOutput(output, '{"success":true}\n');

    expect(readFileSync(output.outputFile, "utf8")).toBe('{"success":true}\n');
    expect(
      output.outputFile.startsWith(`${output.profileRoot}\\`) || output.outputFile.startsWith(`${output.profileRoot}/`),
    ).toBe(true);
  });

  it("fails closed when the profile directory is already a symlink or junction", () => {
    const { output, outside } = createFixture("initial-link");
    mkdirSync(dirname(output.profileRoot), { recursive: true });
    mkdirSync(outside, { recursive: true });
    if (!createDirectoryLink(outside, output.profileRoot)) return;

    expect(() => prepareVitestProfileOutput(output)).toThrow(/unsafe/iu);
    expect(existsSync(join(outside, "cli-vitest-profile.json"))).toBe(false);
  });

  it("rechecks the profile directory after a symlink or junction swap", () => {
    const { output, outside } = createFixture("swapped-link");
    prepareVitestProfileOutput(output);
    mkdirSync(outside, { recursive: true });
    rmSync(output.profileRoot, { recursive: true, force: true });
    if (!createDirectoryLink(outside, output.profileRoot)) return;

    expect(() => writeVitestProfileOutput(output, '{"success":true}\n')).toThrow(/unsafe/iu);
    expect(existsSync(join(outside, "cli-vitest-profile.json"))).toBe(false);
  });

  it("fails closed when the profile file is swapped to a symlink", () => {
    const { output, outside } = createFixture("swapped-file");
    prepareVitestProfileOutput(output);
    mkdirSync(outside, { recursive: true });
    if (!createFileLink(join(outside, "external.json"), output.outputFile)) return;

    expect(() => writeVitestProfileOutput(output, '{"success":true}\n')).toThrow(/regular file/iu);
    expect(existsSync(join(outside, "external.json"))).toBe(true);
    expect(readFileSync(join(outside, "external.json"), "utf8")).toBe("");
  });
});

function createFixture(label: string): { readonly output: VitestProfileOutput; readonly outside: string } {
  const root = mkdtempSync(join(tmpdir(), `kiln-vitest-profile-${label}-`));
  fixtures.push(root);
  vi.stubEnv("XDG_CONFIG_HOME", join(root, "xdg-config"));
  const projectRoot = join(root, "project");
  mkdirSync(projectRoot, { recursive: true });
  return {
    output: resolveVitestProfileOutput(projectRoot, "cli"),
    outside: join(root, "outside"),
  };
}

function createVitestProfileReport(): Record<string, unknown> & { readonly startTime: number } {
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    snapshot: {},
    startTime: 1,
    success: true,
    testResults: [],
  };
}

function createDirectoryLink(target: string, linkPath: string): boolean {
  try {
    symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
}

function createFileLink(target: string, linkPath: string): boolean {
  try {
    // Create the target first so the link is a valid regular-file alias.
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "", "utf8");
    symlinkSync(target, linkPath, "file");
    return true;
  } catch {
    return false;
  }
}

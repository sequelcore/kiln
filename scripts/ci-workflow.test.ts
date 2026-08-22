import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(import.meta.dirname, "..", ".github", "workflows", "ci.yml");

function workflowSource(): string {
  return readFileSync(WORKFLOW_PATH, "utf8").replaceAll("\r\n", "\n");
}

describe("CI workflow contract", () => {
  it("runs the complete CI workflow for main and dev push/PR events", () => {
    const source = workflowSource();

    expect(source).toContain(
      [
        "on:",
        "  push:",
        "    branches: [main, dev]",
        "  pull_request:",
        "    branches: [main, dev, codex/cross-harness-gateway]",
      ].join("\n"),
    );
  });

  it("preserves every lane, per-ref cancellation, and the fail-closed aggregate check", () => {
    const source = workflowSource();
    const jobsSection = source.slice(source.indexOf("\njobs:"));
    const jobNames = jobsSection
      .split("\n")
      .filter((line) => line.startsWith("  ") && !line.startsWith("   ") && line.trimEnd().endsWith(":"))
      .map((line) => line.trim().slice(0, -1));

    expect(jobNames).toEqual(["compile", "validate", "test", "startup_profile", "build", "check"]);
    expect(source).toContain("lane: [scripts, foundation, runtime, cli, surfaces]");
    expect(source).toContain(["group: ci-${", "{ github.workflow }}-${", "{ github.ref }}"].join(""));
    expect(source).toContain("cancel-in-progress: true");
    expect(source).toContain(
      ["check:", "    if: ${" + "{ always() }}", "    needs: [compile, validate, test, startup_profile, build]"].join(
        "\n",
      ),
    );
    expect(source).toMatch(
      /needs\.compile\.result != 'success'.*needs\.validate\.result != 'success'.*needs\.test\.result != 'success'.*needs\.startup_profile\.result != 'success'.*needs\.build\.result != 'success'/su,
    );
  });
});

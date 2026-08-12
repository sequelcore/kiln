import { describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../../src/commands/doctor.js";
import type { KilnAppConfig } from "../../src/config.js";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Kiln AI orchestration engine",
  createRegistry: () => {
    throw new Error("createRegistry not called in doctor tests");
  },
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

describe("doctorCommand", () => {
  it("prints bounded skill issues and omitted counts in deterministic human diagnostics", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const missingDiscovery = { models: [], status: "cli_missing" as const, reason: "CLI missing.", authState: "not_required" as const };
    await doctorCommand(MOCK_APP_CONFIG, {
      json: false, projectRoot: "C:\\repo", env: { USERPROFILE: "C:\\Users\\ExampleUser", PATH: "" },
      fileExists: () => false, runVersion: vi.fn(async () => undefined),
      readConfigStatus: vi.fn(async () => ({ projections: [], skills: {
        complete: false, equivalentDuplicates: 0, divergentCollisions: 0, caseCollisions: 0,
        issueCount: 4, omittedIssueCount: 2,
        issues: [
          { skillName: "planner", kind: "capability", harness: "opencode", projectionState: "missing", path: "C:\\skills\\planner\\SKILL.md" },
          { skillName: "alpha", kind: "drifted", harness: "codex", projectionState: "drifted", path: "C:\\skills\\alpha\\SKILL.md" },
        ],
        harnesses: [],
      } })),
      discoverModels: vi.fn(async () => ({
        claudeModels: [], claudeDiscovery: missingDiscovery, codexModels: [], codexDiscovery: missingDiscovery,
        opencodeModels: [], opencodeDiscovery: missingDiscovery,
      })),
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });
    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output.indexOf("skill=alpha")).toBeLessThan(output.indexOf("skill=planner"));
    expect(output).toContain("issue: skill=alpha, harness=codex, kind=drifted, status=drifted, path=C:\\skills\\alpha\\SKILL.md");
    expect(output).toContain("issue: skill=planner, harness=opencode, kind=capability, status=missing, path=C:\\skills\\planner\\SKILL.md");
    expect(output).toContain("... 2 more skill issues omitted (4 total)");
    consoleSpy.mockRestore();
  });

  it("prints json diagnostics when requested", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await doctorCommand(MOCK_APP_CONFIG, {
      json: true,
      projectRoot: "C:\\repo",
      env: { USERPROFILE: "C:\\Users\\ExampleUser", PATH: "" },
      fileExists: () => false,
      runVersion: vi.fn(async () => undefined),
      readConfigProjections: vi.fn(async () => []),
      discoverModels: vi.fn(async () => ({
        claudeModels: [],
        claudeDiscovery: {
          models: [],
          status: "cli_missing",
          reason: "Claude Code executable was not found.",
          authState: "not_required",
        },
        codexModels: [],
        codexDiscovery: {
          models: [],
          status: "cli_missing",
          reason: "Codex CLI executable was not found.",
          authState: "not_required",
        },
        opencodeModels: [],
        opencodeDiscovery: {
          models: [],
          status: "cli_missing",
          reason: "OpenCode CLI executable was not found.",
          authState: "not_required",
        },
      })),
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });

    const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string) as {
      readonly mode: string;
      readonly projectRoot: string;
      readonly harnesses: { readonly codex: { readonly discoveryStatus: string } };
    };
    expect(parsed).toMatchObject({
      mode: "read-only",
      projectRoot: "C:\\repo",
      harnesses: {
        codex: {
          discoveryStatus: "cli_missing",
        },
      },
    });

    consoleSpy.mockRestore();
  });

  it("prints skill catalog health in json diagnostics", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await doctorCommand(MOCK_APP_CONFIG, {
      json: true,
      projectRoot: "C:\\repo",
      env: { USERPROFILE: "C:\\Users\\ExampleUser", PATH: "" },
      fileExists: () => false,
      runVersion: vi.fn(async () => undefined),
      readConfigStatus: vi.fn(async () => ({
        projections: [],
        skills: {
          complete: false,
          equivalentDuplicates: 2,
          issues: [],
          divergentCollisions: 1,
          caseCollisions: 0,
          issueCount: 0,
          omittedIssueCount: 0,
          harnesses: [{ harness: "codex", candidateCount: 3, descriptionBytes: 42, budget: { status: "unknown", reason: "No authority." } }],
        },
      })),
      discoverModels: vi.fn(async () => ({
        claudeModels: [],
        claudeDiscovery: {
          models: [],
          status: "cli_missing",
          reason: "Claude Code executable was not found.",
          authState: "not_required",
        },
        codexModels: [],
        codexDiscovery: {
          models: [],
          status: "cli_missing",
          reason: "Codex CLI executable was not found.",
          authState: "not_required",
        },
        opencodeModels: [],
        opencodeDiscovery: {
          models: [],
          status: "cli_missing",
          reason: "OpenCode CLI executable was not found.",
          authState: "not_required",
        },
      })),
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });

    const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string) as {
      readonly skills?: {
        readonly complete: boolean;
        readonly equivalentDuplicates: number;
        readonly harnesses: readonly { readonly harness: string; readonly candidateCount: number }[];
      };
    };
    expect(parsed.skills).toMatchObject({
      complete: false,
      equivalentDuplicates: 2,
      issues: [],
      issueCount: 0,
      omittedIssueCount: 0,
      harnesses: [{ harness: "codex", candidateCount: 3 }],
    });

    consoleSpy.mockRestore();
  });
});

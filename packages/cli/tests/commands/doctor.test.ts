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
          entries: [{
            name: "project-ui",
            description: "Project UI workflow.",
            origin: "project",
            configured: true,
            builtIn: false,
            sourcePath: "C:\\repo\\.kiln\\skills\\project-ui\\SKILL.md",
            projections: [{
              target: "codex",
              displayName: "Codex",
              path: "C:\\Users\\ExampleUser\\.codex\\skills\\project-ui\\SKILL.md",
              status: "missing",
            }],
            admission: {
              state: "available",
              reason: "Configured Kiln skill.",
            },
          }],
        },
      })),
      discoverModels: vi.fn(async () => ({
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
        readonly entries: readonly {
          readonly name: string;
          readonly origin: string;
          readonly projections: readonly { readonly status: string }[];
        }[];
      };
    };
    expect(parsed.skills?.entries).toEqual([
      expect.objectContaining({
        name: "project-ui",
        origin: "project",
        projections: [expect.objectContaining({ status: "missing" })],
      }),
    ]);

    consoleSpy.mockRestore();
  });
});

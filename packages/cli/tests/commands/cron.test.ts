import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";

vi.mock("@kilnai/runtime", () => ({
  Scheduler: class MockScheduler {
    private _entries: Array<{ trigger: { name: string; cron: string; timezone?: string; enabled?: boolean }; nextFireAt: Date; timer: null }> = [];
    constructor(_config: { appName: string; eventBus: unknown }) {}
    register(trigger: { name: string; cron: string; timezone?: string; enabled?: boolean; type?: string }) {
      if (trigger.enabled === false) return;
      this._entries.push({ trigger, nextFireAt: new Date(Date.now() + 86400000), timer: null });
    }
    list() {
      return this._entries.map((e) => ({ ...e }));
    }
    remove(name: string) {
      const idx = this._entries.findIndex((e) => e.trigger.name === name);
      if (idx === -1) return false;
      this._entries.splice(idx, 1);
      return true;
    }
    start() {}
    stop() {}
    async fire(name: string) {
      const found = this._entries.some((e) => e.trigger.name === name);
      return found;
    }
  },
  EventBus: class MockEventBus {
    emit() {}
    on() {}
    off() {}
  },
}));

import { cronCommand } from "../../src/commands/cron.js";
import type { KilnAppConfig } from "../../src/config.js";
import { DomainRegistry } from "@kilnai/core/domain";

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () => new DomainRegistry(),
  buildSystemPrompt: () => "",
};

interface RawAppYaml {
  name?: string;
  triggers?: unknown[];
  [key: string]: unknown;
}

function writeAppYaml(dir: string, yamlContent: string): void {
  mkdirSync(join(dir, ".kiln"), { recursive: true });
  writeFileSync(join(dir, ".kiln", "app.yaml"), yamlContent);
}

function readAppYaml(dir: string): RawAppYaml {
  return parse(readFileSync(join(dir, ".kiln", "app.yaml"), "utf-8")) as RawAppYaml;
}

const BASE_APP_YAML = `name: test-app
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: main
teams:
  main:
    agents:
      worker:
        name: Worker
        role: Generalist
        goal: Execute tasks
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;

describe("cronCommand", () => {
  let tempDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-cron-"));
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit called");
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("list", () => {
    it("prints 'No schedules configured' when no triggers", async () => {
      writeAppYaml(tempDir, BASE_APP_YAML);
      await cronCommand(MOCK_APP_CONFIG, tempDir, ["list"]);
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("No schedules configured.");
    });

    it("prints error when app.yaml does not exist", async () => {
      mkdirSync(join(tempDir, ".kiln"), { recursive: true });
      await cronCommand(MOCK_APP_CONFIG, tempDir, ["list"]);
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("No app.yaml found");
    });

    it("lists schedules with name, cron, timezone, next run, and enabled", async () => {
      writeAppYaml(tempDir, `${BASE_APP_YAML}\ntriggers:
  - name: nightly-audit
    type: schedule
    team: main
    cron: "0 2 * * *"
    timezone: UTC
    task: Run audit
`);
      await cronCommand(MOCK_APP_CONFIG, tempDir, ["list"]);
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("nightly-audit");
      expect(output).toContain("0 2 * * *");
      expect(output).toContain("UTC");
    });
  });

  describe("add", () => {
    it("writes new schedule to app.yaml", async () => {
      writeAppYaml(tempDir, `${BASE_APP_YAML}\ntriggers: []\n`);
      await cronCommand(MOCK_APP_CONFIG, tempDir, [
        "add",
        "nightly-audit",
        "0 2 * * *",
        "Run audit check",
        "--timezone",
        "UTC",
      ]);
      const app = readAppYaml(tempDir);
      expect(app.triggers).toHaveLength(1);
      const trigger = app.triggers![0] as Record<string, unknown>;
      expect(trigger.name).toBe("nightly-audit");
      expect(trigger.cron).toBe("0 2 * * *");
      expect(trigger.task).toBe("Run audit check");
      expect(trigger.type).toBe("schedule");
    });

    it("rejects invalid cron expression", async () => {
      writeAppYaml(tempDir, `${BASE_APP_YAML}\ntriggers: []\n`);
      await expect(
        cronCommand(MOCK_APP_CONFIG, tempDir, ["add", "bad-schedule", "not-a-cron", "Do something"]),
      ).rejects.toThrow("exit called");
      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Invalid cron expression");
    });

    it("rejects duplicate schedule name", async () => {
      writeAppYaml(
        tempDir,
        `${BASE_APP_YAML}\ntriggers:
  - name: existing
    type: schedule
    team: main
    cron: "0 2 * * *"
`,
      );
      await expect(
        cronCommand(MOCK_APP_CONFIG, tempDir, [
          "add",
          "existing",
          "0 3 * * *",
          "Another task",
        ]),
      ).rejects.toThrow("exit called");
      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("already exists");
    });

    it("validates name format (no spaces)", async () => {
      writeAppYaml(tempDir, `${BASE_APP_YAML}\ntriggers: []\n`);
      await expect(
        cronCommand(MOCK_APP_CONFIG, tempDir, [
          "add",
          "invalid name",
          "0 2 * * *",
          "Task",
        ]),
      ).rejects.toThrow("exit called");
      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Invalid schedule name");
    });
  });

  describe("remove", () => {
    it("removes schedule from app.yaml", async () => {
      writeAppYaml(
        tempDir,
        `${BASE_APP_YAML}\ntriggers:
  - name: to-remove
    type: schedule
    team: main
    cron: "0 2 * * *"
  - name: to-keep
    type: schedule
    team: main
    cron: "0 3 * * *"
`,
      );
      await cronCommand(MOCK_APP_CONFIG, tempDir, ["remove", "to-remove"]);
      const app = readAppYaml(tempDir);
      expect(app.triggers).toHaveLength(1);
      const trigger = app.triggers![0] as Record<string, unknown>;
      expect(trigger.name).toBe("to-keep");
    });

    it("exits with error for unknown name", async () => {
      writeAppYaml(tempDir, `${BASE_APP_YAML}\ntriggers: []\n`);
      await expect(
        cronCommand(MOCK_APP_CONFIG, tempDir, ["remove", "nonexistent"]),
      ).rejects.toThrow("exit called");
      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("No schedule named 'nonexistent' found");
    });
  });

  describe("run", () => {
    it("fires a registered schedule", async () => {
      writeAppYaml(
        tempDir,
        `${BASE_APP_YAML}\ntriggers:
  - name: my-job
    type: schedule
    team: main
    cron: "0 2 * * *"
    task: Run this job
`,
      );
      await cronCommand(MOCK_APP_CONFIG, tempDir, ["run", "my-job"]);
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Fired 'my-job'");
    });

    it("exits with error for unknown schedule", async () => {
      writeAppYaml(
        tempDir,
        `${BASE_APP_YAML}\ntriggers:
  - name: other
    type: schedule
    team: main
    cron: "0 2 * * *"
`,
      );
      await expect(
        cronCommand(MOCK_APP_CONFIG, tempDir, ["run", "unknown"]),
      ).rejects.toThrow("exit called");
      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("No schedule named 'unknown' found");
    });
  });

  describe("help/default", () => {
    it("prints help for unknown subcommand", async () => {
      writeAppYaml(tempDir, BASE_APP_YAML);
      await cronCommand(MOCK_APP_CONFIG, tempDir, ["unknown"]);
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("kiln cron <subcommand>");
      expect(output).toContain("list");
      expect(output).toContain("add");
      expect(output).toContain("remove");
      expect(output).toContain("run");
    });

    it("prints help when no subcommand given", async () => {
      writeAppYaml(tempDir, BASE_APP_YAML);
      await cronCommand(MOCK_APP_CONFIG, tempDir, []);
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("kiln cron <subcommand>");
    });
  });
});

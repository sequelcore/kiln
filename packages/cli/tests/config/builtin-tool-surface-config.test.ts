import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultBuiltinToolSurface } from "@kilnai/core/tools";
import { describe, expect, it, vi } from "vitest";
import {
  loadConfiguredBuiltinToolSurfaceOptions,
  withProgressiveRuntimeToolProjection,
} from "../../src/config/builtin-tool-surface-config.js";
import type { KilnAppConfig } from "../../src/config.js";

vi.mock("@kilnai/runtime", () => ({
  PlaywrightBrowserCaptureRecorder: class MockPlaywrightBrowserCaptureRecorder {
    constructor(readonly options?: unknown) {}
  },
  PlaywrightBrowserUseProvider: class MockPlaywrightBrowserUseProvider {
    constructor(readonly options?: unknown) {}
    execute() {
      return undefined;
    }
  },
}));

describe("builtin tool surface config", () => {
  it("shares the same artifact store between browser tools and the Playwright recorder", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-builtin-recorder-"));
    try {
      const appConfig: KilnAppConfig = {
        createRegistry: () => ({} as never),
        kilnYaml: {
          version: "1",
          interactiveUse: {
            enabled: true,
            browserProvider: "playwright",
            allowedDomains: ["example.com"],
          },
        },
      };

      const options = await loadConfiguredBuiltinToolSurfaceOptions(appConfig, projectPath);
      const provider = options.browserUse?.provider as {
        readonly options?: {
          readonly captureRecorder?: {
            readonly options?: {
              readonly artifactStore?: unknown;
            };
          };
        };
      };

      expect(options.artifactResources?.store).toBeDefined();
      expect(provider.options?.captureRecorder?.options?.artifactStore)
        .toBe(options.artifactResources?.store);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("registers external engagement artifacts as shared read-only resources", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-builtin-tool-surface-"));
    try {
      mkdirSync(join(projectPath, ".kiln", "external-engagement"), { recursive: true });
      writeFileSync(join(projectPath, ".kiln", "external-engagement", "feature-intake.json"), JSON.stringify({
        reportId: "intake-report-1",
        generatedAt: "2026-06-24T00:00:00.000Z",
        sourceDecisionReportId: "decision-report-1",
        proposals: [],
      }), "utf-8");

      const options = await loadConfiguredBuiltinToolSurfaceOptions(appConfig(), projectPath);
      const surface = createDefaultBuiltinToolSurface(options);
      const resourceUris = surface.resources.list().map((resource) => resource.uri);
      const result = await surface.resources.read("kiln://external-engagement/artifacts/feature-intake.json");

      expect(resourceUris).toContain("kiln://external-engagement/artifacts");
      expect(resourceUris).toContain("kiln://external-engagement/artifacts/feature-intake.json");
      const content = result.contents[0];
      expect(JSON.parse(content && "text" in content ? content.text : "{}")).toMatchObject({
        reportId: "intake-report-1",
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("projects read-only runtime tools without admitting mutating capabilities", () => {
    const surface = createDefaultBuiltinToolSurface(withProgressiveRuntimeToolProjection({
      toolProjection: {
        mode: "deferred",
        alwaysOnTools: ["monitor_list"],
      },
      additionalTools: [
        {
          name: "work_item.update",
          description: "Update governed work item.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => ({ output: "updated", isError: false }),
        },
        {
          name: "kiln_config.apply_change",
          description: "Apply config change.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => ({ output: "applied", isError: false }),
        },
      ],
    }, "read-only"));

    expect(surface.toolNames).toContain("tool_catalog_search");
    expect(surface.toolNames).toContain("read");
    expect(surface.toolNames).toContain("web_search");
    expect(surface.toolNames).toContain("monitor_list");
    expect(surface.toolNames).not.toContain("write");
    expect(surface.toolNames).not.toContain("work_item.update");
    expect(surface.toolNames).not.toContain("kiln_config.apply_change");
    expect(surface.toolNames).not.toContain("browser_session_start");
    expect(surface.registry.has("kiln_config.apply_change")).toBe(true);
    expect(surface.registry.has("browser_session_start")).toBe(true);
    expect(surface.bridge.listTools().map((tool) => tool.name)).toContain("browser_session_start");
  });

  it("projects execution tools while deferring specialized capabilities", () => {
    const surface = createDefaultBuiltinToolSurface(withProgressiveRuntimeToolProjection({
      additionalTools: [
        {
          name: "work_item.update",
          description: "Update governed work item.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => ({ output: "updated", isError: false }),
        },
        {
          name: "goal.evidence.record",
          description: "Record goal evidence.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => ({ output: "recorded", isError: false }),
        },
        {
          name: "goal.complete",
          description: "Complete a goal.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => ({ output: "completed", isError: false }),
        },
      ],
    }, "execute"));

    expect(surface.toolNames).toContain("tool_catalog_search");
    expect(surface.toolNames).toContain("read");
    expect(surface.toolNames).toContain("write");
    expect(surface.toolNames).toContain("web_search");
    expect(surface.toolNames).toContain("work_item.update");
    expect(surface.toolNames).toContain("goal.evidence.record");
    expect(surface.toolNames).toContain("goal.complete");
    expect(surface.toolNames).not.toContain("browser_session_start");
    expect(surface.registry.has("browser_session_start")).toBe(true);
  });
});

function appConfig(): KilnAppConfig {
  return {
    createRegistry: () => {
      throw new Error("createRegistry should not be used");
    },
    kilnYaml: { version: "1" },
  };
}

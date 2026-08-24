import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultBuiltinToolSurface } from "@kilnai/core/tools";
import { describe, expect, it, vi } from "vitest";
import {
  createConfiguredInvocationAdmission,
  loadConfiguredBuiltinToolSurfaceOptions,
  observeFormalVerificationCapability,
  withProgressiveRuntimeToolProjection,
} from "../../src/config/builtin-tool-surface-config.js";
import type { KilnAppConfig } from "../../src/config.js";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

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
  it("derives bounded-work capability from the validated tool registration", () => {
    expect(observeFormalVerificationCapability({})).toEqual({
      metric: "formal_verification",
      status: "unavailable",
    });
    expect(observeFormalVerificationCapability({
      formalVerify: { executable: "dafny", verifierVersion: "4.11.0" },
    })).toEqual({
      metric: "formal_verification",
      status: "available",
    });
  });

  it("registers configured formal verification while keeping it deferred", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-formal-surface-"));
    try {
      const globalConfig: KilnGlobalConfig = {
        version: "4",
        verification: {
          formal: {
            dafny: {
              executable: "C:/tools/dafny.exe",
              expectedVersion: "4.11.0",
            },
          },
        },
      };
      const options = await loadConfiguredBuiltinToolSurfaceOptions(appConfig(), projectPath, {
        globalConfig,
        runDafnyVersion: () => "Dafny 4.11.0+build.123",
        platform: "win32",
        discoveredPaths: [],
      });
      const projected = withProgressiveRuntimeToolProjection(options, "execute");
      const surface = createDefaultBuiltinToolSurface(projected);

      expect(options.formalVerify).toEqual({
        executable: "C:/tools/dafny.exe",
        verifierVersion: "4.11.0",
      });
      expect(projected.toolProjection?.alwaysOnTools).not.toContain("formal_verify");
      expect(surface.registry.has("formal_verify")).toBe(true);
      expect(surface.toolNames).not.toContain("formal_verify");
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

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
      vi.stubEnv("XDG_CONFIG_HOME", join(projectPath, "xdg"));
      const artifactRoot = join(resolveProjectStateBinding(projectPath).evidencePath, "external-engagement");
      mkdirSync(artifactRoot, { recursive: true });
      writeFileSync(join(artifactRoot, "feature-intake.json"), JSON.stringify({
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
      vi.unstubAllEnvs();
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

  it("adapts canonical tool and concrete input permissions into Core admission", () => {
    const admission = createConfiguredInvocationAdmission({
      approval: "never",
      tools: [{ tool: "WebFetch", action: "deny" }],
      commands: [{ pattern: "rm *", action: "deny" }],
      fileGovernance: { denyGlobs: ["**/.env"] },
      dataFirewall: [{ destination: "external-mcp", action: "deny" }],
    });
    const effect = {
      operation: "observe" as const,
      boundaries: ["process"] as const,
      reversibility: "reversible" as const,
      dataEgress: "none" as const,
      identityUse: "none" as const,
      consequences: [] as const,
      idempotency: "idempotent" as const,
    };

    expect(admission.authorize({ toolName: "web_fetch", toolInput: {}, resolvedEffect: effect }).allowed).toBe(false);
    expect(admission.authorize({ toolName: "bash", toolInput: { command: "rm file" }, resolvedEffect: effect }).allowed).toBe(false);
    expect(admission.authorize({ toolName: "read", toolInput: { path: "secrets/.env" }, resolvedEffect: effect }).allowed).toBe(false);
    expect(admission.authorize({
      toolName: "mcp",
      toolInput: { destination: "external-mcp" },
      resolvedEffect: { ...effect, dataEgress: "project-data" },
    }).allowed).toBe(false);
    expect(admission.authorize({
      toolName: "custom_fetch",
      toolInput: { url: "https://unknown.example" },
      resolvedEffect: { ...effect, dataEgress: "project-data" },
    }).allowed).toBe(false);
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

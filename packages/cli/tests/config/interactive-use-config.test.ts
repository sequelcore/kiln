import { describe, expect, it, vi } from "vitest";
import { mergeKilnYaml, type ResolvedKilnConfig } from "../../src/kiln-yaml.js";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import {
  createInteractiveUseToolSurfaceOptions,
  describeInteractiveUseConfiguration,
} from "../../src/config/interactive-use-config.js";

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
  WindowsComputerUseProvider: class MockWindowsComputerUseProvider {
    constructor(readonly options?: unknown) {}
    execute() {
      return undefined;
    }
  },
  WindowsUiaComputerUseProvider: class MockWindowsUiaComputerUseProvider {
    constructor(readonly options?: unknown) {}
    execute() {
      return undefined;
    }
  },
}));

function config(interactiveUse: ResolvedKilnConfig["interactiveUse"]): ResolvedKilnConfig {
  return {
    version: "1",
    interactiveUse,
  };
}

describe("interactive use config", () => {
  it("keeps browser and computer use fail-closed when not enabled", () => {
    expect(describeInteractiveUseConfiguration(config(undefined))).toEqual({
      enabled: false,
      allowedDomains: [],
      allowedApplications: [],
      applicationAliases: {},
      allowExternalBrowser: false,
      allowComputer: false,
      browserEnvironment: "isolated-headless",
      computerEnvironment: "local-active-desktop",
      browserProviderType: "none",
      browserProviderConfigured: false,
      computerProviderType: "none",
      computerProviderConfigured: false,
      issues: ["interactive_use.disabled"],
    });
  });

  it("reports project-scoped browser and computer authority without executing automation", () => {
    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      browserProvider: "playwright",
      computerProvider: "windows",
      allowedDomains: ["app.example.com", "docs.example.com"],
      allowComputer: true,
      allowedApplications: ["Calculator", "Chrome"],
      applicationAliases: {
        Calculator: ["Calculadora", "CalculatorApp"],
      },
      browserEnvironment: "isolated-headless",
      computerEnvironment: "local-active-desktop",
    }))).toEqual({
      enabled: true,
      allowedDomains: ["app.example.com", "docs.example.com"],
      allowedApplications: ["Calculator", "Chrome"],
      applicationAliases: {
        Calculator: ["Calculadora", "CalculatorApp"],
      },
      allowExternalBrowser: false,
      allowComputer: true,
      browserEnvironment: "isolated-headless",
      computerEnvironment: "local-active-desktop",
      browserProviderType: "playwright",
      browserProviderConfigured: true,
      computerProviderType: "windows",
      computerProviderConfigured: true,
      issues: [],
    });
  });

  it("creates Windows UIA computer tool options when explicitly configured", async () => {
    const options = await createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      computerProvider: "windows-uia",
      allowComputer: true,
      allowedApplications: ["Calculator"],
      applicationAliases: {
        Calculator: ["Calculadora", "CalculatorApp"],
      },
    }));

    expect(options.computerUse?.provider).toEqual(expect.objectContaining({
      execute: expect.any(Function),
      options: expect.objectContaining({
        applicationAliases: {
          Calculator: ["Calculadora", "CalculatorApp"],
        },
      }),
    }));
    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      computerProvider: "windows-uia",
      allowComputer: true,
      allowedApplications: ["Calculator"],
      applicationAliases: {
        Calculator: ["Calculadora", "CalculatorApp"],
      },
    }))).toMatchObject({
      applicationAliases: {
        Calculator: ["Calculadora", "CalculatorApp"],
      },
      computerProviderType: "windows-uia",
      computerProviderConfigured: true,
      issues: [],
    });
  });

  it("requires explicit browser domain or external-browser authority", () => {
    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      browserProvider: "playwright",
    })).issues).toEqual(["interactive_use.browser_domain_policy_missing"]);

    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      browserProvider: "playwright",
      browserEnvironment: "isolated-headless",
      allowExternalBrowser: true,
    })).issues).toEqual([]);
  });

  it("projects browser environment into the Playwright provider options", async () => {
    const options = await createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      browserProvider: "playwright",
      browserEnvironment: "isolated-headed",
      allowedDomains: ["app.example.com"],
    }));

    expect(options.browserUse?.provider).toEqual(expect.objectContaining({
      options: expect.objectContaining({
        headless: false,
        allowHeaded: true,
      }),
    }));
  });

  it("wires Playwright recorder capture to the shared artifact store when available", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const options = await createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      browserProvider: "playwright",
      browserEnvironment: "isolated-headed",
      allowedDomains: ["app.example.com"],
    }), { artifactStore });

    expect(options.artifactResources?.store).toBe(artifactStore);
    expect(options.browserUse?.provider).toEqual(expect.objectContaining({
      options: expect.objectContaining({
        captureRecorder: expect.objectContaining({
          options: expect.objectContaining({
            artifactStore,
          }),
        }),
      }),
    }));
  });

  it("reports invalid interactive environments before runtime execution", () => {
    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      browserProvider: "playwright",
      browserEnvironment: "shared-user-profile" as never,
      allowedDomains: ["app.example.com"],
      computerProvider: "windows-uia",
      computerEnvironment: "background-desktop" as never,
      allowComputer: true,
      allowedApplications: ["Calculator"],
    })).issues).toEqual([
      "interactive_use.browser_environment_invalid",
      "interactive_use.computer_environment_invalid",
    ]);
  });

  it("reports provider values that do not belong to the configured target", () => {
    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      browserProvider: "windows" as never,
    })).issues).toEqual([
      "interactive_use.browser_provider_invalid",
      "interactive_use.provider_missing",
    ]);

    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      computerProvider: "playwright" as never,
    })).issues).toEqual([
      "interactive_use.computer_provider_invalid",
      "interactive_use.provider_missing",
    ]);
  });

  it("rejects invalid provider values when building runtime providers", async () => {
    await expect(createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      browserProvider: "windows" as never,
    }))).rejects.toThrow("Invalid interactiveUse.browserProvider");

    await expect(createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      computerProvider: "playwright" as never,
    }))).rejects.toThrow("Invalid interactiveUse.computerProvider");
  });

  it("rejects invalid interactive environments when building runtime providers", async () => {
    await expect(createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      browserProvider: "playwright",
      browserEnvironment: "shared-user-profile" as never,
      allowedDomains: ["app.example.com"],
    }))).rejects.toThrow("Invalid interactiveUse.browserEnvironment");

    await expect(createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      computerProvider: "windows-uia",
      computerEnvironment: "background-desktop" as never,
      allowComputer: true,
      allowedApplications: ["Calculator"],
    }))).rejects.toThrow("Invalid interactiveUse.computerEnvironment");
  });

  it("requires explicit application scope for computer control", () => {
    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      computerProvider: "windows",
      allowComputer: true,
    })).issues).toEqual(["interactive_use.computer_application_policy_missing"]);

    expect(describeInteractiveUseConfiguration(config({
      enabled: true,
      computerProvider: "windows",
      allowComputer: false,
    })).issues).toEqual(["interactive_use.computer_not_allowed"]);
  });

  it("creates Playwright browser tool options only when interactive use is enabled", async () => {
    await expect(createInteractiveUseToolSurfaceOptions(config(undefined))).resolves.toEqual({});

    const options = await createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      browserProvider: "playwright",
      allowedDomains: ["app.example.com"],
    }));

    expect(options.browserUse?.provider).toEqual(expect.objectContaining({
      execute: expect.any(Function),
    }));
    expect(options.computerUse).toBeUndefined();
  });

  it("creates Windows computer tool options only when explicitly configured", async () => {
    const options = await createInteractiveUseToolSurfaceOptions(config({
      enabled: true,
      computerProvider: "windows",
      allowComputer: true,
      allowedApplications: ["Calculator"],
    }));

    expect(options.computerUse?.provider).toEqual(expect.objectContaining({
      execute: expect.any(Function),
    }));
    expect(options.browserUse).toBeUndefined();
  });

  it("merges interactive use config without treating it as global web authority", () => {
    const merged = mergeKilnYaml(
      config({
        enabled: false,
        allowedDomains: ["base.example.com"],
        allowedApplications: ["Calculator"],
        applicationAliases: {
          Calculator: ["Calculadora"],
        },
        browserEnvironment: "isolated-headless",
        computerEnvironment: "local-active-desktop",
      }),
      {
        interactiveUse: {
          enabled: true,
          browserProvider: "playwright",
          allowedDomains: ["override.example.com"],
        },
      },
    );

    expect(merged.interactiveUse).toEqual({
      enabled: true,
      browserProvider: "playwright",
      browserEnvironment: "isolated-headless",
      computerEnvironment: "local-active-desktop",
      allowedDomains: ["override.example.com"],
      allowedApplications: ["Calculator"],
      applicationAliases: {
        Calculator: ["Calculadora"],
      },
    });
  });
});

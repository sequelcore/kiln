import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeAvailableModelsCommand, routeCommand } from "../../src/commands/route.js";

const globalConfigMocks = vi.hoisted(() => ({
  config: null as unknown,
  readGlobalConfig: vi.fn(() => globalConfigMocks.config),
}));

vi.mock("../../src/config/global-config.js", () => ({
  defaultGlobalConfig: () => ({
    version: "1",
    engines: {
      claude: { enabled: true, billing: "subscription" },
    },
    workerRouting: { defaultWorker: "claude" },
  }),
  readGlobalConfig: globalConfigMocks.readGlobalConfig,
}));

describe("routeCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    globalConfigMocks.config = {
      version: "1",
      engines: {
        codex: { enabled: true },
        opencode: { enabled: true },
      },
      workerRouting: {
        defaultWorker: "codex",
        fallback: "opencode",
      },
    };
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("prints resolved route", async () => {
    await routeCommand({
      isEngineAvailable: () => true,
    });

    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Resolved worker: codex");
    expect(output).toContain("Reason:          default");
    expect(output).toContain("Default worker:  codex");
  });

  it("falls back when default worker is unavailable", async () => {
    await routeCommand({
      isEngineAvailable: (engineId) => engineId !== "codex",
    });

    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Resolved worker: opencode");
    expect(output).toContain("Reason:          unavailable");
  });

  it("uses default config when no global config exists", async () => {
    globalConfigMocks.config = null;

    await routeCommand();

    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Resolved worker: claude");
  });

  it("prints the supplied Runtime available-model catalog without executing a provider", async () => {
    await routeAvailableModelsCommand({ readCatalog: async () => ({
      observedAt: "2026-08-13T18:00:00.000Z",
      entries: [{ providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model", discoveryState: "stale", eligibilityState: "unknown", availabilityState: "unknown", configuredState: "unconfigured", configuredRouteRefs: [], reasonCodes: ["discovery-stale", "eligibility-unknown", "availability-unknown", "route-not-configured"] }],
    }) });
    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Available Models:");
    expect(output).toContain("discovery=stale");
    expect(output).toContain("configured=unconfigured");
  });

  it("sanitizes discovery failures", async () => {
    await routeAvailableModelsCommand({ readCatalog: async () => { throw new Error("token=secret C:\\operator"); } });
    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("current provider discovery failed");
    expect(output).not.toMatch(/secret|operator/u);
  });
});

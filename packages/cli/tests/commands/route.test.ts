import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeCommand } from "../../src/commands/route.js";

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
    workerRouting: { defaultWorker: "claude", budgetAware: false },
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
        budgetAware: true,
        budget: {
          codex: { dailyTokenCeiling: 10 },
        },
      },
    };
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("prints resolved route", () => {
    routeCommand({
      getDailyTokensUsed: () => 15,
      isEngineAvailable: () => true,
    });

    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Resolved worker: opencode");
    expect(output).toContain("Reason:          budget-ceiling");
    expect(output).toContain("Default worker:  codex");
  });

  it("falls back when default worker is unavailable", () => {
    routeCommand({
      isEngineAvailable: (engineId) => engineId !== "codex",
    });

    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Resolved worker: opencode");
    expect(output).toContain("Reason:          unavailable");
  });

  it("uses default config when no global config exists", () => {
    globalConfigMocks.config = null;

    routeCommand();

    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Resolved worker: claude");
  });
});

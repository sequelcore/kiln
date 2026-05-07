import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/test-user"),
}));

import { KilnYamlError } from "../kiln-yaml.js";
import {
  defaultGlobalConfig,
  readGlobalConfig,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
  resolveGlobalUiTheme,
  resolveGlobalConfigPath,
  writeGlobalConfig,
} from "./global-config.js";

const existsSyncMock = existsSync as unknown as ReturnType<typeof vi.fn>;
const readFileSyncMock = readFileSync as unknown as ReturnType<typeof vi.fn>;
const writeFileSyncMock = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const mkdirSyncMock = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const homedirMock = homedir as unknown as ReturnType<typeof vi.fn>;

describe("global-config", () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    mkdirSyncMock.mockReset();
    homedirMock.mockReset();
    homedirMock.mockReturnValue("/home/test-user");
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    vi.restoreAllMocks();
  });

  it("resolveGlobalConfigPath() returns ~/.kiln/config.yaml when XDG_CONFIG_HOME is not set", () => {
    const path = resolveGlobalConfigPath();

    expect(path).toBe(join("/home/test-user", ".kiln", "config.yaml"));
  });

  it("resolveGlobalConfigPath() returns XDG_CONFIG_HOME/kiln/config.yaml when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg";

    const path = resolveGlobalConfigPath();

    expect(path).toBe(join("/tmp/xdg", "kiln", "config.yaml"));
  });

  it("readGlobalConfig() returns null when file does not exist", () => {
    existsSyncMock.mockReturnValue(false);

    const config = readGlobalConfig();

    expect(config).toBeNull();
  });

  it("readGlobalConfig() parses and returns valid config", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "engines:",
        "  codex:",
        "    enabled: true",
        "    billing: plus-quota",
        "routing:",
        "  defaultWorker: codex",
        "  budgetAware: false",
        "models:",
        "  default: claude-opus-4-7",
        "  codex: gpt-5.4",
      ].join("\n"),
    );

    const config = readGlobalConfig();

    expect(config).toEqual({
      version: "1",
      engines: {
        codex: {
          enabled: true,
          billing: "plus-quota",
        },
      },
      routing: {
        defaultWorker: "codex",
        budgetAware: false,
      },
      models: {
        default: "claude-opus-4-7",
        codex: "gpt-5.4",
      },
    });
  });

  it("readGlobalConfig() rejects non-canonical configs", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(["version: \"2\"", "provider: codex"].join("\n"));

    expect(() => readGlobalConfig()).toThrow(
      'Global config version must be "1". Recreate the canonical config through an explicit adoption flow.',
    );
  });

  it("readGlobalConfig() rejects unknown top-level fields and invalid billing modes", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(["version: \"1\"", "provider: codex"].join("\n"));
    expect(() => readGlobalConfig()).toThrow("Unknown global config field: provider");

    readFileSyncMock.mockReturnValue(
      ["version: \"1\"", "engines:", "  codex:", "    billing: credits"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("engines.codex.billing has an unknown billing mode");
  });

  it("readGlobalConfig() accepts null budget ceilings", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "routing:",
        "  budgetAware: true",
        "  budget:",
        "    opencode:",
        "      dailyTokenCeiling: null",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.routing?.budget?.opencode?.dailyTokenCeiling).toBeNull();
  });

  it("readGlobalConfig() throws KilnYamlError when file is not a YAML object", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("- not\n- an\n- object\n");

    expect(() => readGlobalConfig()).toThrow(KilnYamlError);
    expect(() => readGlobalConfig()).toThrow("Global config must be an object");
  });

  it("writeGlobalConfig() creates parent directories and writes stringified YAML", () => {
    writeGlobalConfig({
      version: "1",
      routing: { defaultWorker: "codex", budgetAware: false },
      models: { codex: "gpt-5.4" },
    });

    expect(mkdirSyncMock).toHaveBeenCalledWith(join("/home/test-user", ".kiln"), {
      recursive: true,
    });
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join("/home/test-user", ".kiln", "config.yaml"),
      expect.any(String),
      "utf-8",
    );
    expect(String(writeFileSyncMock.mock.calls[0]?.[1])).toContain("defaultWorker: codex");
  });

  it("defaultGlobalConfig() returns expected shape", () => {
    expect(defaultGlobalConfig()).toEqual({
      version: "1",
      engines: {
        claude: { enabled: true, billing: "subscription" },
        codex: { enabled: false, billing: "plus-quota" },
        opencode: { enabled: false, billing: "free" },
      },
      routing: {
        defaultWorker: "claude",
        budgetAware: false,
      },
      permissions: {
        approval: "on-request",
        sandbox: "read-only",
      },
      components: {
        include: ["baseline:core"],
      },
    });
  });

  it("resolves provider, model, and UI theme through projection helpers", () => {
    const config = {
      version: "1" as const,
      engines: { codex: { enabled: true as const } },
      routing: { defaultWorker: "codex" },
      models: { default: "fallback-model", codex: "gpt-5.4" },
      ui: { theme: "night-owl" },
    };

    expect(resolveGlobalDefaultProvider(config)).toBe("codex");
    expect(resolveGlobalDefaultModel(config)).toBe("gpt-5.4");
    expect(resolveGlobalUiTheme(config)).toBe("night-owl");
  });
});

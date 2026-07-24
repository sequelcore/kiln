import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const syncMocks = vi.hoisted(() => ({
  mockedHomedir: "",
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  const mockedOs = {
    ...actual,
    homedir: () => syncMocks.mockedHomedir || actual.homedir(),
  };
  return {
    ...mockedOs,
    default: mockedOs,
  };
});

const { resolveNativeHarnessDir } = await import("../../src/config/native-harness-home.js");

const ENV_VARS = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "OPENCODE_CONFIG_DIR"] as const;

describe("resolveNativeHarnessDir", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    syncMocks.mockedHomedir = join("C:", "fake-home");
    for (const key of ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("defaults to the OS home directory subpath per harness when nothing is overridden", () => {
    expect(resolveNativeHarnessDir("claude")).toBe(join("C:", "fake-home", ".claude"));
    expect(resolveNativeHarnessDir("codex")).toBe(join("C:", "fake-home", ".codex"));
    expect(resolveNativeHarnessDir("opencode")).toBe(join("C:", "fake-home", ".config", "opencode"));
  });

  it("honors each harness's own env var override, matching what the real CLI reads", () => {
    process.env.CLAUDE_CONFIG_DIR = join("C:", "claude-scratch");
    process.env.CODEX_HOME = join("C:", "codex-scratch");
    process.env.OPENCODE_CONFIG_DIR = join("C:", "opencode-scratch");

    expect(resolveNativeHarnessDir("claude")).toBe(join("C:", "claude-scratch"));
    expect(resolveNativeHarnessDir("codex")).toBe(join("C:", "codex-scratch"));
    expect(resolveNativeHarnessDir("opencode")).toBe(join("C:", "opencode-scratch"));
  });

  it("ignores a blank env var override and falls back to the OS home subpath", () => {
    process.env.CLAUDE_CONFIG_DIR = "   ";

    expect(resolveNativeHarnessDir("claude")).toBe(join("C:", "fake-home", ".claude"));
  });

  it("prefers an explicit userHome over any env var, for deterministic test/sandbox isolation", () => {
    process.env.CLAUDE_CONFIG_DIR = join("C:", "claude-scratch");
    process.env.CODEX_HOME = join("C:", "codex-scratch");
    process.env.OPENCODE_CONFIG_DIR = join("C:", "opencode-scratch");

    const userHome = join("C:", "sandbox-home");
    expect(resolveNativeHarnessDir("claude", userHome)).toBe(join(userHome, ".claude"));
    expect(resolveNativeHarnessDir("codex", userHome)).toBe(join(userHome, ".codex"));
    expect(resolveNativeHarnessDir("opencode", userHome)).toBe(join(userHome, ".config", "opencode"));
  });
});

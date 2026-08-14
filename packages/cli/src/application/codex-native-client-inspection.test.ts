import { describe, expect, it, vi } from "vitest";
import { inspectCodexNativeClient, parseCodexNativeVersion } from "./codex-native-client-inspection.js";

describe("Codex native client inspection", () => {
  it("parses only the anchored native Codex version contract", () => {
    expect(parseCodexNativeVersion("codex-cli 0.147.0\n")).toBe("0.147.0");
    expect(() => parseCodexNativeVersion("wrapper output\ncodex-cli 0.147.0")).toThrow("version output");
    expect(() => parseCodexNativeVersion("codex-cli latest")).toThrow("version output");
  });

  it("binds version and catalog inspection to one exact executable", () => {
    const execute = vi.fn((executable: string, args: readonly string[]) => {
      expect(executable).toBe("C:/portable/codex.exe");
      if (args[0] === "--version") return "codex-cli 0.147.0\n";
      return JSON.stringify({ models: [{ slug: "fixture-model" }] });
    });

    expect(
      inspectCodexNativeClient({
        resolveExecutable: () => "C:/portable/codex.exe",
        execute,
      }),
    ).toEqual({
      executable: "C:/portable/codex.exe",
      version: "0.147.0",
      nativeCatalog: { models: [{ slug: "fixture-model" }] },
    });
    expect(execute.mock.calls).toEqual([
      ["C:/portable/codex.exe", ["--version"]],
      ["C:/portable/codex.exe", ["debug", "models", "--bundled"]],
    ]);
  });

  it("rejects a malformed or empty native catalog without leaking process output", () => {
    for (const output of ["not-json", JSON.stringify({ models: [] })]) {
      expect(() =>
        inspectCodexNativeClient({
          resolveExecutable: () => "C:/portable/codex.exe",
          execute: (_executable, args) => (args[0] === "--version" ? "codex-cli 0.147.0" : output),
        }),
      ).toThrow("catalog");
    }
  });
});

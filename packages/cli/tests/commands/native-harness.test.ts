import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ start: vi.fn(async () => {}) }));

vi.mock("../../src/native-harness/codex-app-mcp-server.js", () => ({
  startNativeHarnessMcpServer: mocks.start,
}));

import { nativeHarnessCommand } from "../../src/commands/native-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
  mocks.start.mockClear();
});

describe("nativeHarnessCommand", () => {
  it.each(["codex", "claude", "opencode"] as const)("starts the %s stdio adapter with explicit trusted identity", async (harness) => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-harness-command-"));
    mkdirSync(join(root, ".kiln"));
    writeFileSync(join(root, ".kiln", "kiln.yaml"), 'version: "1"\nname: fixture\n');
    const pause = vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);
    const resume = vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);

    await nativeHarnessCommand(["control-plane-mcp", "--harness", harness, "--project-root", root]);

    expect(mocks.start).toHaveBeenCalledWith({ harness, projectPath: root });
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    rmSync(root, { recursive: true, force: true });
  });

  it("fails closed before touching stdio when the explicit project root is not a Kiln project", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-harness-invalid-"));
    const pause = vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);

    await expect(nativeHarnessCommand(["control-plane-mcp", "--harness", "claude", "--project-root", root]))
      .rejects.toThrow(/kiln\.yaml/i);

    expect(mocks.start).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects unsupported adapter names without touching stdio", async () => {
    const pause = vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);

    await expect(nativeHarnessCommand(["unsupported"])).rejects.toThrow("Usage:");

    expect(mocks.start).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });
});

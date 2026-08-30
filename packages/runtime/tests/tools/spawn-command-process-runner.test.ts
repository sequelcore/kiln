import { BashTool } from "@kilnai/core/tools";
import { describe, expect, it } from "vitest";
import { SpawnCommandProcessRunner } from "../../src/tools/spawn-command-process-runner.js";

describe("SpawnCommandProcessRunner", () => {
  it("preserves Bash timeout and process-settlement evidence", async () => {
    const tool = new BashTool({
      processRunner: new SpawnCommandProcessRunner(),
      environmentProvider: async () => ({ bash: { path: "bash", version: "test" } }),
      platform: process.platform,
    });
    const command =
      process.platform === "win32" ? 'powershell -NoProfile -Command "Start-Sleep -Seconds 1"' : "sleep 1";
    const result = await tool.execute({
      name: "bash",
      input: { command, timeout: 50 },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("bash command timed out");
    if (result.metadata?.kind !== "command") throw new Error("expected command metadata");
    expect(result.metadata.timedOut).toBe(true);
    expect(result.metadata.status).toBe("timed_out");
    expect(result.metadata.truncated).toBe(false);
    expect(result.metadata.signal).toBe("SIGTERM");
    expect(result.metadata.stdout).toBe("");
    expect(result.metadata.stderr).toBe("");
    expect(result.metadata.durationMs).toEqual(expect.any(Number));
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
  }, 10_000);
});

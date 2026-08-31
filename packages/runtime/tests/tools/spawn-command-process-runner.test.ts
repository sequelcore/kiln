import { BashTool, type CommandProcessRunner, MonitorRegistry, SpawnMonitorCommandRunner } from "@kilnai/core/tools";
import { describe, expect, it } from "vitest";
import {
  resolveWindowsTaskkillExecutable,
  SpawnCommandProcessRunner,
} from "../../src/tools/spawn-command-process-runner.js";

describe("SpawnCommandProcessRunner", () => {
  it("resolves Windows tree termination without ambient PATH lookup", () => {
    expect(resolveWindowsTaskkillExecutable("C:\\Windows")).toBe("C:\\Windows\\System32\\taskkill.exe");
    expect(resolveWindowsTaskkillExecutable("Windows")).toBeUndefined();
    expect(resolveWindowsTaskkillExecutable(undefined)).toBeUndefined();
  });

  it("passes only the explicit environment through argv-only spawning", async () => {
    const runner = new SpawnCommandProcessRunner();
    const output: string[] = [];
    await new Promise<void>((resolve) => {
      runner.start({
        executable: process.execPath,
        args: ["-e", "process.stdout.write(process.env.KILN_PROCESS_TEST ?? 'missing')"],
        cwd: process.cwd(),
        env: { KILN_PROCESS_TEST: "explicit" },
        shell: false,
      }, {
        output: (chunk) => output.push(chunk.text),
        finish: () => resolve(),
      });
    });
    expect(output.join("")).toBe("explicit");
  });

  it("preserves terminal settlement when an output observer throws", async () => {
    const runner = new SpawnCommandProcessRunner();
    const result = await new Promise<{ readonly exitCode?: number | string }>((resolve) => {
      runner.start({
        executable: process.execPath,
        args: ["-e", "process.stdout.write('observed')"],
        cwd: process.cwd(),
        env: {},
        shell: false,
      }, {
        output: () => { throw new Error("observer failure"); },
        finish: resolve,
      });
    });
    expect(result.exitCode).toBe(0);
  });

  it("escalates a process group after bounded TERM grace when it ignores TERM", async () => {
    if (process.platform === "win32") return;
    const runner = new SpawnCommandProcessRunner();
    const settled = new Promise<{ readonly signal?: string }>((resolve) => {
      const handle = runner.start({
        executable: process.execPath,
        args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
        cwd: process.cwd(),
        env: {},
        shell: false,
      }, {
        output: () => undefined,
        finish: (result) => resolve({ signal: typeof result.signal === "string" ? result.signal : undefined }),
      });
      void handle.stop("timeout");
    });
    await expect(settled).resolves.toEqual({ signal: "SIGKILL" });
  }, 10_000);

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

  it("owns monitor timeout settlement in the Runtime process lifecycle", () => {
    const processRunner: CommandProcessRunner = {
      start(request, sink) {
        expect(request.timeoutMs).toBe(50);
        sink.finish({ signal: "SIGTERM", timedOut: true });
        return { async stop() {} };
      },
    };
    const registry = new MonitorRegistry({
      commandRunner: new SpawnMonitorCommandRunner(processRunner),
    });
    const settled = registry.start({
      command: "sleep 1",
      cwd: process.cwd(),
      timeoutMs: 50,
    });

    expect(settled.status).toBe("stopped");
    expect(settled.timedOut).toBe(true);
    expect(settled.signal).toBe("SIGTERM");
  });
});

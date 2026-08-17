import { describe, expect, it } from "vitest";
import {
  MonitorListTool,
  MonitorReadTool,
  MonitorRegistry,
  MonitorStartTool,
  MonitorStopTool,
  type MonitorCommandRunner,
} from "../../../src/tools/infrastructure/monitor-tools.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

describe("monitor tools", () => {
  it("starts, reads, lists, and stops a long-running command through one registry", async () => {
    const tempDir = await makeTempDir();
    try {
      const startedRequests: Parameters<MonitorCommandRunner["start"]>[0][] = [];
      const runner: MonitorCommandRunner = {
        start: (request, sink) => {
          startedRequests.push(request);
          sink.stdout("server ready\n");
          return {
            pid: 42,
            stop: async (reason) => {
              sink.stderr(`stopping: ${reason}\n`);
              sink.finish({ exitCode: 0 });
            },
          };
        },
      };
      const registry = new MonitorRegistry({ commandRunner: runner });
      const sandbox = makeSandbox(tempDir);

      const startResult = await new MonitorStartTool({ registry }).execute({
        name: "monitor_start",
        input: {
          command: "bun run dev",
          name: "dev server",
          timeout: 60_000,
          verbosity: "structured",
        },
      }, sandbox);

      expect(startResult.isError).toBe(false);
      expect(startedRequests).toHaveLength(1);
      expect(startedRequests[0]).toMatchObject({
        command: "bun run dev",
        cwd: tempDir,
        timeoutMs: 60_000,
      });
      expect(startResult.metadata).toMatchObject({
        toolName: "monitor_start",
        kind: "monitor",
        operation: "start",
        command: "bun run dev",
        cwd: tempDir,
        name: "dev server",
        status: "running",
        sequence: 1,
        timeoutMs: 60_000,
        verbosity: "structured",
      });

      const startPayload = JSON.parse(startResult.output) as { id: string };
      expect(startPayload.id).toMatch(/^mon_/);

      const readResult = await new MonitorReadTool({ registry }).execute({
        name: "monitor_read",
        input: { id: startPayload.id, sinceSequence: 0, limit: 10, verbosity: "structured" },
      });

      expect(readResult.isError).toBe(false);
      expect(JSON.parse(readResult.output)).toMatchObject({
        id: startPayload.id,
        status: "running",
        events: [{ sequence: 1, stream: "stdout", text: "server ready\n" }],
      });
      expect(readResult.metadata).toMatchObject({
        toolName: "monitor_read",
        kind: "monitor",
        operation: "read",
        id: startPayload.id,
        status: "running",
        eventCount: 1,
        sinceSequence: 0,
      });

      const listResult = await new MonitorListTool({ registry }).execute({
        name: "monitor_list",
        input: { status: "running", verbosity: "structured" },
      });

      expect(listResult.isError).toBe(false);
      expect(JSON.parse(listResult.output)).toMatchObject({
        monitors: [{
          id: startPayload.id,
          name: "dev server",
          command: "bun run dev",
          status: "running",
          sequence: 1,
        }],
      });

      const stopResult = await new MonitorStopTool({ registry }).execute({
        name: "monitor_stop",
        input: { id: startPayload.id, reason: "test done", verbosity: "structured" },
      });

      expect(stopResult.isError).toBe(false);
      expect(JSON.parse(stopResult.output)).toMatchObject({
        id: startPayload.id,
        status: "stopped",
        exitCode: 0,
      });
      expect(stopResult.metadata).toMatchObject({
        toolName: "monitor_stop",
        kind: "monitor",
        operation: "stop",
        id: startPayload.id,
        status: "stopped",
        eventCount: 3,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("validates cwd, command, ids, and numeric bounds before touching the runner", async () => {
    const tempDir = await makeTempDir();
    try {
      let started = false;
      const registry = new MonitorRegistry({
        commandRunner: {
          start: () => {
            started = true;
            return { stop: async () => undefined };
          },
        },
      });
      const sandbox = makeSandbox(tempDir);
      await expect(new MonitorStartTool({ registry }).execute({
        name: "monitor_start",
        input: { command: "rm -rf /" },
      }, sandbox)).resolves.toMatchObject({
        isError: true,
        output: expect.stringContaining("Dangerous command blocked"),
      });
      expect(started).toBe(false);

      await expect(new MonitorReadTool({ registry }).execute({
        name: "monitor_read",
        input: { id: "missing", sinceSequence: -1 },
      })).resolves.toMatchObject({
        isError: true,
        output: expect.stringContaining("sinceSequence"),
      });

      await expect(new MonitorStopTool({ registry }).execute({
        name: "monitor_stop",
        input: { id: "missing" },
      })).resolves.toMatchObject({
        isError: true,
        output: expect.stringContaining("Monitor not found"),
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

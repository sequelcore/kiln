import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  runCodexAppServerRuntimePermissionAttestation,
  runCodexAppServerThreadContinuity,
} from "./codex-app-server-thread-continuity.js";

function scriptedChild(confirmExit = true): ChildProcessWithoutNullStreams {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let killed = false;
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const request = JSON.parse(String(chunk).trim()) as { readonly id?: number; readonly method: string };
      if (request.id !== undefined) {
        const result =
          request.method === "initialize"
            ? { userAgent: "codex-test" }
            : { data: [{ id: "thread-1", modelProvider: "kiln", title: "not-projected" }], nextCursor: null };
        stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
      }
      callback();
    },
  });
  return Object.assign(events, {
    pid: 42,
    stdin,
    stdout,
    stderr,
    get killed() {
      return killed;
    },
    kill: vi.fn(() => {
      killed = true;
      if (confirmExit) {
        stdout.end();
        events.emit("close", 0, null);
      }
      return true;
    }),
  }) as unknown as ChildProcessWithoutNullStreams;
}

function attestationChild(): ChildProcessWithoutNullStreams {
  const child = scriptedChild();
  child.stdin.removeAllListeners();
  const stdout = child.stdout as PassThrough;
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const request = JSON.parse(String(chunk).trim()) as { readonly id?: number; readonly method: string };
      if (request.id !== undefined) {
        const result = request.method === "initialize"
          ? {}
          : {
              thread: { id: "attested-thread" },
              approvalPolicy: "never",
              approvalsReviewer: "user",
              cwd: "C:/project",
              model: "gpt-5.6-sol",
              modelProvider: "openai",
              sandbox: { type: "dangerFullAccess" },
            };
        stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
      }
      callback();
    },
  });
  Object.defineProperty(child, "stdin", { configurable: true, value: stdin });
  return child;
}

describe("runCodexAppServerThreadContinuity", () => {
  it("binds the permission proof to the owned child process", async () => {
    await expect(runCodexAppServerRuntimePermissionAttestation({
      executable: "C:\\Codex\\codex.exe",
      cwd: "C:/project",
      spawnProcess: () => attestationChild(),
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      processId: 42,
      proof: {
        threadId: "attested-thread",
        approvalMode: "never",
        sandboxMode: "danger-full-access",
        networkAccess: "enabled",
      },
    });
  });

  it("runs the bounded content-free proof through the exact injected executable process", async () => {
    const spawnProcess = vi.fn(() => scriptedChild());
    await expect(
      runCodexAppServerThreadContinuity({
        executable: "C:\\Codex\\codex.exe",
        spawnProcess,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({
      protocol: "codex-app-server-v2",
      pagesRead: 1,
      itemsRead: 1,
      providerCounts: { kiln: 1 },
      truncated: false,
      resume: null,
    });
    expect(spawnProcess).toHaveBeenCalledWith("C:\\Codex\\codex.exe");
  });

  it("fails instead of returning while the app-server process has not confirmed exit", async () => {
    await expect(
      runCodexAppServerThreadContinuity({
        executable: "C:\\Codex\\codex.exe",
        spawnProcess: () => scriptedChild(false),
        timeoutMs: 1_000,
        exitTimeoutMs: 5,
      }),
    ).rejects.toThrow("did not terminate");
  });

  it("does not mistake a post-spawn process error for confirmed exit", async () => {
    const child = scriptedChild(false);
    const result = runCodexAppServerThreadContinuity({
      executable: "C:\\Codex\\codex.exe",
      spawnProcess: () => child,
      timeoutMs: 1_000,
      exitTimeoutMs: 5,
    });
    queueMicrotask(() => child.emit("error", new Error("kill failed")));
    await expect(result).rejects.toThrow("did not terminate");
  });
});

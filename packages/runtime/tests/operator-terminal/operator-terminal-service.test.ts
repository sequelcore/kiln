import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OperatorTerminalError,
  OperatorTerminalService,
  type OperatorPtyAdapter,
  type OperatorPtyProcess,
} from "../../src/operator-terminal/operator-terminal-service.js";

class FakePtyProcess implements OperatorPtyProcess {
  readonly write = vi.fn<(data: string) => void>();
  readonly resize = vi.fn<(cols: number, rows: number) => void>();
  readonly kill = vi.fn<() => void>();
  private dataListener: ((data: string) => void) | undefined;
  private exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;

  onData(listener: (data: string) => void): () => void {
    this.dataListener = listener;
    return () => { this.dataListener = undefined; };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): () => void {
    this.exitListener = listener;
    return () => { this.exitListener = undefined; };
  }

  emitData(data: string): void {
    this.dataListener?.(data);
  }

  emitExit(exitCode = 0): void {
    this.exitListener?.({ exitCode });
  }
}

async function fixture() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "kiln-terminal-"));
  await mkdir(join(workspaceRoot, "packages"));
  const process = new FakePtyProcess();
  const spawn = vi.fn<OperatorPtyAdapter["spawn"]>().mockResolvedValue(process);
  const service = new OperatorTerminalService({
    workspaceRoot,
    adapter: { spawn },
    resolveShell: () => ({ executable: "test-shell", args: ["--interactive"] }),
  });
  return { workspaceRoot, process, spawn, service };
}

describe("OperatorTerminalService", () => {
  it("binds a PTY to its operator owner and streams output", async () => {
    const { service, spawn, process, workspaceRoot } = await fixture();
    const events: unknown[] = [];
    const terminal = await service.open({
      ownerId: "socket-a",
      cols: 100,
      rows: 30,
      onEvent: (event) => events.push(event),
    });

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      executable: "test-shell",
      args: ["--interactive"],
      cwd: workspaceRoot,
      cols: 100,
      rows: 30,
    }));
    process.emitData("ready\r\n");
    expect(events).toContainEqual({
      type: "output",
      terminalId: terminal.terminalId,
      data: "ready\r\n",
    });

    service.write("socket-a", terminal.terminalId, "pwd\r");
    service.resize("socket-a", terminal.terminalId, 120, 40);
    expect(process.write).toHaveBeenCalledWith("pwd\r");
    expect(process.resize).toHaveBeenCalledWith(120, 40);
  });

  it("rejects cross-owner access and paths outside the workspace", async () => {
    const { service } = await fixture();
    const terminal = await service.open({
      ownerId: "socket-a",
      cols: 80,
      rows: 24,
      onEvent: () => undefined,
    });

    expect(() => service.write("socket-b", terminal.terminalId, "whoami\r"))
      .toThrowError(new OperatorTerminalError("terminal_not_found", "Terminal session was not found."));
    await expect(service.open({
      ownerId: "socket-a",
      cwd: "..",
      cols: 80,
      rows: 24,
      onEvent: () => undefined,
    })).rejects.toMatchObject({ code: "cwd_outside_workspace" });
  });

  it("kills all owned PTYs on disconnect and emits one terminal exit", async () => {
    const { service, process } = await fixture();
    const events: unknown[] = [];
    const terminal = await service.open({
      ownerId: "socket-a",
      cols: 80,
      rows: 24,
      onEvent: (event) => events.push(event),
    });

    service.closeOwner("socket-a");
    expect(process.kill).toHaveBeenCalledOnce();
    process.emitExit(0);
    expect(events.filter((event) => (
      typeof event === "object" && event !== null && "type" in event && event.type === "exit"
    ))).toEqual([{ type: "exit", terminalId: terminal.terminalId, exitCode: 0 }]);
  });

  it("validates terminal dimensions and bounds input payloads", async () => {
    const { service } = await fixture();
    await expect(service.open({
      ownerId: "socket-a",
      cols: 0,
      rows: 24,
      onEvent: () => undefined,
    })).rejects.toMatchObject({ code: "invalid_dimensions" });

    const terminal = await service.open({
      ownerId: "socket-a",
      cols: 80,
      rows: 24,
      onEvent: () => undefined,
    });
    expect(() => service.write("socket-a", terminal.terminalId, "x".repeat(65_537)))
      .toThrowError(expect.objectContaining({ code: "input_too_large" }));
  });

  it("preserves an immediate process exit during listener attachment", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "kiln-terminal-exit-"));
    const events: unknown[] = [];
    const process: OperatorPtyProcess = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => undefined,
      onExit: (listener) => {
        listener({ exitCode: 7 });
        return () => undefined;
      },
    };
    const service = new OperatorTerminalService({
      workspaceRoot,
      adapter: { spawn: async () => process },
      resolveShell: () => ({ executable: "test-shell", args: [] }),
    });

    const terminal = await service.open({
      ownerId: "socket-a",
      cols: 80,
      rows: 24,
      onEvent: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "exit", terminalId: terminal.terminalId, exitCode: 7 }]);
    expect(() => service.write("socket-a", terminal.terminalId, "pwd\r"))
      .toThrowError(expect.objectContaining({ code: "terminal_not_found" }));
  });
});

import { describe, expect, it, vi } from "vitest";
import { OperatorTerminalError } from "../../src/operator-terminal/operator-terminal-service.js";
import { handleOperatorTerminalFrame } from "../../src/operator-terminal/operator-terminal-gateway.js";

describe("handleOperatorTerminalFrame", () => {
  it("rejects terminal access without the launcher capability", async () => {
    const send = vi.fn();
    const service = { open: vi.fn() };
    expect(await handleOperatorTerminalFrame({
      frame: { type: "operator_terminal_open", requestId: "req-1", cols: 80, rows: 24 },
      authorized: false,
      ownerId: "socket-1",
      service: service as never,
      send,
    })).toBe(true);
    expect(service.open).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "operator_terminal_error",
      code: "terminal_unauthorized",
      requestId: "req-1",
    }));
  });

  it("opens a terminal and correlates output to the same session", async () => {
    const send = vi.fn();
    let onEvent: ((event: unknown) => void) | undefined;
    const service = {
      open: vi.fn(async (input) => {
        onEvent = input.onEvent;
        input.onEvent({ type: "output", terminalId: "term-1", data: "prompt>" });
        return { terminalId: "term-1", cwd: "C:/workspace" };
      }),
    };
    await handleOperatorTerminalFrame({
      frame: { type: "operator_terminal_open", requestId: "req-1", cols: 80, rows: 24 },
      authorized: true,
      ownerId: "socket-1",
      service: service as never,
      send,
    });

    expect(send).toHaveBeenCalledWith({
      type: "operator_terminal_opened",
      requestId: "req-1",
      terminalId: "term-1",
      cwd: "C:/workspace",
    });
    expect(send.mock.calls.slice(0, 2).map(([frame]) => frame.type)).toEqual([
      "operator_terminal_opened",
      "operator_terminal_output",
    ]);
    onEvent?.({ type: "output", terminalId: "term-1", data: "hello\r\n" });
    expect(send).toHaveBeenCalledWith({
      type: "operator_terminal_output",
      terminalId: "term-1",
      data: "hello\r\n",
    });
  });

  it("maps bounded domain errors without exposing implementation details", async () => {
    const send = vi.fn();
    const service = {
      write: vi.fn(() => { throw new OperatorTerminalError("terminal_not_found", "Terminal session was not found."); }),
    };
    await handleOperatorTerminalFrame({
      frame: { type: "operator_terminal_write", terminalId: "missing", data: "pwd\r" },
      authorized: true,
      ownerId: "socket-1",
      service: service as never,
      send,
    });
    expect(send).toHaveBeenCalledWith({
      type: "operator_terminal_error",
      code: "terminal_not_found",
      message: "Terminal session was not found.",
      terminalId: "missing",
    });
  });

  it("ignores non-terminal frames", async () => {
    expect(await handleOperatorTerminalFrame({
      frame: { type: "message", content: "hello" },
      authorized: true,
      ownerId: "socket-1",
      service: {} as never,
      send: vi.fn(),
    })).toBe(false);
  });
});

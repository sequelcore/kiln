import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorTerminalDock } from "../src/components/operator-terminal-dock.js";

const terminal = {
  cols: 100,
  rows: 16,
  loadAddon: vi.fn(),
  open: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  onData: vi.fn(() => ({ dispose: vi.fn() })),
};
const fit = vi.fn();

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    constructor() { return terminal; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock {
    constructor() { return { fit }; }
  },
}));

class ResizeObserverMock {
  observe(): void {}
  disconnect(): void {}
}

type TerminalFrame = Extract<GuiInboundFrame, { type: `operator_terminal_${string}` }>;

function createChannel() {
  let listener: ((frame: TerminalFrame) => void) | undefined;
  return {
    subscribe: (next: (frame: TerminalFrame) => void) => {
      listener = next;
      return () => { listener = undefined; };
    },
    emit: (frame: TerminalFrame) => act(() => listener?.(frame)),
  };
}

function pointerEvent(type: string, values: { pointerId: number; clientY: number; button?: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    clientY: { value: values.clientY },
    button: { value: values.button ?? 0 },
  });
  return event;
}

describe("OperatorTerminalDock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("occupies no visible workbench space until its controlled panel is expanded", () => {
    const channel = createChannel();
    render(
      <OperatorTerminalDock
        available
        expanded={false}
        workspaceScope="C:/workspace"
        onExpandedChange={vi.fn()}
        send={vi.fn()}
        subscribe={channel.subscribe}
      />,
    );

    expect(screen.queryByRole("button", { name: "Terminal" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Operator terminal")).not.toBeVisible();
  });

  it("opens one PTY from controlled workbench state and writes correlated output", () => {
    const send = vi.fn();
    const channel = createChannel();
    render(
      <OperatorTerminalDock
        available
        expanded
        workspaceScope="C:/workspace"
        onExpandedChange={vi.fn()}
        send={send}
        subscribe={channel.subscribe}
      />,
    );

    const openFrame = send.mock.calls[0]![0];
    expect(openFrame).toMatchObject({ type: "operator_terminal_open", cols: 100, rows: 16 });
    channel.emit({
      type: "operator_terminal_opened",
      requestId: openFrame.requestId,
      terminalId: "term-1",
      cwd: "C:/workspace",
    });
    channel.emit({ type: "operator_terminal_output", terminalId: "term-1", data: "ready\r\n" });

    expect(terminal.write).toHaveBeenCalledWith("ready\r\n");
    expect(screen.getByText("C:/workspace")).toBeInTheDocument();
  });

  it("collapses without spawning another PTY and closes explicitly", () => {
    const send = vi.fn();
    const onExpandedChange = vi.fn();
    const channel = createChannel();
    const { rerender } = render(
      <OperatorTerminalDock
        available
        expanded
        workspaceScope="C:/workspace"
        onExpandedChange={onExpandedChange}
        send={send}
        subscribe={channel.subscribe}
      />,
    );
    const requestId = send.mock.calls[0]![0].requestId;
    channel.emit({ type: "operator_terminal_opened", requestId, terminalId: "term-1", cwd: "C:/workspace" });

    fireEvent.click(screen.getByRole("button", { name: "Collapse terminal" }));
    expect(onExpandedChange).toHaveBeenCalledWith(false);
    rerender(
      <OperatorTerminalDock
        available
        expanded={false}
        workspaceScope="C:/workspace"
        onExpandedChange={onExpandedChange}
        send={send}
        subscribe={channel.subscribe}
      />,
    );
    rerender(
      <OperatorTerminalDock
        available
        expanded
        workspaceScope="C:/workspace"
        onExpandedChange={onExpandedChange}
        send={send}
        subscribe={channel.subscribe}
      />,
    );
    expect(send.mock.calls.filter(([frame]) => frame.type === "operator_terminal_open")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    expect(send).toHaveBeenCalledWith({ type: "operator_terminal_close", terminalId: "term-1" });
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it("supports keyboard resizing and persists the operator's preferred height", () => {
    const channel = createChannel();
    render(
      <OperatorTerminalDock
        available
        expanded
        workspaceScope="C:/workspace"
        onExpandedChange={vi.fn()}
        send={vi.fn()}
        subscribe={channel.subscribe}
      />,
    );

    const resizeHandle = screen.getByRole("separator", { name: "Resize terminal" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowUp" });

    expect(screen.getByRole("region", { name: "Operator terminal" })).toHaveStyle({ height: "296px" });
    expect(localStorage.getItem("kiln.gui.operatorTerminalHeight:C%3A%2Fworkspace")).toBe("296");
  });

  it("persists pointer resizing only when the drag completes", () => {
    const channel = createChannel();
    render(
      <OperatorTerminalDock
        available
        expanded
        workspaceScope="C:/workspace"
        onExpandedChange={vi.fn()}
        send={vi.fn()}
        subscribe={channel.subscribe}
      />,
    );

    const resizeHandle = screen.getByRole("separator", { name: "Resize terminal" });
    fireEvent(resizeHandle, pointerEvent("pointerdown", { button: 0, pointerId: 1, clientY: 300 }));
    fireEvent(resizeHandle, pointerEvent("pointermove", { pointerId: 1, clientY: 236 }));
    expect(screen.getByRole("region", { name: "Operator terminal" })).toHaveStyle({ height: "344px" });
    expect(localStorage.getItem("kiln.gui.operatorTerminalHeight:C%3A%2Fworkspace")).toBeNull();

    fireEvent(resizeHandle, pointerEvent("pointerup", { pointerId: 1, clientY: 236 }));
    expect(localStorage.getItem("kiln.gui.operatorTerminalHeight:C%3A%2Fworkspace")).toBe("344");
  });

  it("clamps a restored height when the workbench viewport becomes smaller", () => {
    const innerHeight = vi.spyOn(window, "innerHeight", "get").mockReturnValue(400);
    localStorage.setItem("kiln.gui.operatorTerminalHeight:C%3A%2Fworkspace", "720");
    const channel = createChannel();

    render(
      <OperatorTerminalDock
        available
        expanded
        workspaceScope="C:/workspace"
        onExpandedChange={vi.fn()}
        send={vi.fn()}
        subscribe={channel.subscribe}
      />,
    );

    expect(screen.getByRole("region", { name: "Operator terminal" })).toHaveStyle({ height: "300px" });
    expect(screen.getByRole("separator", { name: "Resize terminal" })).toHaveAttribute("aria-valuemax", "300");
    innerHeight.mockRestore();
  });

  it("offers a real restart after the shell exits", () => {
    const send = vi.fn();
    const channel = createChannel();
    render(
      <OperatorTerminalDock
        available
        expanded
        workspaceScope="C:/workspace"
        onExpandedChange={vi.fn()}
        send={send}
        subscribe={channel.subscribe}
      />,
    );
    const firstOpen = send.mock.calls[0]![0];
    channel.emit({ type: "operator_terminal_opened", requestId: firstOpen.requestId, terminalId: "term-1", cwd: "C:/workspace" });
    channel.emit({ type: "operator_terminal_exited", terminalId: "term-1", exitCode: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Restart" }));

    const openFrames = send.mock.calls.map(([frame]) => frame).filter((frame) => frame.type === "operator_terminal_open");
    expect(openFrames).toHaveLength(2);
    expect(openFrames[1]!.requestId).not.toBe(firstOpen.requestId);
  });
});

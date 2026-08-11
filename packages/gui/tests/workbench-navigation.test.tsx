import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopWorkbenchHeader,
  MobileWorkbenchHeader,
  PrimarySidebar,
} from "../src/components/workbench-navigation.js";

function pointerEvent(type: string, values: { pointerId: number; clientX: number; button?: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    clientX: { value: values.clientX },
    button: { value: values.button ?? 0 },
  });
  return event;
}

describe("Workbench navigation", () => {
  it("renders primary surfaces with badges and collapsed session access", () => {
    const onSelectSurface = vi.fn();

    render(
      <PrimarySidebar
        activeSurface="agents"
        collapsed
        sidebarWidth={288}
        activityCount={3}
        managedAgentAttentionCount={2}
        sessionsOpen={false}
        onSelectSurface={onSelectSurface}
        onToggleCollapsed={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onSessionsOpenChange={vi.fn()}
        onStartNewSession={vi.fn()}
        sessions={<div>Session list</div>}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Kiln workspace sidebar" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Primary work surfaces" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Inspect and configure" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Open sessions" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Primary work surfaces" })).toHaveClass("px-2");
    expect(screen.getByRole("button", { name: "Open sessions" })).toHaveClass("w-full");

    fireEvent.click(screen.getByRole("button", { name: "Activity" }));

    expect(onSelectSurface).toHaveBeenCalledWith("activity");
  });

  it("keeps expanded sidebar hierarchy scannable", () => {
    const onStartNewSession = vi.fn();
    render(
      <PrimarySidebar
        activeSurface="chat"
        collapsed={false}
        sidebarWidth={288}
        activityCount={0}
        managedAgentAttentionCount={0}
        sessionsOpen={false}
        onSelectSurface={vi.fn()}
        onToggleCollapsed={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onSessionsOpenChange={vi.fn()}
        onStartNewSession={onStartNewSession}
        sessions={<div>Session list</div>}
      />,
    );

    expect(screen.getByText("Kiln")).toBeVisible();
    expect(screen.queryByText("Operator workbench")).not.toBeInTheDocument();
    expect(screen.queryByText("Surfaces")).not.toBeInTheDocument();
    const primaryNavigation = screen.getByRole("navigation", { name: "Primary work surfaces" });
    const utilityNavigation = screen.getByRole("navigation", { name: "Inspect and configure" });
    expect(within(primaryNavigation).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Chat",
      "Work",
      "Agents",
    ]);
    expect(within(utilityNavigation).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Activity",
      "Memory",
      "Setup",
    ]);
    const sessionList = screen.getByText("Session list");
    expect(primaryNavigation.compareDocumentPosition(sessionList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sessionList.compareDocumentPosition(utilityNavigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(primaryNavigation).queryByRole("button", { name: "New session" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(onStartNewSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Session list")).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  });

  it("resizes the expanded sidebar with pointer and keyboard input", () => {
    const changes: Array<{ width: number; persist: boolean }> = [];
    function Harness() {
      const [width, setWidth] = useState(288);
      return (
        <PrimarySidebar
          activeSurface="chat"
          collapsed={false}
          sidebarWidth={width}
          activityCount={0}
          managedAgentAttentionCount={0}
          sessionsOpen={false}
          onSelectSurface={vi.fn()}
          onToggleCollapsed={vi.fn()}
          onSidebarWidthChange={(nextWidth, persist) => {
            changes.push({ width: nextWidth, persist });
            setWidth(nextWidth);
          }}
          onSessionsOpenChange={vi.fn()}
          onStartNewSession={vi.fn()}
          sessions={<div>Session list</div>}
        />
      );
    }
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);
    Element.prototype.releasePointerCapture = vi.fn();
    render(<Harness />);

    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent(handle, pointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 288 }));
    fireEvent(handle, pointerEvent("pointermove", { pointerId: 1, clientX: 336 }));
    expect(screen.getByRole("complementary", { name: "Kiln workspace sidebar" })).toHaveStyle({ width: "336px" });
    expect(changes.at(-1)).toEqual({ width: 336, persist: false });

    fireEvent(handle, pointerEvent("pointerup", { pointerId: 1, clientX: 336 }));
    expect(changes.at(-1)).toEqual({ width: 336, persist: true });

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(changes.at(-1)).toEqual({ width: 320, persist: true });
  });

  it("keeps the mobile surface selector and drawer controls explicit", () => {
    const onToggleDrawer = vi.fn();
    const onSelectSurface = vi.fn();
    const onStartNewSession = vi.fn();

    render(
      <MobileWorkbenchHeader
        activeSurface="chat"
        drawerOpen={false}
        drawerMode="sessions"
        operatorTerminalAvailable={false}
        operatorTerminalExpanded={false}
        operatorTerminalPanelId="operator-terminal-panel"
        onToggleDrawer={onToggleDrawer}
        onSelectSurface={onSelectSurface}
        onStartNewSession={onStartNewSession}
        onToggleOperatorTerminal={vi.fn()}
        gatewayTargetSelector={<span>Gateway target</span>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open session drawer" }));
    fireEvent.click(screen.getByRole("button", { name: "Open inspector drawer" }));
    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(onToggleDrawer).toHaveBeenNthCalledWith(1, "sessions");
    expect(onToggleDrawer).toHaveBeenNthCalledWith(2, "inspector");
    expect(onStartNewSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Gateway target")).toBeVisible();
  });

  it("keeps narrow controls compact while expanding coarse-pointer targets", () => {
    render(
      <MobileWorkbenchHeader
        activeSurface="chat"
        drawerOpen={false}
        drawerMode="sessions"
        operatorTerminalAvailable
        operatorTerminalExpanded={false}
        operatorTerminalPanelId="operator-terminal-panel"
        onToggleDrawer={vi.fn()}
        onSelectSurface={vi.fn()}
        onStartNewSession={vi.fn()}
        onToggleOperatorTerminal={vi.fn()}
        gatewayTargetSelector={<button type="button" data-slot="select-trigger">Runtime target</button>}
      />,
    );

    const header = screen.getByRole("banner");
    expect(header).toHaveClass("flex-col", "sm:flex-row");
    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspector")).not.toBeInTheDocument();
    for (const name of ["New session", "Open session drawer", "Open inspector drawer", "Open terminal"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("[@media(pointer:coarse)]:size-11");
    }
    expect(screen.getByRole("combobox", { name: "Workbench surface" })).toHaveClass(
      "[@media(pointer:coarse)]:h-11",
    );
    expect(screen.getByRole("button", { name: "Runtime target" }).parentElement).toHaveClass(
      "w-full",
      "empty:hidden",
    );
  });

  it("groups mobile surfaces by operator intent", async () => {
    render(
      <MobileWorkbenchHeader
        activeSurface="chat"
        drawerOpen={false}
        drawerMode="sessions"
        operatorTerminalAvailable={false}
        operatorTerminalExpanded={false}
        operatorTerminalPanelId="operator-terminal-panel"
        onToggleDrawer={vi.fn()}
        onSelectSurface={vi.fn()}
        onStartNewSession={vi.fn()}
        onToggleOperatorTerminal={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Workbench surface" }));

    expect(await screen.findByText("Work surfaces")).toBeVisible();
    expect(screen.getByText("Inspect and configure")).toBeVisible();
  });

  it("announces only the active mobile drawer control as expanded", () => {
    render(
      <MobileWorkbenchHeader
        activeSurface="chat"
        drawerOpen
        drawerMode="sessions"
        operatorTerminalAvailable={false}
        operatorTerminalExpanded={false}
        operatorTerminalPanelId="operator-terminal-panel"
        onToggleDrawer={vi.fn()}
        onSelectSurface={vi.fn()}
        onStartNewSession={vi.fn()}
        onToggleOperatorTerminal={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Hide session drawer" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Open inspector drawer" })).toHaveAttribute("aria-expanded", "false");
  });

  it("renders desktop inspector controls without leaking surface logic into AppShell", () => {
    const onSelectInspectorMode = vi.fn();
    const onToggleInspector = vi.fn();

    render(
      <DesktopWorkbenchHeader
        title="Chat"
        activeSurface="chat"
        activeChatSurface="browser"
        inspectorOpen
        inspectorMode="changed"
        changedCount={4}
        approvalCount={1}
        operatorTerminalAvailable
        operatorTerminalExpanded={false}
        operatorTerminalPanelId="operator-terminal-panel"
        onToggleOperatorTerminal={vi.fn()}
        onSelectInspectorMode={onSelectInspectorMode}
        onToggleInspector={onToggleInspector}
        gatewayTargetSelector={<span>Gateway target</span>}
      />,
    );

    expect(screen.getByText("interactive browser")).toBeVisible();
    expect(within(screen.getByRole("button", { name: "Changed files" })).getByText("4")).toBeVisible();
    expect(within(screen.getByRole("button", { name: "Approvals" })).getByText("1")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open terminal" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));

    expect(onSelectInspectorMode).toHaveBeenCalledWith("workspace");
    expect(onToggleInspector).toHaveBeenCalledTimes(1);
  });

  it("exposes the terminal as workbench chrome on narrow layouts", () => {
    const onToggleOperatorTerminal = vi.fn();
    render(
      <MobileWorkbenchHeader
        activeSurface="chat"
        drawerOpen={false}
        drawerMode="sessions"
        operatorTerminalAvailable
        operatorTerminalExpanded
        operatorTerminalPanelId="operator-terminal-panel"
        onToggleDrawer={vi.fn()}
        onSelectSurface={vi.fn()}
        onStartNewSession={vi.fn()}
        onToggleOperatorTerminal={onToggleOperatorTerminal}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide terminal" }));
    expect(onToggleOperatorTerminal).toHaveBeenCalledOnce();
  });
});

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopWorkbenchHeader,
  MobileWorkbenchHeader,
  PrimarySidebar,
} from "../src/components/workbench-navigation.js";

describe("Workbench navigation", () => {
  it("renders primary surfaces with badges and collapsed session access", () => {
    const onSelectSurface = vi.fn();

    render(
      <PrimarySidebar
        activeSurface="agents"
        collapsed
        activityCount={3}
        managedAgentAttentionCount={2}
        sessionsOpen={false}
        onSelectSurface={onSelectSurface}
        onToggleCollapsed={vi.fn()}
        onSessionsOpenChange={vi.fn()}
        onStartNewSession={vi.fn()}
        sessions={<div>Session list</div>}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Kiln workspace sidebar" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Workbench surfaces" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Open sessions" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Workbench surfaces" })).toHaveClass("px-2");
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
        activityCount={0}
        managedAgentAttentionCount={0}
        sessionsOpen={false}
        onSelectSurface={vi.fn()}
        onToggleCollapsed={vi.fn()}
        onSessionsOpenChange={vi.fn()}
        onStartNewSession={onStartNewSession}
        sessions={<div>Session list</div>}
      />,
    );

    expect(screen.getByText("Kiln")).toBeVisible();
    expect(screen.queryByText("Operator workbench")).not.toBeInTheDocument();
    expect(screen.queryByText("Surfaces")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(onStartNewSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Session list")).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
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
